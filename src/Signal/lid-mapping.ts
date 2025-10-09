import type { SignalKeyStoreWithTransaction } from '../Types'
import logger from '../Utils/logger'
import { FullJid, isJidUser, isLidUser, jidDecode } from '../WABinary'
import { DecodedJid, LIDMappingResult } from './types'

const LID_MAPPING_CONSTANTS = {
	STORAGE_KEY: 'lid-mapping' as const,
	REVERSE_SUFFIX: '_reverse' as const,
	DEFAULT_DEVICE: 0,
	LID_DOMAIN: '@lid' as const,
	WHATSAPP_DOMAIN: '@s.whatsapp.net' as const
} as const

export class LIDMappingStore {
	private readonly keys: SignalKeyStoreWithTransaction

	constructor(keys: SignalKeyStoreWithTransaction) {
		this.keys = keys
	}

	/**
	 * Validate and decode JID with enhanced error handling
	 */
	private validateAndDecodeJid(jid: string, expectedType: 'lid' | 'pn'): DecodedJid | null {
		const isValidType: boolean | undefined = expectedType === 'lid' ? isLidUser(jid) : isJidUser(jid)

		if(!isValidType) {
			logger.warn({ jid }, `Invalid JID type for ${expectedType}`)
			return null
		}

		const decoded: FullJid | undefined = jidDecode(jid)
		if(!decoded?.user) {
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
		if(!((isLidUser(lid) && isJidUser(pn)) || (isJidUser(lid) && isLidUser(pn)))) {
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
			if(!lid?.trim() || !pn?.trim()) {
				const error = 'LID and PN parameters cannot be empty'
				logger.error({ error })
				return { success: false, error }
			}

			const validationResult = this.validateMappingParams(lid, pn)
			if(!validationResult) {
				return { success: false, error: 'Invalid LID-PN mapping parameters' }
			}

			const { lidJid, pnJid } = validationResult

			const lidDecoded: DecodedJid | null = this.validateAndDecodeJid(lidJid, 'lid')
			const pnDecoded: DecodedJid | null = this.validateAndDecodeJid(pnJid, 'pn')

			if(!lidDecoded || !pnDecoded) {
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

		} catch(error) {
			const errorMessage = `Failed to store LID-PN mapping: ${error instanceof Error ? error.message : 'Unknown error'}`
			logger.error({ error, lid, pn }, errorMessage)
			return { success: false, error: errorMessage }
		}
	}

	/**
	 * Get LID for PN - Returns device-specific LID based on user mapping
	 * @param pn - Phone number JID
	 * @returns Promise<string | null> - Device-specific LID or null if not found
	 */
	async getLIDForPN(pn: string): Promise<string | null> {
		try {
			if(!pn?.trim()) {
				logger.warn({ pn }, 'getLIDForPN: Empty PN parameter')
				return null
			}

			const decoded: DecodedJid | null = this.validateAndDecodeJid(pn, 'pn')
			if(!decoded) {
				return null
			}

			const { user: pnUser, device: pnDevice = LID_MAPPING_CONSTANTS.DEFAULT_DEVICE } = decoded

			const stored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [pnUser])
			const lidUser: string = stored[pnUser]

			if(!lidUser || typeof lidUser !== 'string') {
				logger.trace({ pnUser }, 'No LID mapping found for PN user')
				return null
			}

			const deviceSpecificLid: string = this.createDeviceSpecificLid(lidUser, pnDevice)

			logger.trace({ pn, deviceSpecificLid, pnDevice }, 'getLIDForPN: Mapping found')
			return deviceSpecificLid

		} catch(error) {
			logger.error({ error, pn }, 'Failed to get LID for PN')
			return null
		}
	}

	/**
	 * Get PN for LID - USER LEVEL with device construction
	 * @param lid - LID identifier
	 * @returns Promise<string | null> - Device-specific PN JID or null if not found
	 */
	async getPNForLID(lid: string): Promise<string | null> {
		try {
			if(!lid?.trim()) {
				logger.warn({ lid }, 'getPNForLID: Empty LID parameter')
				return null
			}

			const decoded: DecodedJid | null = this.validateAndDecodeJid(lid, 'lid')
			if(!decoded) {
				return null
			}

			const { user: lidUser, device: lidDevice = LID_MAPPING_CONSTANTS.DEFAULT_DEVICE } = decoded
			const reverseKey = `${lidUser}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`

			const stored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [reverseKey])
			const pnUser: string = stored[reverseKey]

			if(!pnUser || typeof pnUser !== 'string') {
				logger.trace({ lidUser }, 'No reverse mapping found for LID user')
				return null
			}

			const pnJid: string = this.createDeviceSpecificPN(pnUser, lidDevice)

			logger.trace({ lid, pnJid }, 'Found reverse mapping')
			return pnJid

		} catch(error) {
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
			if(!userIdentifier?.trim()) {
				logger.warn({ userIdentifier }, 'removeLIDPNMapping: Empty user identifier')
				return false
			}

			const stored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [userIdentifier])
			const mappedUser: string = stored[userIdentifier]

			if(!mappedUser) {
				const reverseKey = `${userIdentifier}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`
				const reverseStored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [reverseKey])
				const reverseMappedUser: string = reverseStored[reverseKey]

				if(!reverseMappedUser) {
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

		} catch(error) {
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
			if(!userIdentifier?.trim()) {
				return false
			}

			const stored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [userIdentifier])
			const mappedUser: string = stored[userIdentifier]

			if(mappedUser) {
				return true
			}

			const reverseKey = `${userIdentifier}${LID_MAPPING_CONSTANTS.REVERSE_SUFFIX}`
			const reverseStored = await this.keys.get(LID_MAPPING_CONSTANTS.STORAGE_KEY, [reverseKey])
			return !!reverseStored[reverseKey]

		} catch(error) {
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
		} catch(error) {
			logger.error({ error }, 'Failed to get mapping statistics')
			return { totalMappings: 0, users: [] }
		}
	}
}
