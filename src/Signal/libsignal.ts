import NodeCache from '@cacheable/node-cache'
import * as libsignal from 'libsignal'
import type { SignalAuthState, SignalKeyStoreWithTransaction } from '../Types'
import { SignalRepository } from '../Types/Signal'
import { generateSignalPubKey } from '../Utils'
import { badMACRecovery, handleBadMACError } from '../Utils/bad-mac-recovery'
import logger from '../Utils/logger'
import { handleMACError, macErrorManager } from '../Utils/mac-error-handler'
import { jidDecode } from '../WABinary'
import { SenderKeyName } from './Group/sender-key-name'
import { SenderKeyRecord } from './Group/sender-key-record'
import { GroupCipher, GroupSessionBuilder, SenderKeyDistributionMessage, SenderKeyStore } from './Group'
import { LIDMappingStore } from './lid-mapping'

const SIGNAL_CONSTANTS = {
	MIGRATION_CACHE_TTL: 15 * 60 * 1000,
	PREKEY_MESSAGE_TYPE: 3,
	WHATSAPP_DOMAIN: '@s.whatsapp.net',
	LID_DOMAIN: '@lid',
	DEFAULT_DEVICE: 0,
	SESSION_CACHE_TTL: 5 * 60 * 1000,
} as const

export interface SessionValidationResult {
	exists: boolean
	reason?: string
}

export interface EncryptionResult {
	type: 'pkmsg' | 'msg'
	ciphertext: Buffer
}

export interface EncryptionWithWireResult extends EncryptionResult {
	wireJid: string
}

export interface GroupEncryptionResult {
	ciphertext: Buffer
	senderKeyDistributionMessage: Buffer
}

export interface SessionMigrationOptions {
	force?: boolean
	skipValidation?: boolean
}

export function makeLibSignalRepository(auth: SignalAuthState): SignalRepository {
	const lidMapping = new LIDMappingStore(auth.keys as SignalKeyStoreWithTransaction)
	const storage = signalStorage(auth, lidMapping)

	const recentMigrations = new NodeCache({
		stdTTL: SIGNAL_CONSTANTS.MIGRATION_CACHE_TTL,
		checkperiod: 60,
		useClones: false,
		maxKeys: 1000
	})

	const sessionValidationCache = new NodeCache({
		stdTTL: SIGNAL_CONSTANTS.SESSION_CACHE_TTL,
		useClones: false,
		maxKeys: 500
	})

	/**
	 * Utility function to validate JID format and decode
	 */
	const validateAndDecodeJid = (jid: string): { user: string; device: number } | null => {
		try {
			const decoded = jidDecode(jid)
			if(!decoded?.user) {
				logger.warn(`Invalid JID format: ${jid}`)
				return null
			}

			return {
				user: decoded.user,
				device: decoded.device || SIGNAL_CONSTANTS.DEFAULT_DEVICE
			}
		} catch(error) {
			logger.error({ error, jid }, 'Failed to decode JID')
			return null
		}
	}

	/**
	 * Check if JID should use LID for encryption
	 */
	const shouldUseLID = (jid: string): boolean => {
		return jid.includes(SIGNAL_CONSTANTS.WHATSAPP_DOMAIN)
	}

	/**
	 * Get the optimal encryption JID (prefers LID if available)
	 */
	const getOptimalEncryptionJid = async(jid: string): Promise<string> => {
		if(!shouldUseLID(jid)) {
			return jid
		}

		try {
			const lidForPN = await lidMapping.getLIDForPN(jid)
			if(!lidForPN?.includes(SIGNAL_CONSTANTS.LID_DOMAIN)) {
				return jid
			}

			const lidAddr = jidToSignalProtocolAddress(lidForPN)
			const { [lidAddr.toString()]: lidSession } = await auth.keys.get('session', [lidAddr.toString()])

			if(lidSession) {
				return lidForPN
			}

			const pnAddr = jidToSignalProtocolAddress(jid)
			const { [pnAddr.toString()]: pnSession } = await auth.keys.get('session', [pnAddr.toString()])

			if(pnSession) {
				await repository.migrateSession(jid, lidForPN)
				return lidForPN
			}

			return jid
		} catch(error) {
			logger.error({ error, jid }, 'Failed to get optimal encryption JID')
			return jid
		}
	}

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
		async encryptMessage({ jid, data }): Promise<EncryptionResult> {
			try {
				const encryptionJid = await getOptimalEncryptionJid(jid)

				const addr = jidToSignalProtocolAddress(encryptionJid)
				const cipher = new libsignal.SessionCipher(storage, addr)

				const { type: sigType, body } = await cipher.encrypt(data)
				const type: 'pkmsg' | 'msg' = sigType === SIGNAL_CONSTANTS.PREKEY_MESSAGE_TYPE ? 'pkmsg' : 'msg'

				return {
					type,
					ciphertext: Buffer.from(body, 'binary')
				}
			} catch(error) {
				logger.error({ error, jid }, 'Failed to encrypt message')
				throw error
			}
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

		async validateSession(jid: string): Promise<SessionValidationResult> {
			try {
				const cacheKey = `validation:${jid}`
				const cached = sessionValidationCache.get(cacheKey) as SessionValidationResult | undefined
				if(cached) {
					return cached
				}

				const decoded = validateAndDecodeJid(jid)
				if(!decoded) {
					const result = { exists: false, reason: 'invalid jid format' }
					sessionValidationCache.set(cacheKey, result)
					return result
				}

				const addr = jidToSignalProtocolAddress(jid)
				const session = await (storage as any).loadSession(addr.toString())

				if(!session) {
					const result = { exists: false, reason: 'no session' }
					sessionValidationCache.set(cacheKey, result)
					return result
				}

				if(!session.haveOpenSession()) {
					const result = { exists: false, reason: 'no open session' }
					sessionValidationCache.set(cacheKey, result)
					return result
				}

				const result = { exists: true }
				sessionValidationCache.set(cacheKey, result)
				return result

			} catch(error) {
				logger.error({ error, jid }, 'Session validation error')
				const result = { exists: false, reason: 'validation error' }
				return result
			}
		},

		async deleteSession(jid: string): Promise<void> {
			try {
				const decoded = validateAndDecodeJid(jid)
				if(!decoded) {
					logger.warn(`Cannot delete session for invalid JID: ${jid}`)
					return
				}

				const addr = jidToSignalProtocolAddress(jid)

				await (auth.keys as SignalKeyStoreWithTransaction).transaction(async() => {
					await auth.keys.set({ session: { [addr.toString()]: null } })
				})

				sessionValidationCache.del(`validation:${jid}`)

				logger.info(`Session deleted for: ${jid}`)
			} catch(error) {
				logger.error({ error, jid }, 'Failed to delete session')
				throw error
			}
		},

		async migrateSession(fromJid: string, toJid: string, options: SessionMigrationOptions = {}): Promise<void> {
			try {
				if(!options.skipValidation) {
					if(!fromJid.includes(SIGNAL_CONSTANTS.WHATSAPP_DOMAIN) || !toJid.includes(SIGNAL_CONSTANTS.LID_DOMAIN)) {
						logger.warn(`Invalid migration direction: ${fromJid} → ${toJid}`)
						return
					}
				}

				const fromDecoded = validateAndDecodeJid(fromJid)
				const toDecoded = validateAndDecodeJid(toJid)

				if(!fromDecoded || !toDecoded) {
					logger.error(`Failed to decode JIDs for migration: ${fromJid} → ${toJid}`)
					return
				}

				const deviceId = fromDecoded.device
				const migrationKey = `${fromDecoded.user}.${deviceId}→${toDecoded.user}.${deviceId}`

				if(!options.force && recentMigrations.has(migrationKey)) {
					logger.trace(`Migration already processed: ${migrationKey}`)
					return
				}

				const lidAddr = jidToSignalProtocolAddress(toJid)
				const { [lidAddr.toString()]: lidExists } = await auth.keys.get('session', [lidAddr.toString()])

				if(lidExists && !options.force) {
					logger.trace(`LID session already exists: ${toJid}`)
					recentMigrations.set(migrationKey, true)
					return
				}

				await (auth.keys as SignalKeyStoreWithTransaction).transaction(async() => {
					const mappingResult = await lidMapping.storeLIDPNMapping(toJid, fromJid)
					if(!mappingResult.success) {
						logger.error(`Failed to store LID mapping: ${mappingResult.error}`)
						return
					}

					const fromAddr = jidToSignalProtocolAddress(fromJid)
					const fromSession = await (storage as any).loadSession(fromAddr.toString())

					if(fromSession?.haveOpenSession()) {
						const sessionBytes = fromSession.serialize()
						const copiedSession = libsignal.SessionRecord.deserialize(sessionBytes)

						await (storage as any).storeSession(lidAddr.toString(), copiedSession)

						await auth.keys.set({ session: { [fromAddr.toString()]: null } })

						logger.info(`Session migrated successfully: ${fromJid} → ${toJid}`)
					} else {
						logger.warn(`No valid session found for migration: ${fromJid}`)
					}
				})

				recentMigrations.set(migrationKey, true)
				sessionValidationCache.del(`validation:${fromJid}`)
				sessionValidationCache.del(`validation:${toJid}`)

			} catch(error) {
				logger.error({ error, fromJid, toJid }, 'Session migration failed')
				throw error
			}
		},

		async encryptMessageWithWire({ encryptionJid, wireJid, data }) {
			const result = await repository.encryptMessage({ jid: encryptionJid, data })
			return { ...result, wireJid }
		},

		destroy() {
			try {
				recentMigrations.flushAll()
				sessionValidationCache.flushAll()

				logger.trace('LibSignal repository destroyed and caches cleared')
			} catch(error) {
				logger.error({ error }, 'Error during repository destruction')
			}
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

function signalStorage({ creds, keys }: SignalAuthState, lidMapping: LIDMappingStore): SenderKeyStore & Record<string, unknown> {
	/**
	 * Enhanced session loading with LID preference
	 */
	const loadSessionWithLIDPreference = async(id: string): Promise<libsignal.SessionRecord | null> => {
		try {
			let actualId = id

			if(id.includes('.') && !id.includes('_1')) {
				const parts = id.split('.')
				const device = parts[1] || '0'
				const pnJid = device === '0'
					? `${parts[0]}${SIGNAL_CONSTANTS.WHATSAPP_DOMAIN}`
					: `${parts[0]}:${device}${SIGNAL_CONSTANTS.WHATSAPP_DOMAIN}`

				const lidForPN = await lidMapping.getLIDForPN(pnJid)
				if(lidForPN?.includes(SIGNAL_CONSTANTS.LID_DOMAIN)) {
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

			return null
		} catch(error) {
			logger.error({ error, id }, 'Failed to load session')
			return null
		}
	}

	return {
		loadSession: loadSessionWithLIDPreference,

		storeSession: async(id: string, session: libsignal.SessionRecord): Promise<void> => {
			try {
				await keys.set({ 'session': { [id]: session.serialize() } })
				logger.trace(`Session stored for: ${id}`)
			} catch(error) {
				logger.error({ error, id }, 'Failed to store session')
				throw error
			}
		},

		isTrustedIdentity: (): boolean => {
			return true
		},

		loadPreKey: async(id: number | string): Promise<{ privKey: Buffer; pubKey: Buffer } | undefined> => {
			try {
				const keyId: string = id.toString()
				const { [keyId]: key } = await keys.get('pre-key', [keyId])
				if(key) {
					return {
						privKey: Buffer.from(key.private),
						pubKey: Buffer.from(key.public)
					}
				}

				return undefined
			} catch(error) {
				logger.error({ error, id }, 'Failed to load pre-key')
				return undefined
			}
		},

		removePreKey: async(id: number): Promise<void> => {
			try {
				await keys.set({ 'pre-key': { [id]: null } })
				logger.trace(`Pre-key removed: ${id}`)
			} catch(error) {
				logger.error({ error, id }, 'Failed to remove pre-key')
				throw error
			}
		},

		loadSignedPreKey: (): { privKey: Buffer; pubKey: Buffer } => {
			const key = creds.signedPreKey
			return {
				privKey: Buffer.from(key.keyPair.private),
				pubKey: Buffer.from(key.keyPair.public)
			}
		},

		loadSenderKey: async(senderKeyName: SenderKeyName): Promise<SenderKeyRecord> => {
			try {
				const keyId: string = senderKeyName.toString()
				const { [keyId]: key } = await keys.get('sender-key', [keyId])
				if(key) {
					return SenderKeyRecord.deserialize(key)
				}

				return new SenderKeyRecord()
			} catch(error) {
				logger.error({ error, senderKeyName: senderKeyName.toString() }, 'Failed to load sender key')
				return new SenderKeyRecord()
			}
		},

		storeSenderKey: async(senderKeyName: SenderKeyName, key: SenderKeyRecord): Promise<void> => {
			try {
				const keyId: string = senderKeyName.toString()
				const serialized: string = JSON.stringify(key.serialize())
				await keys.set({
					'sender-key': {
						[keyId]: Buffer.from(serialized, 'utf-8')
					}
				})
				logger.trace(`Sender key stored: ${keyId}`)
			} catch(error) {
				logger.error({ error, senderKeyName: senderKeyName.toString() }, 'Failed to store sender key')
				throw error
			}
		},

		getOurRegistrationId: (): number => {
			return creds.registrationId
		},

		getOurIdentity: (): { privKey: Buffer; pubKey: Buffer } => {
			const { signedIdentityKey } = creds
			const pubKey = generateSignalPubKey(signedIdentityKey.public)
			return {
				privKey: Buffer.from(signedIdentityKey.private),
				pubKey: Buffer.isBuffer(pubKey) ? pubKey : Buffer.from(pubKey),
			}
		}
	}
}
