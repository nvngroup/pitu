import { AxiosRequestConfig } from 'axios'
import { waproto } from '../../WAProto'
import { BaileysEvent, BaileysEventEmitter, BaileysEventMap, ChatMutation, MediaType, WAMediaUpload } from '../Types'

export interface BadMACError {
 jid: string
 type: '1:1' | 'group'
 authorJid?: string
 timestamp: number
 attempt: number
 stackTrace: string
}

export type FetchAppStateSyncKey = (keyId: string) => Promise<waproto.Message.IAppStateSyncKeyData | null | undefined>

export type ChatMutationMap = { [index: string]: ChatMutation }

export const NO_MESSAGE_FOUND_ERROR_TEXT = 'Message absent from node'
export const MISSING_KEYS_ERROR_TEXT = 'Key used already or never filled'

export const NACK_REASONS = {
	ParsingError: 487,
	UnrecognizedStanza: 488,
	UnrecognizedStanzaClass: 489,
	UnrecognizedStanzaType: 490,
	InvalidProtobuf: 491,
	InvalidHostedCompanionStanza: 493,
	MissingMessageSecret: 495,
	SignalErrorOldCounter: 496,
	MessageDeletedOnPeer: 499,
	UnhandledError: 500,
	UnsupportedAdminRevoke: 550,
	UnsupportedLIDGroup: 551,
	DBOperationFailed: 552
}

export type MessageType = 'chat' | 'peer_broadcast' | 'other_broadcast' | 'group' | 'direct_peer_status' | 'other_status' | 'newsletter'

export type MediaDownloadOptions = {
 startByte?: number
 endByte?: number
 options?: AxiosRequestConfig<{}>
}

export const BUFFERABLE_EVENT = [
	'messaging-history.set',
	'chats.upsert',
	'chats.update',
	'chats.delete',
	'contacts.upsert',
	'contacts.update',
	'messages.upsert',
	'messages.update',
	'messages.delete',
	'messages.reaction',
	'message-receipt.update',
	'groups.update',
] as const

export type BufferableEvent = typeof BUFFERABLE_EVENT[number]

/**
 * A map that contains a list of all events that have been triggered
 *
 * Note, this can contain different type of events
 * this can make processing events extremely efficient -- since everything
 * can be done in a single transaction
 */
export type BaileysEventData = Partial<BaileysEventMap>

export const BUFFERABLE_EVENT_SET = new Set<BaileysEvent>(BUFFERABLE_EVENT)

export type BaileysBufferableEventEmitter = BaileysEventEmitter & {
 process(handler: (events: BaileysEventData) => void | Promise<void>): (() => void)
 /**
  * starts buffering events, call flush() to release them
  * */
 buffer(): void
 /** buffers all events till the promise completes */
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 createBufferedFunction<A extends any[], T>(work: (...args: A) => Promise<T>): ((...args: A) => Promise<T>)
 /**
  * flushes all buffered events
  * @param force if true, will flush all data regardless of any pending buffers
  * @returns returns true if the flush actually happened, otherwise false
  */
 flush(): boolean
 isBuffering(): boolean
}

export interface MACErrorInfo {
 jid: string
 errorType: 'bad_mac' | 'invalid_mac' | 'mac_verification_failed'
 originalError: string
 timestamp: number
 attemptCount: number
}

export type MediaUploadData = {
	media: WAMediaUpload
	caption?: string
	ptt?: boolean
	ptv?: boolean
	seconds?: number
	gifPlayback?: boolean
	fileName?: string
	jpegThumbnail?: string
	mimetype?: string
	width?: number
	height?: number
	waveform?: Uint8Array
	backgroundArgb?: number
}

export const MIMETYPE_MAP: { [T in MediaType]?: string } = {
	image: 'image/jpeg',
	video: 'video/mp4',
	document: 'application/pdf',
	audio: 'audio/ogg; codecs=opus',
	sticker: 'image/webp',
	'product-catalog-image': 'image/jpeg',
}

export const MessageTypeProto = {
	'image': waproto.Message.ImageMessage,
	'video': waproto.Message.VideoMessage,
	'audio': waproto.Message.AudioMessage,
	'sticker': waproto.Message.StickerMessage,
	'document': waproto.Message.DocumentMessage,
} as const

export const ButtonType = waproto.Message.ButtonsMessage.HeaderType

export interface SessionDiagnosticResult {
	jid: string
	hasSession: boolean
	hasPreKeys: boolean
	hasIdentityKey: boolean
	hasSenderKey?: boolean
	sessionAge?: number
	lastError?: string
	recommendation: string
	canRecover: boolean
}

export interface SessionHealth {
	healthy: number
	corrupted: number
	missing: number
	total: number
	score: number
}

export interface SessionErrorInfo {
	jid: string
	errorType: 'bad_mac' | 'session_corrupt' | 'key_missing' | 'unknown'
	originalError: string
	timestamp: number
}
