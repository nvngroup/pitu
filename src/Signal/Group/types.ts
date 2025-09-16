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
