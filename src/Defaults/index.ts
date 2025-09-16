import { waproto } from '../../WAProto'
import { makeLibSignalRepository } from '../Signal/libsignal'
import type { AuthenticationState, MediaType, SocketConfig, WAVersion } from '../Types'
import { Browsers } from '../Utils'
import logger from '../Utils/logger'
import { version } from './baileys-version.json'

export const UNAUTHORIZED_CODES = [401, 403, 419]

export const DEFAULT_ORIGIN = 'https://web.whatsapp.com'
export const CALL_VIDEO_PREFIX = 'https://call.whatsapp.com/video/'
export const CALL_AUDIO_PREFIX = 'https://call.whatsapp.com/voice/'
export const DEF_CALLBACK_PREFIX = 'CB:'
export const DEF_TAG_PREFIX = 'TAG:'
export const PHONE_CONNECTION_CB = 'CB:Pong'

export const WA_DEFAULT_EPHEMERAL = 7 * 24 * 60 * 60

export const NOISE_MODE = 'Noise_XX_25519_AESGCM_SHA256\0\0\0\0'
export const DICT_VERSION = 2
export const KEY_BUNDLE_TYPE = Buffer.from([5])
export const NOISE_WA_HEADER = Buffer.from(
	[ 87, 65, 6, DICT_VERSION ]
)

export const URL_REGEX = /https:\/\/(?![^:@\/\s]+:[^:@\/\s]+@)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?(\/[^\s]*)?/g

export const WA_CERT_DETAILS = {
	SERIAL: 0,
}

export const PROCESSABLE_HISTORY_TYPES = [
	waproto.Message.HistorySyncNotification.HistorySyncType.INITIAL_BOOTSTRAP,
	waproto.Message.HistorySyncNotification.HistorySyncType.PUSH_NAME,
	waproto.Message.HistorySyncNotification.HistorySyncType.RECENT,
	waproto.Message.HistorySyncNotification.HistorySyncType.FULL,
	waproto.Message.HistorySyncNotification.HistorySyncType.ON_DEMAND,
]

export const DEFAULT_CONNECTION_CONFIG: SocketConfig = {
	version: version as WAVersion,
	browser: Browsers.ubuntu('Chrome'),
	waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat',
	connectTimeoutMs: 120_000,
	keepAliveIntervalMs: 120_000,
	logger: logger.child({ class: 'baileys' }),
	emitOwnEvents: true,
	defaultQueryTimeoutMs: 120_000,
	customUploadHosts: [],
	retryRequestDelayMs: 500,
	maxMsgRetryCount: 5,
	fireInitQueries: false,
	auth: undefined as unknown as AuthenticationState,
	markOnlineOnConnect: true,
	syncFullHistory: false,
	patchMessageBeforeSending: msg => msg,
	shouldSyncHistoryMessage: () => true,
	shouldIgnoreJid: () => false,
	linkPreviewImageThumbnailWidth: 192,
	transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
	generateHighQualityLinkPreview: false,
	options: { },
	appStateMacVerification: {
		patch: false,
		snapshot: false,
	},
	countryCode: 'BR',
	getMessage: async() => undefined,
	cachedGroupMetadata: async() => undefined,
	makeSignalRepository: makeLibSignalRepository
}

export const MEDIA_PATH_MAP: { [T in MediaType]?: string } = {
	image: '/mms/image',
	video: '/mms/video',
	document: '/mms/document',
	audio: '/mms/audio',
	sticker: '/mms/image',
	'thumbnail-link': '/mms/image',
	'product-catalog-image': '/product/image',
	'md-app-state': '',
	'md-msg-hist': '/mms/md-app-state',
}

export const MEDIA_HKDF_KEY_MAPPING = {
	'audio': 'Audio',
	'document': 'Document',
	'gif': 'Video',
	'image': 'Image',
	'ppic': '',
	'product': 'Image',
	'ptt': 'Audio',
	'sticker': 'Image',
	'video': 'Video',
	'thumbnail-document': 'Document Thumbnail',
	'thumbnail-image': 'Image Thumbnail',
	'thumbnail-video': 'Video Thumbnail',
	'thumbnail-link': 'Link Thumbnail',
	'md-msg-hist': 'History',
	'md-app-state': 'App State',
	'product-catalog-image': '',
	'payment-bg-image': 'Payment Background',
	'ptv': 'Video'
}

export const MEDIA_KEYS = Object.keys(MEDIA_PATH_MAP) as MediaType[]

export const MIN_PREKEY_COUNT = 5

export const INITIAL_PREKEY_COUNT = 30

export const UPLOAD_TIMEOUT = 30000 // 30 seconds
export const MIN_UPLOAD_INTERVAL = 5000 // 5 seconds minimum between uploads

export const DEFAULT_CACHE_TTLS = {
	SIGNAL_STORE: 60 * 60, // 1 hour
	MSG_RETRY: 60 * 60, // 1 hour
	CALL_OFFER: 5 * 60, // 5 minutes
	USER_DEVICES: 15 * 60, // 15 minutes
	ON_WHATSAPP: 24 * 60 * 60, // 24 hours
	PLACEHOLDER_RESEND: 60 * 60, // 1 hour
}
