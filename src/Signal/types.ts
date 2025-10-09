export interface LIDMapping {
 pnUser: string
 lidUser: string
}

export interface LIDMappingResult {
 success: boolean
 mapping?: LIDMapping
 error?: string
}

export interface DecodedJid {
 user: string
 device?: number
}

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
