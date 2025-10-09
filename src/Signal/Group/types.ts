import { SenderKeyName } from './sender-key-name'
import { SenderKeyRecord } from './sender-key-record'

export interface SenderKeyStore {
  loadSenderKey(senderKeyName: SenderKeyName): Promise<SenderKeyRecord>
  storeSenderKey(senderKeyName: SenderKeyName, record: SenderKeyRecord): Promise<void>
}

export const GROUP_CONSTANTS = {
	MAX_MESSAGE_KEYS: 2000,
	MAX_SENDER_KEY_STATES: 5,
	MAX_FUTURE_MESSAGES: 2000,
	QUEUE_GC_LIMIT: 10000
} as const

export interface SenderKeyDistributionMessageStructure {
		id: number
		iteration: number
		chainKey: string | Uint8Array
		signingKey: string | Uint8Array
}

export interface SenderKeyMessageStructure {
		id: number
		iteration: number
		ciphertext: string | Buffer
}

export interface Sender {
	id: string
	deviceId: number
	toString(): string
}

export interface SenderChainKeyStructure {
	iteration: number
	seed: Uint8Array
}

export interface SenderSigningKeyStructure {
	public: Uint8Array
	private?: Uint8Array
}

export interface SenderMessageKeyStructure {
	iteration: number
	seed: Uint8Array
}

export interface SenderKeyStateStructure {
	senderKeyId: number
	senderChainKey: SenderChainKeyStructure
	senderSigningKey: SenderSigningKeyStructure
	senderMessageKeys: SenderMessageKeyStructure[]
}
