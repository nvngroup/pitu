import type { waproto } from '../../WAProto'

/**
 * Type guards and validators for safe protobuf field access
 * Eliminates the need for non-null assertions (!) throughout the codebase
 */

// ============================================================================
// MESSAGE KEY VALIDATORS
// ============================================================================

export function validateMessageKey(key: waproto.IMessageKey | null | undefined): asserts key is waproto.IMessageKey {
	if (!key) {
		throw new Error('MessageKey is null or undefined')
	}

	if (!key.remoteJid) {
		throw new Error('MessageKey.remoteJid is required')
	}

	if (!key.id) {
		throw new Error('MessageKey.id is required')
	}
}

export function hasValidMessageKey(key: waproto.IMessageKey | null | undefined): key is waproto.IMessageKey {
	return !!(key?.remoteJid && key.id)
}

// ============================================================================
// MESSAGE CONTENT VALIDATORS
// ============================================================================

export function assertMessageContent(content: waproto.IMessage | null | undefined): asserts content is waproto.IMessage {
	if (!content) {
		throw new Error('Message content is null or undefined')
	}
}

export function hasMessageContent(msg: waproto.IWebMessageInfo | null | undefined): msg is waproto.IWebMessageInfo & { message: waproto.IMessage } {
	return !!(msg?.message)
}

// ============================================================================
// MEDIA MESSAGE VALIDATORS
// ============================================================================

export function hasMediaKey(msg: { mediaKey?: Uint8Array | null }): msg is { mediaKey: Uint8Array } {
	return !!(msg.mediaKey && msg.mediaKey.length > 0)
}

export function hasDirectPath(msg: { directPath?: string | null }): msg is { directPath: string } {
	return !!(msg.directPath && msg.directPath.length > 0)
}

export function hasFileSha256(msg: { fileSha256?: Uint8Array | null }): msg is { fileSha256: Uint8Array } {
	return !!(msg.fileSha256 && msg.fileSha256.length > 0)
}

export function hasFileEncSha256(msg: { fileEncSha256?: Uint8Array | null }): msg is { fileEncSha256: Uint8Array } {
	return !!(msg.fileEncSha256 && msg.fileEncSha256.length > 0)
}

export function assertMediaKey(msg: { mediaKey?: Uint8Array | null }, context = 'Message'): asserts msg is { mediaKey: Uint8Array } {
	if (!hasMediaKey(msg)) {
		throw new Error(`${context} does not have a valid mediaKey`)
	}
}

export function assertDirectPath(msg: { directPath?: string | null }, context = 'Message'): asserts msg is { directPath: string } {
	if (!hasDirectPath(msg)) {
		throw new Error(`${context} does not have a valid directPath`)
	}
}

// ============================================================================
// CONTEXT INFO VALIDATORS
// ============================================================================

export function hasQuotedMessage(ctx: waproto.IContextInfo | null | undefined): ctx is waproto.IContextInfo & { quotedMessage: waproto.IMessage } {
	return !!(ctx?.quotedMessage)
}

export function hasContextStanzaId(ctx: waproto.IContextInfo | null | undefined): ctx is waproto.IContextInfo & { stanzaId: string } {
	return !!(ctx?.stanzaId)
}

export function hasPlaceholderKey(ctx: waproto.IContextInfo | null | undefined): ctx is waproto.IContextInfo & { placeholderKey: waproto.IMessageKey } {
	return !!(ctx?.placeholderKey && hasValidMessageKey(ctx.placeholderKey))
}

// ============================================================================
// SPECIFIC MESSAGE TYPE GUARDS
// ============================================================================

export function isImageMessage(msg: waproto.IMessage): msg is waproto.IMessage & { imageMessage: waproto.Message.IImageMessage } {
	return !!(msg.imageMessage)
}

export function isVideoMessage(msg: waproto.IMessage): msg is waproto.IMessage & { videoMessage: waproto.Message.IVideoMessage } {
	return !!(msg.videoMessage)
}

export function isAudioMessage(msg: waproto.IMessage): msg is waproto.IMessage & { audioMessage: waproto.Message.IAudioMessage } {
	return !!(msg.audioMessage)
}

export function isDocumentMessage(msg: waproto.IMessage): msg is waproto.IMessage & { documentMessage: waproto.Message.IDocumentMessage } {
	return !!(msg.documentMessage)
}

export function isStickerMessage(msg: waproto.IMessage): msg is waproto.IMessage & { stickerMessage: waproto.Message.IStickerMessage } {
	return !!(msg.stickerMessage)
}

export function isExtendedTextMessage(msg: waproto.IMessage): msg is waproto.IMessage & { extendedTextMessage: waproto.Message.IExtendedTextMessage } {
	return !!(msg.extendedTextMessage)
}

export function isContactMessage(msg: waproto.IMessage): msg is waproto.IMessage & { contactMessage: waproto.Message.IContactMessage } {
	return !!(msg.contactMessage)
}

export function isLocationMessage(msg: waproto.IMessage): msg is waproto.IMessage & { locationMessage: waproto.Message.ILocationMessage } {
	return !!(msg.locationMessage)
}

export function isProtocolMessage(msg: waproto.IMessage): msg is waproto.IMessage & { protocolMessage: waproto.Message.IProtocolMessage } {
	return !!(msg.protocolMessage)
}

export function isReactionMessage(msg: waproto.IMessage): msg is waproto.IMessage & { reactionMessage: waproto.Message.IReactionMessage } {
	return !!(msg.reactionMessage)
}

// ============================================================================
// BUFFER VALIDATION
// ============================================================================

/**
 * Safely converts content to Buffer with validation
 */
export function toBuffer(content: unknown): Buffer {
	if (Buffer.isBuffer(content)) {
		return content
	}

	if (content instanceof Uint8Array) {
		return Buffer.from(content)
	}

	throw new Error(`Cannot convert to Buffer: expected Buffer or Uint8Array, got ${typeof content}`)
}

/**
 * Type guard for Buffer or Uint8Array
 */
export function isBufferLike(value: unknown): value is Buffer | Uint8Array {
	return Buffer.isBuffer(value) || value instanceof Uint8Array
}

// ============================================================================
// IDENTITY KEY VALIDATORS
// ============================================================================

export function hasIdentityKey(identity: { identityKey?: Uint8Array | null }): identity is { identityKey: Uint8Array } {
	return !!(identity.identityKey && identity.identityKey.length > 0)
}

export function assertIdentityKey(identity: { identityKey?: Uint8Array | null }, context = 'Identity'): asserts identity is { identityKey: Uint8Array } {
	if (!hasIdentityKey(identity)) {
		throw new Error(`${context} does not have a valid identityKey`)
	}
}

// ============================================================================
// KEY ID VALIDATORS
// ============================================================================

export function hasKeyId(key: { id?: Uint8Array | null }): key is { id: Uint8Array } {
	return !!(key.id && key.id.length > 0)
}

export function assertKeyId(key: { id?: Uint8Array | null }, context = 'Key'): asserts key is { id: Uint8Array } {
	if (!hasKeyId(key)) {
		throw new Error(`${context} does not have a valid id`)
	}
}

// ============================================================================
// DEVICE IDENTITY VALIDATORS
// ============================================================================

export function hasAccountSignatureKey(device: { accountSignatureKey?: Uint8Array | null }): device is { accountSignatureKey: Uint8Array } {
	return !!(device.accountSignatureKey && device.accountSignatureKey.length > 0)
}

export function hasAccountSignature(device: { accountSignature?: Uint8Array | null }): device is { accountSignature: Uint8Array } {
	return !!(device.accountSignature && device.accountSignature.length > 0)
}

export function hasDetails(device: { details?: Uint8Array | null }): device is { details: Uint8Array } {
	return !!(device.details && device.details.length > 0)
}

// ============================================================================
// POLL AND EVENT MESSAGE VALIDATORS
// ============================================================================

export function hasPollCreationMessageKey(msg: { pollCreationMessageKey?: waproto.IMessageKey | null }): msg is { pollCreationMessageKey: waproto.IMessageKey } {
	return !!(msg.pollCreationMessageKey && hasValidMessageKey(msg.pollCreationMessageKey))
}

export function assertPollCreationMessageKey(msg: { pollCreationMessageKey?: waproto.IMessageKey | null }): asserts msg is { pollCreationMessageKey: waproto.IMessageKey } {
	if (!hasPollCreationMessageKey(msg)) {
		throw new Error('Poll update message does not have a valid pollCreationMessageKey')
	}
}

export function hasEventCreationMessageKey(msg: { eventCreationMessageKey?: waproto.IMessageKey | null }): msg is { eventCreationMessageKey: waproto.IMessageKey } {
	return !!(msg.eventCreationMessageKey && hasValidMessageKey(msg.eventCreationMessageKey))
}

export function assertEventCreationMessageKey(msg: { eventCreationMessageKey?: waproto.IMessageKey | null }): asserts msg is { eventCreationMessageKey: waproto.IMessageKey } {
	if (!hasEventCreationMessageKey(msg)) {
		throw new Error('Event response message does not have a valid eventCreationMessageKey')
	}
}

export function hasPollEncKey(msg: { messageSecret?: Uint8Array | null }): msg is { messageSecret: Uint8Array } {
	return !!(msg.messageSecret && msg.messageSecret.length > 0)
}

export function assertPollEncKey(msg: { messageSecret?: Uint8Array | null }): asserts msg is { messageSecret: Uint8Array } {
	if (!hasPollEncKey(msg)) {
		throw new Error('Poll message does not have a valid messageSecret')
	}
}

export function hasPollVote(msg: { vote?: waproto.Message.IPollEncValue | null }): msg is { vote: waproto.Message.IPollEncValue } {
	return !!(msg.vote)
}

export function assertPollVote(msg: { vote?: waproto.Message.IPollEncValue | null }): asserts msg is { vote: waproto.Message.IPollEncValue } {
	if (!hasPollVote(msg)) {
		throw new Error('Poll update message does not have a valid vote')
	}
}

// ============================================================================
// PROTOCOL MESSAGE VALIDATORS
// ============================================================================

export function hasProtocolMessageKey(msg: { key?: waproto.IMessageKey | null }): msg is { key: waproto.IMessageKey } {
	return !!(msg.key?.id)
}

export function assertProtocolMessageKey(msg: { key?: waproto.IMessageKey | null }, context = 'Protocol message'): asserts msg is { key: waproto.IMessageKey } {
	if (!hasProtocolMessageKey(msg)) {
		throw new Error(`${context} does not have a valid key`)
	}
}

export function hasStanzaId(msg: { stanzaId?: string | null }): msg is { stanzaId: string } {
	return !!(msg.stanzaId && msg.stanzaId.length > 0)
}

export function assertStanzaId(msg: { stanzaId?: string | null }, context = 'Message'): asserts msg is { stanzaId: string } {
	if (!hasStanzaId(msg)) {
		throw new Error(`${context} does not have a valid stanzaId`)
	}
}

// ============================================================================
// FUTUREPROOF MESSAGE HELPERS
// ============================================================================

export function getFutureProofContent(message: waproto.IMessage | null | undefined): waproto.IMessage | null {
	if (!message) {
		return null
	}

	const futureProofMsg = message.ephemeralMessage
		|| message.viewOnceMessage
		|| message.documentWithCaptionMessage
		|| message.viewOnceMessageV2
		|| message.viewOnceMessageV2Extension
		|| message.editedMessage

	if (futureProofMsg?.message) {
		return futureProofMsg.message
	}

	return null
}

/**
 * Recursively extracts the actual message from FutureProofMessage wrappers
 */
export function unwrapFutureProofMessage(message: waproto.IMessage | null | undefined): waproto.IMessage | null {
	if (!message) {
		return null
	}

	let current = message
	let depth = 0
	const maxDepth = 10 // Prevent infinite loops

	while (depth < maxDepth) {
		const futureProof = getFutureProofContent(current)
		if (!futureProof) {
			break
		}

		current = futureProof
		depth++
	}

	return current
}
