import type { waproto } from '../../WAProto'
import { MediaType } from '../Types'

/**
 * Centralized message type detection utilities
 * Consolidates duplicated logic across the codebase
 */

export class MessageTypeDetector {
	/**
	 * Gets the media type from a message
	 */
	static getMediaType(msg: waproto.IMessage): MediaType | null {
		if (msg.imageMessage) {
			return 'image'
		}

		if (msg.videoMessage) {
			return msg.videoMessage.gifPlayback ? 'gif' : 'video'
		}

		if (msg.audioMessage) {
			return 'audio'
		}

		if (msg.documentMessage) {
			return 'document'
		}

		if (msg.stickerMessage) {
			return 'sticker'
		}

		return null
	}

	/**
	 * Checks if a message is a media message
	 */
	static isMediaMessage(msg: waproto.IMessage): boolean {
		return !!(
			msg.imageMessage ||
			msg.videoMessage ||
			msg.audioMessage ||
			msg.documentMessage ||
			msg.stickerMessage
		)
	}

	/**
	 * Checks if a message is a text message
	 */
	static isTextMessage(msg: waproto.IMessage): boolean {
		return !!(msg.conversation || msg.extendedTextMessage)
	}

	/**
	 * Gets the text content from any text-like message
	 */
	static getTextContent(msg: waproto.IMessage): string | null {
		if (msg.conversation) {
			return msg.conversation
		}

		if (msg.extendedTextMessage?.text) {
			return msg.extendedTextMessage.text
		}

		return null
	}

	/**
	 * Checks if a message is interactive (buttons, lists, etc)
	 */
	static isInteractiveMessage(msg: waproto.IMessage): boolean {
		return !!(
			msg.buttonsMessage ||
			msg.listMessage ||
			msg.interactiveMessage
		)
	}

	/**
	 * Checks if a message has a quoted/replied message
	 */
	static hasQuotedMessage(msg: waproto.IMessage): boolean {
		return !!(
			msg.extendedTextMessage?.contextInfo?.quotedMessage ||
			msg.imageMessage?.contextInfo?.quotedMessage ||
			msg.videoMessage?.contextInfo?.quotedMessage ||
			msg.audioMessage?.contextInfo?.quotedMessage ||
			msg.documentMessage?.contextInfo?.quotedMessage
		)
	}

	/**
	 * Gets the downloadable message content if any
	 */
	static getDownloadableMessage(msg: waproto.IMessage): unknown {
		if (msg.imageMessage) {
			return msg.imageMessage
		}

		if (msg.videoMessage) {
			return msg.videoMessage
		}

		if (msg.audioMessage) {
			return msg.audioMessage
		}

		if (msg.documentMessage) {
			return msg.documentMessage
		}

		if (msg.stickerMessage) {
			return msg.stickerMessage
		}

		return null
	}

	/**
	 * Gets the message type as a string
	 */
	static getMessageType(msg: waproto.IMessage): string {
		if (msg.conversation) {
			return 'conversation'
		}

		if (msg.imageMessage) {
			return 'imageMessage'
		}

		if (msg.videoMessage) {
			return 'videoMessage'
		}

		if (msg.audioMessage) {
			return 'audioMessage'
		}

		if (msg.documentMessage) {
			return 'documentMessage'
		}

		if (msg.stickerMessage) {
			return 'stickerMessage'
		}

		if (msg.extendedTextMessage) {
			return 'extendedTextMessage'
		}

		if (msg.contactMessage) {
			return 'contactMessage'
		}

		if (msg.locationMessage) {
			return 'locationMessage'
		}

		if (msg.protocolMessage) {
			return 'protocolMessage'
		}

		if (msg.reactionMessage) {
			return 'reactionMessage'
		}

		if (msg.buttonsMessage) {
			return 'buttonsMessage'
		}

		if (msg.listMessage) {
			return 'listMessage'
		}

		if (msg.interactiveMessage) {
			return 'interactiveMessage'
		}

		if (msg.pollCreationMessage) {
			return 'pollCreationMessage'
		}

		if (msg.pollUpdateMessage) {
			return 'pollUpdateMessage'
		}

		if (msg.liveLocationMessage) {
			return 'liveLocationMessage'
		}

		if (msg.templateMessage) {
			return 'templateMessage'
		}

		if (msg.senderKeyDistributionMessage) {
			return 'senderKeyDistributionMessage'
		}

		if (msg.groupInviteMessage) {
			return 'groupInviteMessage'
		}

		if (msg.orderMessage) {
			return 'orderMessage'
		}

		if (msg.productMessage) {
			return 'productMessage'
		}

		if (msg.invoiceMessage) {
			return 'invoiceMessage'
		}

		if (msg.callLogMesssage) {
			return 'callLogMesssage'
		}

		if (msg.eventMessage) {
			return 'eventMessage'
		}

		// Check for wrapped messages
		if (msg.ephemeralMessage) {
			return 'ephemeralMessage'
		}

		if (msg.viewOnceMessage) {
			return 'viewOnceMessage'
		}

		if (msg.documentWithCaptionMessage) {
			return 'documentWithCaptionMessage'
		}

		if (msg.viewOnceMessageV2) {
			return 'viewOnceMessageV2'
		}

		if (msg.editedMessage) {
			return 'editedMessage'
		}

		return 'unknown'
	}

	/**
	 * Checks if a message is ephemeral/disappearing
	 */
	static isEphemeralMessage(msg: waproto.IMessage): boolean {
		return !!(msg.ephemeralMessage)
	}

	/**
	 * Checks if a message is view once
	 */
	static isViewOnceMessage(msg: waproto.IMessage): boolean {
		return !!(msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.viewOnceMessageV2Extension)
	}

	/**
	 * Checks if a message is edited
	 */
	static isEditedMessage(msg: waproto.IMessage): boolean {
		return !!(msg.editedMessage)
	}

	/**
	 * Checks if the message is a protocol/system message
	 */
	static isProtocolMessage(msg: waproto.IMessage): boolean {
		return !!(msg.protocolMessage)
	}

	/**
	 * Checks if message needs decryption (wrapped in futureproof wrapper)
	 */
	static isFutureProofWrapped(msg: waproto.IMessage): boolean {
		return !!(
			msg.ephemeralMessage ||
			msg.viewOnceMessage ||
			msg.documentWithCaptionMessage ||
			msg.viewOnceMessageV2 ||
			msg.viewOnceMessageV2Extension ||
			msg.editedMessage
		)
	}
}
