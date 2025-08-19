import NodeCache from '@cacheable/node-cache'
import * as libsignal from 'libsignal'
import type { SignalAuthState, SignalKeyStoreWithTransaction } from '../Types'
import { SignalRepository } from '../Types/Signal'
import { generateSignalPubKey } from '../Utils'
import { badMACRecovery, handleBadMACError } from '../Utils/bad-mac-recovery'
import logger from '../Utils/logger'
import { handleMACError, macErrorManager } from '../Utils/mac-error-handler'
import { jidDecode } from '../WABinary'
import type { SenderKeyStore } from './Group/group_cipher'
import { SenderKeyName } from './Group/sender-key-name'
import { SenderKeyRecord } from './Group/sender-key-record'
import { GroupCipher, GroupSessionBuilder, SenderKeyDistributionMessage } from './Group'
import { LIDMappingStore } from './lid-mapping'

export function makeLibSignalRepository(auth: SignalAuthState): SignalRepository {
	const lidMapping = new LIDMappingStore(auth.keys as SignalKeyStoreWithTransaction)
	const storage = signalStorage(auth, lidMapping)
	// Simple operation-level deduplication (5 minutes)
	const recentMigrations = new NodeCache({
		stdTTL: 5 * 60 * 1000
	})

	const repository: SignalRepository = {
		decryptGroupMessage({ group, authorJid, msg }) {
			const senderName: SenderKeyName = jidToSignalSenderKeyName(group, authorJid)
			const cipher = new GroupCipher(storage, senderName)

			try {
				return cipher.decrypt(msg)
			} catch(error) {
				if(badMACRecovery.isBadMACError(error)) {
					handleBadMACError(group, error, auth, repository, authorJid)
				} else if(macErrorManager.isMACError(error)) {
					handleMACError(
						`${group}:${authorJid}`,
						error,
						async() => {
							const keyId = senderName.toString()
							await auth.keys.set({ 'sender-key': { [keyId]: null } })
						}
					)
				}

				throw error
			}
		},
		async processSenderKeyDistributionMessage({ item, authorJid }) {
			const builder = new GroupSessionBuilder(storage)
			if(!item.groupId) {
				throw new Error('Group ID is required for sender key distribution message')
			}

			const senderName: SenderKeyName = jidToSignalSenderKeyName(item.groupId, authorJid)

			const senderMsg = new SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage)
			const senderNameStr: string = senderName.toString()
			const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr])
			if(!senderKey) {
				await storage.storeSenderKey(senderName, new SenderKeyRecord())
			}

			await builder.process(senderName, senderMsg)
		},
		async decryptMessage({ jid, type, ciphertext }) {
			const addr = jidToSignalProtocolAddress(jid)
			const session = new libsignal.SessionCipher(storage, addr)
			let result: Buffer

			try {
				switch (type) {
				case 'pkmsg':
					result = await session.decryptPreKeyWhisperMessage(ciphertext)
					break
				case 'msg':
					result = await session.decryptWhisperMessage(ciphertext)
					break
				default:
					throw new Error(`Unknown message type: ${type}`)
				}
			} catch(error) {
				if(badMACRecovery.isBadMACError(error)) {
					await handleBadMACError(jid, error, auth, repository)
				} else if(macErrorManager.isMACError(error)) {
					await handleMACError(
						jid,
						error,
						async() => {
							await auth.keys.set({ 'session': { [addr.toString()]: null } })
						}
					)
				}

				throw error
			}

			return result
		},
		async encryptMessage({ jid, data }) {
			// LID SINGLE SOURCE OF TRUTH: Always prefer LID when available
			let encryptionJid = jid

			// Check for LID mapping and use it if session exists
			if(jid.includes('@s.whatsapp.net')) {
				const lidForPN = await lidMapping.getLIDForPN(jid)
				if(lidForPN?.includes('@lid')) {
					const lidAddr = jidToSignalProtocolAddress(lidForPN)
					const { [lidAddr.toString()]: lidSession } = await auth.keys.get('session', [lidAddr.toString()])

					if(lidSession) {
						// LID session exists, use it
						encryptionJid = lidForPN
					} else {
						// Try to migrate if PN session exists
						const pnAddr = jidToSignalProtocolAddress(jid)
						const { [pnAddr.toString()]: pnSession } = await auth.keys.get('session', [pnAddr.toString()])

						if(pnSession) {
							// Migrate PN to LID
							await repository.migrateSession(jid, lidForPN)
							encryptionJid = lidForPN
						}
					}
				}
			}

			const addr = jidToSignalProtocolAddress(encryptionJid)
			const cipher = new libsignal.SessionCipher(storage, addr)

			const { type: sigType, body } = await cipher.encrypt(data)
			const type: 'pkmsg' | 'msg' = sigType === 3 ? 'pkmsg' : 'msg'
			return { type, ciphertext: Buffer.from(body, 'binary') }
		},

		async encryptGroupMessage({ group, meId, data }) {
			const senderName: SenderKeyName = jidToSignalSenderKeyName(group, meId)
			const builder = new GroupSessionBuilder(storage)
			const senderNameStr: string = senderName.toString()
			const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr])

			if(!senderKey) {
				await storage.storeSenderKey(senderName, new SenderKeyRecord())
			}

			const senderKeyDistributionMessage = await builder.create(senderName)
			const session = new GroupCipher(storage, senderName)
			const ciphertext = await session.encrypt(data)

			return {
				ciphertext,
				senderKeyDistributionMessage: senderKeyDistributionMessage.serialize(),
			}
		},
		async injectE2ESession({ jid, session }) {
			const cipher = new libsignal.SessionBuilder(storage, jidToSignalProtocolAddress(jid))
			await cipher.initOutgoing(session)
		},

		jidToSignalProtocolAddress(jid) {
			return jidToSignalProtocolAddress(jid).toString()
		},

		async storeLIDPNMapping(lid: string, pn: string) {
			await lidMapping.storeLIDPNMapping(lid, pn)
		},

		getLIDMappingStore() {
			return lidMapping
		},

		async validateSession(jid: string) {
			try {
				const addr = jidToSignalProtocolAddress(jid)
				const session = await storage.loadSession(addr.toString())

				if(!session) {
					return { exists: false, reason: 'no session' }
				}

				if(!session.haveOpenSession()) {
					return { exists: false, reason: 'no open session' }
				}

				return { exists: true }
			} catch(error) {
				logger.trace(error)
				return { exists: false, reason: 'validation error' }
			}
		},

		async deleteSession(jid: string) {
			const addr = jidToSignalProtocolAddress(jid)

			return (auth.keys as SignalKeyStoreWithTransaction).transaction(async() => {
				await auth.keys.set({ session: { [addr.toString()]: null } })
			})
		},

		async migrateSession(fromJid: string, toJid: string) {
			// Only migrate PN → LID
			if(!fromJid.includes('@s.whatsapp.net') || !toJid.includes('@lid')) {
				return
			}

			const fromDecoded = jidDecode(fromJid)
			const toDecoded = jidDecode(toJid)
			if(!fromDecoded || !toDecoded) {
				return
			}

			const deviceId = fromDecoded.device || 0
			const migrationKey = `${fromDecoded.user}.${deviceId}→${toDecoded.user}.${deviceId}`

			// Check if recently migrated (5 min window)
			if(recentMigrations.has(migrationKey)) {
				return
			}

			// Check if LID session already exists
			const lidAddr = jidToSignalProtocolAddress(toJid)
			const { [lidAddr.toString()]: lidExists } = await auth.keys.get('session', [lidAddr.toString()])
			if(lidExists) {
				recentMigrations.set(migrationKey, true)
				return
			}

			return (auth.keys as SignalKeyStoreWithTransaction).transaction(async() => {
				// Store mapping
				await lidMapping.storeLIDPNMapping(toJid, fromJid)

				// Load and copy session
				const fromAddr = jidToSignalProtocolAddress(fromJid)
				const fromSession = await storage.loadSession(fromAddr.toString())

				if(fromSession?.haveOpenSession()) {
					// Deep copy session to prevent reference issues
					const sessionBytes = fromSession.serialize()
					const copiedSession = libsignal.SessionRecord.deserialize(sessionBytes)

					// Store at LID address
					await storage.storeSession(lidAddr.toString(), copiedSession)

					// Delete PN session - maintain single encryption layer
					await auth.keys.set({ session: { [fromAddr.toString()]: null } })
				}

				recentMigrations.set(migrationKey, true)
			})
		},

		async encryptMessageWithWire({ encryptionJid, wireJid, data }) {
			const result = await repository.encryptMessage({ jid: encryptionJid, data })
			return { ...result, wireJid }
		},

		destroy() {
			recentMigrations.del('*')
		}
	}

	return repository
}

const jidToSignalProtocolAddress = (jid: string) => {
	const { user, device } = jidDecode(jid)!
	return new libsignal.ProtocolAddress(user, device || 0)
}

const jidToSignalSenderKeyName = (group: string, user: string): SenderKeyName => {
	return new SenderKeyName(group, jidToSignalProtocolAddress(user))
}

function signalStorage({ creds, keys }: SignalAuthState, lidMapping: LIDMappingStore): SenderKeyStore & Record<string, any> {
	return {
		loadSession: async(id: string) => {
			try {
				let actualId = id
				if(id.includes('.') && !id.includes('_1')) {
					const parts = id.split('.')
					const device = parts[1] || '0'
					const pnJid = device === '0' ? `${parts[0]}@s.whatsapp.net` : `${parts[0]}:${device}@s.whatsapp.net`

					const lidForPN = await lidMapping.getLIDForPN(pnJid)
					if(lidForPN?.includes('@lid')) {
						const lidAddr = jidToSignalProtocolAddress(lidForPN)
						const lidId = lidAddr.toString()

						const { [lidId]: lidSession } = await keys.get('session', [lidId])
						if(lidSession) {
							actualId = lidId
						}
					}
				}

				const { [actualId]: sess } = await keys.get('session', [actualId])

				if(sess) {
					return libsignal.SessionRecord.deserialize(sess)
				}
			} catch(error) {
				logger.trace(error)
				return null
			}

			return null
		},
		storeSession: async(id: string, session: libsignal.SessionRecord) => {
			await keys.set({ 'session': { [id]: session.serialize() } })
		},
		isTrustedIdentity: () => {
			return true
		},
		loadPreKey: async(id: number | string) => {
			const keyId: string = id.toString()
			const { [keyId]: key } = await keys.get('pre-key', [keyId])
			if(key) {
				return {
					privKey: Buffer.from(key.private),
					pubKey: Buffer.from(key.public)
				}
			}
		},
		removePreKey: (id: number) => keys.set({ 'pre-key': { [id]: null } }),
		loadSignedPreKey: () => {
			const key = creds.signedPreKey
			return {
				privKey: Buffer.from(key.keyPair.private),
				pubKey: Buffer.from(key.keyPair.public)
			}
		},
		loadSenderKey: async(senderKeyName: SenderKeyName) => {
			const keyId: string = senderKeyName.toString()
			const { [keyId]: key } = await keys.get('sender-key', [keyId])
			if(key) {
				return SenderKeyRecord.deserialize(key)
			}

			return new SenderKeyRecord()
		},
		storeSenderKey: async(senderKeyName: SenderKeyName, key: SenderKeyRecord) => {
			const keyId: string = senderKeyName.toString()
			const serialized: string = JSON.stringify(key.serialize())
			await keys.set({
				'sender-key': {
					[keyId]: Buffer.from(serialized, 'utf-8')
				}
			})
		},
		getOurRegistrationId: () => (
			creds.registrationId
		),
		getOurIdentity: () => {
			const { signedIdentityKey } = creds
			return {
				privKey: Buffer.from(signedIdentityKey.private),
				pubKey: generateSignalPubKey(signedIdentityKey.public),
			}
		}
	}
}
