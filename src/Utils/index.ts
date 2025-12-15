export * from './auth-utils'
export * from './bad-mac-recovery'
export * from './baileys-event-stream'
export * from './chat-utils'
export * from './crypto'
export * from './decode-wa-message'
export * from './event-buffer'
export * from './fallback-decryption'
export * from './generics'
export * from './history'
export * from './link-preview'
export * from './lt-hash'
export * from './mac-error-handler'
export * from './messages'
export * from './messages-media'
export * from './message-relay-mutex'
export * from './message-type-detector'
export * from './noise-handler'
export * from './process-message'
export * from './session-error-handler'
export * from './signal'
export * from './use-multi-file-auth-state'
export * from './validate-connection'

// Export proto-guards separately to avoid name conflicts
export {
	validateMessageKey,
	hasValidMessageKey,
	assertMessageContent,
	hasMessageContent,
	hasMediaKey,
	hasDirectPath,
	hasFileSha256,
	hasFileEncSha256,
	assertMediaKey,
	assertDirectPath,
	hasQuotedMessage,
	hasContextStanzaId,
	hasPlaceholderKey,
	isImageMessage,
	isVideoMessage,
	isAudioMessage,
	isDocumentMessage,
	isStickerMessage,
	isExtendedTextMessage,
	isContactMessage,
	isLocationMessage,
	isProtocolMessage,
	isReactionMessage,
	toBuffer as protoToBuffer,
	isBufferLike,
	hasIdentityKey,
	assertIdentityKey,
	hasKeyId,
	assertKeyId,
	hasAccountSignatureKey,
	hasAccountSignature,
	hasDetails,
	hasPollCreationMessageKey,
	assertPollCreationMessageKey,
	hasEventCreationMessageKey,
	assertEventCreationMessageKey,
	hasPollEncKey,
	assertPollEncKey,
	hasPollVote,
	assertPollVote,
	hasProtocolMessageKey,
	assertProtocolMessageKey,
	assertStanzaId,
	getFutureProofContent,
	getUserId,
	getUserLid,
	hasUserCredentials,
	getAccount,
	unwrapFutureProofMessage
} from './proto-guards'
