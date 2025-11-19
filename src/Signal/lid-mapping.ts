import { CacheManager } from '../Socket'
import type { SignalKeyStoreWithTransaction } from '../Types'
import logger, { ILogger } from '../Utils/logger'
import { FullJid, isHostedPnUser, isJidUser, isLidUser, isPnUser, jidDecode, jidNormalizedUser } from '../WABinary'
import { DecodedJid, LIDMapping, LIDMappingResult } from './types'

const LID_MAPPING_CONSTANTS = {
	STORAGE_KEY: 'lid-mapping' as const,
	REVERSE_SUFFIX: '_reverse' as const,
	DEFAULT_DEVICE: 0,
	LID_DOMAIN: '@lid' as const,
	WHATSAPP_DOMAIN: '@s.whatsapp.net' as const
} as const

export class LIDMappingStore {

	private readonly mappingCache = CacheManager.getInstance('LID_CACHE')
	private readonly logger: ILogger
	private pnToLIDFunc?: (jids: string[]) => Promise<LIDMapping[] | undefined>
	private readonly keys: SignalKeyStoreWithTransaction

	constructor(keys: SignalKeyStoreWithTransaction, logger: ILogger, pnToLIDFunc?: (jids: string[]) => Promise<LIDMapping[] | undefined>) {
		this.keys = keys
		this.logger = logger
		this.pnToLIDFunc = pnToLIDFunc
	}

	/**
	 * Validate and decode JID with enhanced error handling
	 */
	private validateAndDecodeJid(jid: string, expectedType: 'lid' | 'pn'): DecodedJid | null {
		const isValidType: boolean | undefined = expectedType === 'lid' ? isLidUser(jid) : isJidUser(jid)

		if (!isValidType) {
			logger.warn({ jid }, `Invalid JID type for ${expectedType}`)
			return null
		}

		const decoded: FullJid | undefined = jidDecode(jid)
		if (!decoded?.user) {
			logger.warn({ jid }, 'Failed to decode JID')
			return null
		}

		return {
			user: decoded.user,
			device: decoded.device
		}
	}

	/**
	 * Validate LID-PN mapping parameters
	 */
	private validateMappingParams(lid: string, pn: string): { lidJid: string; pnJid: string } | null {
		if (!((isLidUser(lid) && isJidUser(pn)) || (isJidUser(lid) && isLidUser(pn)))) {
			logger.error({ lid, pn }, 'Invalid LID-PN mapping parameters')
			return null
		}

		const [lidJid, pnJid] = isLidUser(lid) ? [lid, pn] : [pn, lid]
		return { lidJid, pnJid }
	}

	/**
	 * Create device-specific LID from user and device
	 */
	private createDeviceSpecificLid(lidUser: string, device: number = LID_MAPPING_CONSTANTS.DEFAULT_DEVICE): string {
		return `${lidUser}:${device}${LID_MAPPING_CONSTANTS.LID_DOMAIN}`
	}

	/**
	 * Create device-specific PN from user and device
	 */
	private createDeviceSpecificPN(pnUser: string, device: number = LID_MAPPING_CONSTANTS.DEFAULT_DEVICE): string {
		return `${pnUser}:${device}${LID_MAPPING_CONSTANTS.WHATSAPP_DOMAIN}`
	}

	/**
	 * Store LID-PN mapping - USER LEVEL with enhanced error handling and validation
	 * @param lid - LID or PN identifier
	 * @param pn - PN or LID identifier
	 * @returns Promise with operation result
	 */
	async storeLIDPNMapping(lid: string, pn: string): Promise<LIDMappingResult> {
		try {
			if (!lid?.trim() || !pn?.trim()) {
				const error = 'LID and PN parameters cannot be empty'
				logger.error({ error })
				return { success: false, error }
			}

			const validationResult = this.validateMappingParams(lid, pn)
			if (!validationResult) {
				return { success: false, error: 'Invalid LID-PN mapping parameters' }
			}

			const { lidJid, pnJid } = validationResult

			const lidDecoded: DecodedJid | null = this.validateAndDecodeJid(lidJid, 'lid')
			const pnDecoded: DecodedJid | null = this.validateAndDecodeJid(pnJid, 'pn')

			if (!lidDecoded || !pnDecoded) {
				return { success: false, error: 'Failed to decode JID parameters' }
			}

			const { user: pnUser } = pnDecoded
			const { user: lidUser } = lidDecoded

			logger.trace({ pnUser, lidUser }, 'Storing USER LID mapping')

			await this.keys.transaction(async() => {
				await this.keys.set({
					[LID_MAPPING_CONSTANTS.STORAGE_KEY]: {
						[pnUser]: lidUser,
						[`${lidUser}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`]: pnUser
					}
				})
			})

			logger.debug({ pnUser, lidUser }, 'USER LID mapping stored successfully')

			return {
				success: true,
				mapping: { pnUser, lidUser }
			}

		} catch (error) {
			const errorMessage = `Failed to store LID-PN mapping: ${error instanceof Error ? error.message : 'Unknown error'}`
			logger.error({ error, lid, pn }, errorMessage)
			return { success: false, error: errorMessage }
		}
	}

	async storeLIDPNMappings(pairs: LIDMapping[]): Promise<void> {
		// Validate inputs
		const pairMap: { [_: string]: string } = {}
		for (const { lidUser: lid, pnUser: pn } of pairs) {
			if (!((isLidUser(lid) && isPnUser(pn)) || (isPnUser(lid) && isLidUser(pn)))) {
				this.logger.warn({ lid, pn }, `Invalid LID-PN mapping: ${lid}, ${pn}`)
				continue
			}

			const lidDecoded = jidDecode(lid)
			const pnDecoded = jidDecode(pn)

			if (!lidDecoded || !pnDecoded) {
				return
			}

			const pnUser = pnDecoded.user
			const lidUser = lidDecoded.user

			let existingLidUser = this.mappingCache.get(`pn:${pnUser}`)
			if (!existingLidUser) {
				this.logger.trace({ pnUser }, `Cache miss for PN user ${pnUser}; checking database`)
				const stored = await this.keys.get('lid-mapping', [pnUser])
				existingLidUser = stored[pnUser]
				if (existingLidUser) {
					// Update cache with database value
					this.mappingCache.set(`pn:${pnUser}`, existingLidUser)
					this.mappingCache.set(`lid:${existingLidUser}`, pnUser)
				}
			}

			if (existingLidUser === lidUser) {
				this.logger.debug({ pnUser, lidUser }, 'LID mapping already exists, skipping')
				continue
			}

			pairMap[pnUser] = lidUser
		}

		this.logger.trace({ pairMap }, `Storing ${Object.keys(pairMap).length} pn mappings`)

		await this.keys.transaction(async() => {
			for (const [pnUser, lidUser] of Object.entries(pairMap)) {
				await this.keys.set({
					'lid-mapping': {
						[pnUser]: lidUser,
						[`${lidUser}_reverse`]: pnUser
					}
				})

				this.mappingCache.set(`pn:${pnUser}`, lidUser)
				this.mappingCache.set(`lid:${lidUser}`, pnUser)
			}
		})
	}

	/**
	 * Get LID for PN - Returns device-specific LID based on user mapping
	 * @param pn - Phone number JID
	 * @returns Promise<string | null> - Device-specific LID or null if not found
	 */
	async getLIDForPN(pn: string): Promise<string | null> {
		return (await this.getLIDsForPNs([pn]))?.[0]?.lidUser || null
	}

	async getLIDsForPNs(pns: string[]): Promise<LIDMapping[] | null> {
		const usyncFetch: { [_: string]: number[] } = {}
		const successfulPairs: { [_: string]: LIDMapping } = {}
		for (const pn of pns) {
			if (!isPnUser(pn) && !isHostedPnUser(pn)) {
				continue
			}

			const decoded = jidDecode(pn)
			if (!decoded) {
				continue
			}

			const pnUser = decoded.user
			let lidUser = this.mappingCache.get(`pn:${pnUser}`)

			if (!lidUser) {
				const stored = await this.keys.get('lid-mapping', [pnUser])
				lidUser = stored[pnUser]

				if (lidUser) {
					this.mappingCache.set(`pn:${pnUser}`, lidUser)
					this.mappingCache.set(`lid:${lidUser}`, pnUser)
				} else {
					this.logger.trace({ pnUser }, `No LID mapping found for PN user ${pnUser}; batch getting from USync`)
					const device = decoded.device || 0
					let normalizedPn = jidNormalizedUser(pn)
					if (isHostedPnUser(normalizedPn)) {
						normalizedPn = `${pnUser}@s.whatsapp.net`
					}

					if (!usyncFetch[normalizedPn]) {
						usyncFetch[normalizedPn] = [device]
					} else {
						usyncFetch[normalizedPn]?.push(device)
					}

					continue
				}
			}

			lidUser = lidUser.toString()
			if (!lidUser) {
				this.logger.warn({ lidUser, pn }, `Invalid or empty LID user for PN ${pn}: lidUser = "${lidUser}"`)
				return null
			}

			// Push the PN device ID to the LID to maintain device separation
			const pnDevice = decoded.device !== undefined ? decoded.device : 0
			const deviceSpecificLid = `${lidUser}${!!pnDevice ? `:${pnDevice}` : ''}@lid`

			this.logger.trace({ pn, deviceSpecificLid, pnDevice }, `getLIDForPN: ${pn} → ${deviceSpecificLid} (user mapping with device ${pnDevice})`)
			successfulPairs[pn] = { lidUser: deviceSpecificLid, pnUser }
		}

		if (Object.keys(usyncFetch).length > 0) {
			const result = await this.pnToLIDFunc?.(Object.keys(usyncFetch)) // this function already adds LIDs to mapping
			if (result && result.length > 0) {
				this.storeLIDPNMappings(result)
				for (const pair of result) {
					const pnDecoded = jidDecode(pair.pnUser)
					const pnUser = pnDecoded?.user
					if (!pnUser) {
						continue
					}

					const lidUser = jidDecode(pair.lidUser)?.user
					if (!lidUser) {
						continue
					}

					for (const device of usyncFetch[pair.pnUser]) {
						const deviceSpecificLid = `${lidUser}${!!device ? `:${device}` : ''}@${device === 99 ? 'hosted.lid' : 'lid'}`

						this.logger.trace(
							{	pn: pair.pnUser, deviceSpecificLid, device },
							`getLIDForPN: USYNC success for ${pair.pnUser} → ${deviceSpecificLid} (user mapping with device ${device})`
						)

						const deviceSpecificPn = `${pnUser}${!!device ? `:${device}` : ''}@${device === 99 ? 'hosted' : 's.whatsapp.net'}`

						successfulPairs[deviceSpecificPn] = { lidUser: deviceSpecificLid, pnUser: deviceSpecificPn }
					}
				}
			} else {
				return null
			}
		}

		return Object.values(successfulPairs)
	}

	/**
	 * Get PN for LID - USER LEVEL with device construction
	 * @param lid - LID identifier
	 * @returns Promise<string | null> - Device-specific PN JID or null if not found
	 */
	async getPNForLID(lid: string): Promise<string | null> {
		try {
			if (!lid?.trim()) {
				logger.warn({ lid }, 'getPNForLID: Empty LID parameter')
				return null
			}

			const decoded: DecodedJid | null = this.validateAndDecodeJid(lid, 'lid')
			if (!decoded) {
				return null
			}

			const { user: lidUser, device: lidDevice = LID_MAPPING_CONSTANTS.DEFAULT_DEVICE } = decoded
			const reverseKey = `${lidUser}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`

			const stored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [reverseKey])
			const pnUser: string = stored[reverseKey]

			if (!pnUser || typeof pnUser !== 'string') {
				logger.trace({ lidUser }, 'No reverse mapping found for LID user')
				return null
			}

			const pnJid: string = this.createDeviceSpecificPN(pnUser, lidDevice)

			logger.trace({ lid, pnJid }, 'Found reverse mapping')
			return pnJid

		} catch (error) {
			logger.error({ error, lid }, 'Failed to get PN for LID')
			return null
		}
	}

	/**
	 * Remove LID-PN mapping for a given user
	 * @param userIdentifier - Can be either PN user or LID user
	 * @returns Promise<boolean> - Success status
	 */
	async removeLIDPNMapping(userIdentifier: string): Promise<boolean> {
		try {
			if (!userIdentifier?.trim()) {
				logger.warn({ userIdentifier }, 'removeLIDPNMapping: Empty user identifier')
				return false
			}

			const stored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [userIdentifier])
			const mappedUser: string = stored[userIdentifier]

			if (!mappedUser) {
				const reverseKey = `${userIdentifier}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`
				const reverseStored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [reverseKey])
				const reverseMappedUser: string = reverseStored[reverseKey]

				if (!reverseMappedUser) {
					logger.trace({ userIdentifier, reverseMappedUser }, 'No mapping found for user')
					return false
				}

				await this.keys.transaction(async() => {
					await this.keys.set({
						[LID_MAPPING_CONSTANTS.STORAGE_KEY]: {
							[userIdentifier]: null,
							[`${reverseMappedUser}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`]: null
						}
					})
				})
			} else {
				await this.keys.transaction(async() => {
					await this.keys.set({
						[LID_MAPPING_CONSTANTS.STORAGE_KEY]: {
							[userIdentifier]: null,
							[`${mappedUser}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`]: null
						}
					})
				})
			}

			logger.info({ userIdentifier }, 'LID-PN mapping removed for user')
			return true

		} catch (error) {
			logger.error({ error, userIdentifier }, 'Failed to remove LID-PN mapping')
			return false
		}
	}

	/**
	 * Check if a mapping exists for the given user
	 * @param userIdentifier - Either PN user or LID user
	 * @returns Promise<boolean> - Whether mapping exists
	 */
	async hasMappingForUser(userIdentifier: string): Promise<boolean> {
		try {
			if (!userIdentifier?.trim()) {
				return false
			}

			const stored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [userIdentifier])
			const mappedUser: string = stored[userIdentifier]

			if (mappedUser) {
				return true
			}

			const reverseKey = `${userIdentifier}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`
			const reverseStored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [reverseKey])
			return !!reverseStored[reverseKey]

		} catch (error) {
			logger.error({ error, userIdentifier }, 'Failed to check mapping existence')
			return false
		}
	}

	/**
	 * Get mapping statistics for debugging and monitoring
	 * @returns Promise<{ totalMappings: number; users: string[] }>
	 */
	async getMappingStats(): Promise<{ totalMappings: number; users: string[] }> {
		try {
			logger.trace({}, 'Getting mapping statistics...')
			return {
				totalMappings: 0,
				users: []
			}
		} catch (error) {
			logger.error({ error }, 'Failed to get mapping statistics')
			return { totalMappings: 0, users: [] }
		}
	}
}
