import { CacheManager } from '../Socket'
import type { CacheStore, SignalAuthState, SignalKeyStoreWithTransaction, SignedKeyPair } from '../Types'
import { SignalRepository } from '../Types/Signal'
import { generateSignalPubKey } from '../Utils'
import { badMACRecovery, handleBadMACError } from '../Utils/bad-mac-recovery'
import logger from '../Utils/logger'
import { handleMACError, macErrorManager } from '../Utils/mac-error-handler'
import { FullJid, isHostedLidUser, isHostedPnUser, isLidUser, isPnUser, jidDecode, transferDevice } from '../WABinary'
import { GroupCipher, GroupSessionBuilder, SenderKeyDistributionMessage, SenderKeyStore } from './Group'
import { SenderKeyName } from './Group/sender-key-name'
import { SenderKeyRecord } from './Group/sender-key-record'
import { LIDMappingStore } from './lid-mapping'
import { EncryptionResult, SessionValidationResult } from './types'
import * as libsignal from 'libsignal'

const SIGNAL_CONSTANTS = {
	PREKEY_MESSAGE_TYPE: 3,
	WHATSAPP_DOMAIN: '@s.whatsapp.net',
	LID_DOMAIN: '@lid',
	DEFAULT_DEVICE: 0,
} as const

export function makeLibSignalRepository(auth: SignalAuthState): SignalRepository {
	const parsedKeys = auth.keys as SignalKeyStoreWithTransaction
	const lidMapping = new LIDMappingStore(parsedKeys, logger)
	const storage: SenderKeyStore = signalStorage(auth, lidMapping)

	const migratedSessionCache: CacheStore = CacheManager.getInstance('SESSION_MIGRATION_CACHE')
	const sessionValidationCache: CacheStore = CacheManager.getInstance('SESSION_VALIDATION_CACHE')

	/**
	 * Utility function to validate JID format and decode
	 */
	const validateAndDecodeJid = (jid: string): { user: string; device: number } | null => {
		try {
			const decoded: FullJid | undefined = jidDecode(jid)
			if (!decoded?.user) {
				logger.warn({ jid }, 'Invalid JID format')
				return null
			}

			return {
				user: decoded.user,
				device: decoded.device || SIGNAL_CONSTANTS.DEFAULT_DEVICE
			}
		} catch (error) {
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
		if (!shouldUseLID(jid)) {
			return jid
		}

		try {
			const lidForPN: string | null = await lidMapping.getLIDForPN(jid)
			if (!lidForPN?.includes(SIGNAL_CONSTANTS.LID_DOMAIN)) {
				return jid
			}

			const lidAddr = jidToSignalProtocolAddress(lidForPN)
			const { [lidAddr.toString()]: lidSession } = await parsedKeys.get('session', [lidAddr.toString()])

			if (lidSession) {
				return lidForPN
			}

			const pnAddr = jidToSignalProtocolAddress(jid)
			const { [pnAddr.toString()]: pnSession } = await parsedKeys.get('session', [pnAddr.toString()])

			if (pnSession) {
				await repository.migrateSession(jid, lidForPN)
				return lidForPN
			}

			return jid
		} catch (error) {
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
			} catch (error) {
				if (badMACRecovery.isBadMACError(error)) {
					handleBadMACError(group, error, auth, repository, authorJid)
				} else if (macErrorManager.isMACError(error)) {
					handleMACError(
						`${group}:${authorJid}`,
						error,
						async() => {
							const keyId: string = senderName.toString()
							await parsedKeys.set({ 'sender-key': { [keyId]: null } })
						}
					)
				}

				throw error
			}
		},
		async processSenderKeyDistributionMessage({ item, authorJid }) {
			const builder = new GroupSessionBuilder(storage)
			if (!item.groupId) {
				throw new Error('Group ID is required for sender key distribution message')
			}

			const senderName: SenderKeyName = jidToSignalSenderKeyName(item.groupId, authorJid)

			const senderMsg = new SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage)
			const senderNameStr: string = senderName.toString()
			const { [senderNameStr]: senderKey } = await parsedKeys.get('sender-key', [senderNameStr])
			if (!senderKey) {
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
			} catch (error) {
				if (badMACRecovery.isBadMACError(error)) {
					await handleBadMACError(jid, error, auth, repository)
				} else if (macErrorManager.isMACError(error)) {
					await handleMACError(
						jid,
						error,
						async() => {
							await parsedKeys.set({ 'session': { [addr.toString()]: null } })
						}
					)
				}

				throw error
			}

			return result
		},
		async encryptMessage({ jid, data }): Promise<EncryptionResult> {
			const originalJid = jid
			try {
				const decoded = validateAndDecodeJid(jid)
				if (!decoded) {
					throw new Error(`Invalid JID format: ${jid}`)
				}

				const encryptionJid: string = await getOptimalEncryptionJid(jid)
				logger.trace({ originalJid: jid, encryptionJid }, 'Encryption JID selected')

				const addr = jidToSignalProtocolAddress(encryptionJid)

				const sessionValidation = await repository.validateSession(encryptionJid)
				if (!sessionValidation.exists) {
					logger.warn(
						{ jid: encryptionJid, reason: sessionValidation.reason, originalJid },
						'No valid session for encryption'
					)
					throw new Error(`No valid session for ${encryptionJid}: ${sessionValidation.reason}`)
				}

				const cipher = new libsignal.SessionCipher(storage, addr)

				const { type: sigType, body } = await cipher.encrypt(data)
				const type: 'pkmsg' | 'msg' = sigType === SIGNAL_CONSTANTS.PREKEY_MESSAGE_TYPE ? 'pkmsg' : 'msg'

				logger.trace({ jid: encryptionJid, type, originalJid }, 'Message encrypted successfully')

				return {
					type,
					ciphertext: Buffer.from(body, 'binary')
				}
			} catch (error) {
				logger.error(
					{
						error,
						jid: originalJid,
						errorName: error?.name,
						errorMessage: error?.message
					},
					'Failed to encrypt message'
				)
				throw error
			}
		},

		async encryptGroupMessage({ group, meId, data }) {
			const senderName: SenderKeyName = jidToSignalSenderKeyName(group, meId)
			const builder = new GroupSessionBuilder(storage)
			const senderNameStr: string = senderName.toString()
			const { [senderNameStr]: senderKey } = await parsedKeys.get('sender-key', [senderNameStr])

			if (!senderKey) {
				await storage.storeSenderKey(senderName, new SenderKeyRecord())
			}

			const senderKeyDistributionMessage = await builder.create(senderName)
			const session = new GroupCipher(storage, senderName)
			const ciphertext: Uint8Array = await session.encrypt(data)

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

		// Optimized direct access to LID mapping store
		lidMapping,

		async validateSession(jid: string): Promise<SessionValidationResult> {
			try {
				const cacheKey = `validation:${jid}`
				const cached: SessionValidationResult | undefined = sessionValidationCache.get<SessionValidationResult>(cacheKey)
				if (cached) {
					return cached
				}

				const decoded = validateAndDecodeJid(jid)
				if (!decoded) {
					const result = { exists: false, reason: 'invalid jid format' }
					sessionValidationCache.set(cacheKey, result)
					return result
				}

				const addr: libsignal.ProtocolAddress = jidToSignalProtocolAddress(jid)
				const session: libsignal.SessionRecord | null = await storage.loadSession(addr.toString())

				if (!session) {
					const result = { exists: false, reason: 'no session' }
					sessionValidationCache.set(cacheKey, result)
					return result
				}

				if (!session.haveOpenSession()) {
					const result = { exists: false, reason: 'no open session' }
					sessionValidationCache.set(cacheKey, result)
					return result
				}

				const result = { exists: true }
				sessionValidationCache.set(cacheKey, result)
				return result

			} catch (error) {
				logger.error({ error, jid }, 'Session validation error')
				const result = { exists: false, reason: 'validation error' }
				return result
			}
		},

		async deleteSession(jid: string): Promise<void> {
			try {
				const decoded = validateAndDecodeJid(jid)
				if (!decoded) {
					logger.warn({ jid }, 'Cannot delete session for invalid JID')
					return
				}

				const addr = jidToSignalProtocolAddress(jid)

				await (parsedKeys).transaction(async() => {
					await parsedKeys.set({ session: { [addr.toString()]: null } })
				})

				sessionValidationCache.del(`validation:${jid}`)

				logger.info({ jid }, 'Session deleted for')
			} catch (error) {
				logger.error({ error, jid }, 'Failed to delete session')
				throw error
			}
		},

		async migrateSession(
			fromJid: string,
			toJid: string
		): Promise<{ migrated: number; skipped: number; total: number }> {
			/**
			 * Session migration from Phone Number (PN) to Local Identity (LID).
			 * This function relies on device lists populated by USync queries (see getUSyncDevices in messages-send.ts).
			 *
			 * Process:
			 * 1. USync queries fetch device lists and store them in 'device-list'
			 * 2. This function reads those lists and migrates existing PN sessions to LID format
			 * 3. Migration is cached per-device to avoid redundant operations
			 *
			 * Note: Device discovery must be performed via USync before migration.
			 */
			if (!fromJid || (!isLidUser(toJid) && !isHostedLidUser(toJid))) {
				return { migrated: 0, skipped: 0, total: 0 }
			}

			if (!isPnUser(fromJid) && !isHostedPnUser(fromJid)) {
				return { migrated: 0, skipped: 0, total: 1 }
			}

			const fromDecoded = validateAndDecodeJid(fromJid)
			const toDecoded = validateAndDecodeJid(toJid)

			if (!fromDecoded || !toDecoded) {
				logger.error({ fromJid, toJid }, 'Invalid JID format for migration')
				return { migrated: 0, skipped: 0, total: 0 }
			}

			const { user: pnUser } = fromDecoded
			const { user: lidUser } = toDecoded

			logger.debug({ fromJid, toJid, pnUser, lidUser }, 'Starting session migration')

			const { [pnUser]: userDevices } = await parsedKeys.get('device-list', [pnUser])
			if (!userDevices || userDevices.length === 0) {
				logger.debug({ pnUser }, 'No device list found - USync query may not have been executed yet')
				return { migrated: 0, skipped: 0, total: 0 }
			}

			const fromDeviceStr: string = fromDecoded.device.toString()
			if (!userDevices.includes(fromDeviceStr)) {
				userDevices.push(fromDeviceStr)
			}

			logger.debug({ pnUser, deviceCount: userDevices.length }, 'Loaded device list from storage')

			const uncachedDevices: string[] = userDevices.filter(device => {
				const cacheKey = `${pnUser}.${device}`
				return !migratedSessionCache.get(cacheKey)
			})

			if (uncachedDevices.length === 0) {
				logger.debug({ pnUser }, 'All devices already migrated (cached)')
				return { migrated: 0, skipped: 0, total: userDevices.length }
			}

			const sessionKeys: string[] = uncachedDevices.map(device => `${pnUser}.${device}`)
			const existingSessions = await parsedKeys.get('session', sessionKeys)

			const deviceJids: string[] = []
			for (const [sessionKey, sessionData] of Object.entries(existingSessions)) {
				if (!sessionData) {
					continue
				}

				const deviceStr: string = sessionKey.split('.')[1]
				if (!deviceStr) {
					continue
				}

				const deviceNum: number = parseInt(deviceStr, 10)
				let jid: string = deviceNum === 0 ? `${pnUser}@s.whatsapp.net` : `${pnUser}:${deviceNum}@s.whatsapp.net`
				if (deviceNum === 99) {
					jid = `${pnUser}:99@hosted`
				}

				deviceJids.push(jid)
			}

			if (deviceJids.length === 0) {
				logger.debug({ pnUser, checkedDevices: uncachedDevices.length }, 'No sessions to migrate')
				return { migrated: 0, skipped: 0, total: 0 }
			}

			logger.debug(
				{
					fromJid,
					toJid,
					totalDevices: userDevices.length,
					uncachedDevices: uncachedDevices.length,
					devicesWithSessions: deviceJids.length
				},
				'Prepared devices for migration'
			)

			return parsedKeys.transaction(
				async(): Promise<{ migrated: number; skipped: number; total: number }> => {
					type MigrationOp = {
						deviceId: number
						pnAddr: string
						lidAddr: string
					}

					const migrationOps: MigrationOp[] = deviceJids.map(jid => {
						const decoded: FullJid = jidDecode(jid)!
						const lidJid: string = transferDevice(jid, toJid)

						return {
							deviceId: decoded.device || 0,
							pnAddr: jidToSignalProtocolAddress(jid).toString(),
							lidAddr: jidToSignalProtocolAddress(lidJid).toString()
						}
					})

					const pnAddrs: string[] = migrationOps.map(op => op.pnAddr)
					const pnSessions = await parsedKeys.get('session', pnAddrs)

					const sessionUpdates: { [key: string]: Uint8Array | null } = {}
					let migratedCount = 0

					for (const op of migrationOps) {
						const pnSession = pnSessions[op.pnAddr]
						if (!pnSession) {
							continue
						}

						try {
							const sessionRecord = libsignal.SessionRecord.deserialize(pnSession)
							if (sessionRecord.haveOpenSession()) {
								sessionUpdates[op.lidAddr] = sessionRecord.serialize()
								sessionUpdates[op.pnAddr] = null
								migratedCount++
							}
						} catch (error) {
							logger.error({ error, pnAddr: op.pnAddr }, 'Failed to deserialize session')
						}
					}

					if (Object.keys(sessionUpdates).length > 0) {
						await parsedKeys.set({ session: sessionUpdates })
						logger.info({ migratedCount, pnUser, lidUser }, 'Session migration complete')

						for (const op of migrationOps) {
							if (sessionUpdates[op.lidAddr]) {
								migratedSessionCache.set(`${pnUser}.${op.deviceId}`, true)
							}
						}
					}

					const skippedCount: number = migrationOps.length - migratedCount
					return {
						migrated: migratedCount,
						skipped: skippedCount,
						total: migrationOps.length
					}
				}
			)
		},

		async encryptMessageWithWire({ encryptionJid, wireJid, data }) {
			const result = await repository.encryptMessage({ jid: encryptionJid, data })
			return { ...result, wireJid }
		},

		destroy() {
			try {
				migratedSessionCache.flushAll()
				sessionValidationCache.flushAll()

				logger.trace({}, 'LibSignal repository destroyed and caches cleared')
			} catch (error) {
				logger.error({ error }, 'Error during repository destruction')
			}
		}
	}

	return repository
}

const jidToSignalProtocolAddress = (jid: string): libsignal.ProtocolAddress => {
	const { user, device } = jidDecode(jid)!
	return new libsignal.ProtocolAddress(user, device || 0)
}

const jidToSignalSenderKeyName = (group: string, user: string): SenderKeyName => {
	return new SenderKeyName(group, jidToSignalProtocolAddress(user))
}

function signalStorage({ creds, keys }: SignalAuthState, lidMapping: LIDMappingStore): SenderKeyStore {
	/**
	 * Enhanced session loading with LID preference
	 */
	return {
		loadSession: async(id: string): Promise<libsignal.SessionRecord | null> => {
			try {
				let actualId: string = id

				if (id.includes('.') && !id.includes('_1')) {
					const parts: string[] = id.split('.')
					const device: string = parts[1] || '0'
					const pnJid: string = device === '0'
						? `${parts[0]}${SIGNAL_CONSTANTS.WHATSAPP_DOMAIN}`
						: `${parts[0]}:${device}${SIGNAL_CONSTANTS.WHATSAPP_DOMAIN}`

					const lidForPN: string | null = await lidMapping.getLIDForPN(pnJid)
					if (lidForPN?.includes(SIGNAL_CONSTANTS.LID_DOMAIN)) {
						const lidAddr = jidToSignalProtocolAddress(lidForPN)
						const lidId = lidAddr.toString()

						const { [lidId]: lidSession } = await keys.get('session', [lidId])
						if (lidSession) {
							actualId = lidId
						}
					}
				}

				const { [actualId]: sess } = await keys.get('session', [actualId])
				if (sess) {
					return libsignal.SessionRecord.deserialize(sess)
				}

				return null
			} catch (error) {
				logger.error({ error, id }, 'Failed to load session')
				return null
			}
		},

		storeSession: async(id: string, session: libsignal.SessionRecord): Promise<void> => {
			try {
				await keys.set({ 'session': { [id]: session.serialize() } })
				logger.trace({ id }, 'Session stored for')
			} catch (error) {
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
				if (key) {
					return {
						privKey: Buffer.from(key.private),
						pubKey: Buffer.from(key.public)
					}
				}

				return undefined
			} catch (error) {
				logger.error({ error, id }, 'Failed to load pre-key')
				return undefined
			}
		},

		removePreKey: async(id: number): Promise<void> => {
			try {
				await keys.set({ 'pre-key': { [id]: null } })
				logger.trace({ id }, 'Pre-key removed')
			} catch (error) {
				logger.error({ error, id }, 'Failed to remove pre-key')
				throw error
			}
		},

		loadSignedPreKey: (): { privKey: Buffer; pubKey: Buffer } => {
			const key: SignedKeyPair = creds.signedPreKey
			return {
				privKey: Buffer.from(key.keyPair.private),
				pubKey: Buffer.from(key.keyPair.public)
			}
		},

		loadSenderKey: async(senderKeyName: SenderKeyName): Promise<SenderKeyRecord> => {
			try {
				const keyId: string = senderKeyName.toString()
				const { [keyId]: key } = await keys.get('sender-key', [keyId])
				if (key) {
					return SenderKeyRecord.deserialize(key)
				}

				return new SenderKeyRecord()
			} catch (error) {
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
				logger.trace({ keyId }, 'Sender key stored')
			} catch (error) {
				logger.error({ error, senderKeyName: senderKeyName.toString() }, 'Failed to store sender key')
				throw error
			}
		},

		getOurRegistrationId: (): number => {
			return creds.registrationId
		},

		getOurIdentity: (): { privKey: Buffer; pubKey: Buffer } => {
			const { signedIdentityKey } = creds
			const pubKey: Uint8Array = generateSignalPubKey(signedIdentityKey.public)
			return {
				privKey: Buffer.from(signedIdentityKey.private),
				pubKey: Buffer.isBuffer(pubKey) ? pubKey : Buffer.from(pubKey),
			}
		}
	}
}
