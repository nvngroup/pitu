import type { SignalKeyStoreWithTransaction } from '../Types'
import logger from '../Utils/logger'
import { isJidUser, isLidUser, jidDecode } from '../WABinary'

export class LIDMappingStore {
	private readonly keys: SignalKeyStoreWithTransaction

	constructor(keys: SignalKeyStoreWithTransaction) {
		this.keys = keys
	}

	/**
  * Store LID-PN mapping - USER LEVEL
  */
	async storeLIDPNMapping(lid: string, pn: string): Promise<void> {
		if(!((isLidUser(lid) && isJidUser(pn)) || (isJidUser(lid) && isLidUser(pn)))) {
			logger.warn(`Invalid LID-PN mapping: ${lid}, ${pn}`)
			return
		}

		const [lidJid, pnJid] = isLidUser(lid) ? [lid, pn] : [pn, lid]

		const lidDecoded = jidDecode(lidJid)
		const pnDecoded = jidDecode(pnJid)

		if(!lidDecoded || !pnDecoded) {
			return
		}

		const pnUser = pnDecoded.user
		const lidUser = lidDecoded.user

		logger.trace(`Storing USER LID mapping: PN ${pnUser} → LID ${lidUser}`)

		await this.keys.transaction(async() => {
			await this.keys.set({
				'lid-mapping': {
					[pnUser]: lidUser,
					[`${lidUser}_reverse`]: pnUser
				}
			})
		})

		logger.trace(`USER LID mapping stored: PN ${pnUser} → LID ${lidUser}`)
	}

	/**
  * Get LID for PN - Returns device-specific LID based on user mapping
  */
	async getLIDForPN(pn: string): Promise<string | null> {
		if(!isJidUser(pn)) {
			return null
		}

		const decoded = jidDecode(pn)
		if(!decoded) {
			return null
		}

		const pnUser = decoded.user
		const stored = await this.keys.get('lid-mapping', [pnUser])
		const lidUser = stored[pnUser]

		if(!lidUser) {
			logger.trace(`No LID mapping found for PN user ${pnUser}`)
			return null
		}

		if(typeof lidUser !== 'string') {
			return null
		}

		const pnDevice = decoded.device !== undefined ? decoded.device : 0
		const deviceSpecificLid = `${lidUser}:${pnDevice}@lid`

		logger.trace(`getLIDForPN: ${pn} → ${deviceSpecificLid} (user mapping with device ${pnDevice})`)
		return deviceSpecificLid
	}

	/**
  * Get PN for LID - USER LEVEL with device construction
  */
	async getPNForLID(lid: string): Promise<string | null> {
		if(!isLidUser(lid)) {
			return null
		}

		const decoded = jidDecode(lid)
		if(!decoded) {
			return null
		}

		const lidUser = decoded.user
		const stored = await this.keys.get('lid-mapping', [`${lidUser}_reverse`])
		const pnUser = stored[`${lidUser}_reverse`]

		if(!pnUser || typeof pnUser !== 'string') {
			logger.trace(`No reverse mapping found for LID user: ${lidUser}`)
			return null
		}

		const lidDevice = decoded.device !== undefined ? decoded.device : 0
		const pnJid = `${pnUser}:${lidDevice}@s.whatsapp.net`

		logger.trace(`Found reverse mapping: ${lid} → ${pnJid}`)
		return pnJid
	}
}
