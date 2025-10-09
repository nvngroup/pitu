import { Boom } from '@hapi/boom'
import { waproto } from '../../WAProto'
import { LIDMappingStore } from '../Signal/lid-mapping'
import { SignalRepository, WAMessageKey } from '../Types'
import { areJidsSameUser, BinaryNode, FullJid, isJidBroadcast, isJidGroup, isJidNewsletter, isJidStatusBroadcast, isJidUser, isLidUser, jidDecode, jidEncode, jidNormalizedUser } from '../WABinary'
import { unpadRandomMax16 } from './generics'
import { ILogger } from './logger'
import { macErrorManager } from './mac-error-handler'
import { sessionDiagnostics } from './session-diagnostics'
import { MessageType, NO_MESSAGE_FOUND_ERROR_TEXT } from './types'

const getDecryptionJid = async(sender: string, repository: SignalRepository): Promise<string> => {
	if(!sender.includes('@s.whatsapp.net')) {
		return sender
	}

	const lidMapping: LIDMappingStore = repository.getLIDMappingStore()
	const normalizedSender: string = jidNormalizedUser(sender)
	const lidForPN: string | null = await lidMapping.getLIDForPN(normalizedSender)

	if(lidForPN?.includes('@lid')) {
		const senderDecoded: FullJid | undefined = jidDecode(sender)
		const deviceId: number = senderDecoded?.device || 0
		return jidEncode(jidDecode(lidForPN)!.user, 'lid', deviceId)
	}

	return sender
}

export const extractAddressingContext = (stanza: BinaryNode) => {
	const addressingMode: string = stanza.attrs.addressing_mode || 'pn'
	let senderAlt: string | undefined
	let recipientAlt: string | undefined

	if(addressingMode === 'lid') {
		senderAlt = stanza.attrs.participant_pn || stanza.attrs.sender_pn
		recipientAlt = stanza.attrs.recipient_pn
	} else {
		senderAlt = stanza.attrs.participant_lid || stanza.attrs.sender_lid
		recipientAlt = stanza.attrs.recipient_lid
	}

	return {
		addressingMode,
		senderAlt,
		recipientAlt
	}
}

const processMessageContent = async(
	item: BinaryNode,
	fullMessage: waproto.IWebMessageInfo,
	sender: string,
	author: string,
	repository: SignalRepository,
	logger: ILogger
): Promise<{ processed: boolean }> => {
	const { tag, attrs, content } = item

	if(tag === 'verified_name' && content instanceof Uint8Array) {
		const cert = waproto.VerifiedNameCertificate.decode(content)
		const details = waproto.VerifiedNameCertificate.Details.decode(cert.details!)
		fullMessage.verifiedBizName = details.verifiedName
		return { processed: false }
	}

	if(tag !== 'enc' && tag !== 'plaintext') {
		return { processed: false }
	}

	if(!(content instanceof Uint8Array)) {
		return { processed: false }
	}

	try {
		const msgBuffer: Uint8Array = await decryptMessageContent(tag, attrs, content, sender, author, repository)
		await processDecryptedMessage(msgBuffer, tag, attrs, fullMessage, author, repository, logger)
		return { processed: true }
	} catch(err) {
		const jid: string = fullMessage.key?.remoteJid || 'unknown'
		await handleDecryptionError(err, fullMessage, author, jid, tag, attrs, repository, logger)
		return { processed: true }
	}
}

const decryptMessageContent = async(
	tag: string,
	attrs: { type?: string },
	content: Uint8Array,
	sender: string,
	author: string,
	repository: SignalRepository
): Promise<Uint8Array> => {
	const e2eType: string | undefined = tag === 'plaintext' ? 'plaintext' : attrs.type

	switch (e2eType) {
	case 'skmsg':
		return await repository.decryptGroupMessage({
			group: sender,
			authorJid: author,
			msg: content
		})
	case 'pkmsg':
	case 'msg':
		const user: string = isJidUser(sender) ? sender : author
		const decryptionJid: string = await getDecryptionJid(user, repository)
		return await repository.decryptMessage({
			jid: decryptionJid,
			type: e2eType,
			ciphertext: content
		})
	case 'plaintext':
		return content
	default:
		throw new Error(`Unknown e2e type: ${e2eType}`)
	}
}

const processDecryptedMessage = async(
	msgBuffer: Uint8Array,
	tag: string,
	attrs: { type?: string },
	fullMessage: waproto.IWebMessageInfo,
	author: string,
	repository: SignalRepository,
	logger: ILogger
) => {
	const e2eType: string | undefined = tag === 'plaintext' ? 'plaintext' : attrs.type
	let msg: waproto.IMessage = waproto.Message.decode(e2eType !== 'plaintext' ? unpadRandomMax16(msgBuffer) : msgBuffer)
	msg = msg.deviceSentMessage?.message || msg

	if(msg.senderKeyDistributionMessage) {
		try {
			await repository.processSenderKeyDistributionMessage({
				authorJid: author,
				item: msg.senderKeyDistributionMessage
			})
		} catch(err) {
			logger.error({ key: fullMessage.key, err }, 'failed to decrypt message')
		}
	}

	if(fullMessage.message) {
		Object.assign(fullMessage.message, msg)
	} else {
		fullMessage.message = msg
	}
}

export const handleDecryptionError = async(
	err: Error,
	fullMessage: waproto.IWebMessageInfo,
	author: string,
	jid: string,
	tag: string,
	attrs: { type?: string },
	repository: SignalRepository,
	logger: ILogger
) => {
	const isMacError: boolean = macErrorManager.isMACError(err)
	const isSessionError: boolean = isMacError ||
						  err.message?.includes('InvalidMessageException') ||
						  err.message?.includes('session') ||
						  err.message?.includes('Bad MAC')

	const isGroupMessage: boolean = tag === 'enc' && attrs.type === 'skmsg'

	if(isMacError) {
		macErrorManager.recordMACError(jid, err)
		const stats = macErrorManager.getErrorStats(jid)
		const canRetry: boolean = macErrorManager.shouldAttemptRecovery(jid)

		logger.warn({
			key: fullMessage.key,
			sender: jid,
			author: isGroupMessage ? author : undefined,
			messageType: attrs.type || tag,
			error: err.message,
			errorStats: stats,
			canRetry,
			recommendations: macErrorManager.getRecoveryRecommendations(jid)
		}, 'MAC verification error during message decryption')

		if(!canRetry) {
			logger.error({
				key: fullMessage.key,
				sender: jid,
				author: isGroupMessage ? author : undefined,
				error: 'Persistent MAC errors - session requires manual intervention'
			}, 'Maximum MAC error retries exceeded')
		} else {
			await attemptMACRecovery(jid, author, isGroupMessage, repository, fullMessage.key, logger)
		}
	} else if(isSessionError) {
		logger.warn({
			key: fullMessage.key,
			sender: jid,
			author: isGroupMessage ? author : undefined,
			messageType: attrs.type || tag,
			error: err.message,
			recommendation: 'Session may need to be reset'
		}, 'Session decryption error - possible key corruption')
	} else {
		logger.error(
			{ key: fullMessage.key, err },
			'failed to decrypt message'
		)
	}

	fullMessage.messageStubType = waproto.WebMessageInfo.StubType.CIPHERTEXT

	if(isMacError) {
		const canRetry: boolean = macErrorManager.shouldAttemptRecovery(jid)
		fullMessage.messageStubParameters = [
			canRetry
				? 'MAC verification failed - attempting recovery'
				: 'MAC verification failed - session needs reset'
		]
	} else if(isSessionError) {
		fullMessage.messageStubParameters = ['Session key error - message corrupted']
	} else {
		fullMessage.messageStubParameters = [err.message || 'Unknown decryption error']
	}
}

const attemptMACRecovery = async(
	jid: string,
	author: string,
	isGroupMessage: boolean,
	repository: SignalRepository,
	key: WAMessageKey,
	logger: ILogger
) => {
	try {
		sessionDiagnostics.recordSessionError(jid, 'mac_error_during_decryption')

		logger.debug({
			key,
			sender: jid,
			author: isGroupMessage ? author : undefined,
			errorStats: sessionDiagnostics.getErrorStats(jid)
		}, 'Starting MAC recovery with enhanced diagnostics')

		const recoverySuccess: boolean = await macErrorManager.attemptAutomaticRecovery(
			jid,
			() => performSessionCleanup(jid, author, isGroupMessage, repository, logger)
		)

		if(recoverySuccess) {
			logger.info({
				key,
				sender: jid,
				author: isGroupMessage ? author : undefined
			}, 'MAC error recovery completed - session will be re-established')
		} else {
			logger.warn({
				key,
				sender: jid,
				author: isGroupMessage ? author : undefined,
				recommendation: 'Consider forced session reset using sessionDiagnostics.forceSessionReset()',
				errorStats: sessionDiagnostics.getErrorStats(jid)
			}, 'Automatic MAC recovery failed - manual intervention may be required')
		}
	} catch(recoveryError) {
		logger.error({
			key,
			sender: jid,
			recoveryError
		}, 'Failed to perform MAC error recovery')

		sessionDiagnostics.recordSessionError(jid, `mac_recovery_failed: ${recoveryError.message}`)
	}
}

const performSessionCleanup = async(
	jid: string,
	author: string,
	isGroupMessage: boolean,
	repository: SignalRepository,
	logger: ILogger
) => {
	if(isGroupMessage) {
		await cleanupGroupSenderKey(jid, author, repository, logger)
	} else {
		await repository.deleteSession(jid)
		logger.debug({ jid }, 'Cleared corrupted session for MAC recovery')
	}
}

const cleanupGroupSenderKey = async(
	jid: string,
	author: string,
	repository: SignalRepository,
	logger: ILogger
) => {
	const { SenderKeyName } = await import('../Signal/Group/sender-key-name')
	const { jidDecode } = await import('../WABinary')

	const decoded: FullJid | undefined = jidDecode(author)
	if(!decoded) {
		return
	}

	const sender = {
		id: decoded.user,
		deviceId: decoded.device || 0,
		toString: () => `${decoded.user}.${decoded.device || 0}`
	}
	const senderKeyName = new SenderKeyName(jid, sender)
	const keyId = senderKeyName.toString()

	await repository.deleteSession(`${jid}:${author}`)
	logger.debug({ jid, author, keyId }, 'Cleared corrupted sender key for MAC recovery')
}

/**
 * Decode the received node as a message.
 * @note this will only parse the message, not decrypt it
 */
export function decodeMessageNode(
	stanza: BinaryNode,
	meId: string,
	meLid: string
) {
	let msgType: MessageType
	let chatId: string
	let author: string
	let fromMe = false

	const msgId: string = stanza.attrs.id
	const from: string = stanza.attrs.from
	const participant: string | undefined = stanza.attrs.participant
	const participantLid: string | undefined = stanza.attrs.participant_lid
	const recipient: string | undefined = stanza.attrs.recipient

	const isMe = (jid: string) => areJidsSameUser(jid, meId)
	const isMeLid = (jid: string) => areJidsSameUser(jid, meLid)

	if(isJidUser(from)) {
		if(recipient) {
			if(!isMe(from)) {
				throw new Boom('receipient present, but msg not from me', { data: stanza })
			}

			if(isMe(from) || isMeLid(from)) {
				fromMe = true
			}

			chatId = recipient
		} else {
			chatId = from
		}

		msgType = 'chat'
		author = from
	} else if(isLidUser(from)) {
		if(recipient) {
			if(!isMeLid(from)) {
				throw new Boom('receipient present, but msg not from me', { data: stanza })
			}

			if(isMe(from) || isMeLid(from)) {
				fromMe = true
			}

			chatId = recipient
		} else {
			chatId = from
		}

		msgType = 'chat'
		author = from
	} else if(isJidGroup(from)) {
		if(!participant) {
			throw new Boom('No participant in group message')
		}

		if(isMe(participant) || isMeLid(participant)) {
			fromMe = true
		}

		msgType = 'group'
		author = participant
		chatId = from
	} else if(isJidBroadcast(from)) {
		if(!participant) {
			throw new Boom('No participant in group message')
		}

		const isParticipantMe: boolean = isMe(participant)
		if(isJidStatusBroadcast(from)) {
			msgType = isParticipantMe ? 'direct_peer_status' : 'other_status'
		} else {
			msgType = isParticipantMe ? 'peer_broadcast' : 'other_broadcast'
		}

		fromMe = isParticipantMe
		chatId = from
		author = participantLid || participant
	} else if(isJidNewsletter(from)) {
		msgType = 'newsletter'
		chatId = from
		author = from

		if(isMe(from) || isMeLid(from)) {
			fromMe = true
		}
	} else {
		throw new Boom('Unknown message type', { data: stanza })
	}

	const pushname: string = stanza?.attrs?.notify

	const key: WAMessageKey = {
		remoteJid: chatId,
		fromMe,
		id: msgId,
		senderPn: stanza?.attrs?.sender_pn ?? jidNormalizedUser(!chatId.endsWith('@g.us') ? chatId : stanza?.attrs?.participant_pn ?? jidNormalizedUser(participant)),
		senderLid: stanza?.attrs?.sender_lid ?? jidNormalizedUser(!chatId.endsWith('@g.us') ? chatId : stanza?.attrs?.participant_lid ?? jidNormalizedUser(participant)),
		participant,
		participantPn: stanza?.attrs?.participant_pn,
		participantLid: stanza?.attrs?.participant_lid,
		peerRecipientPn: stanza?.attrs?.peer_recipient_pn,
		peerRecipientLid: stanza?.attrs?.peer_recipient_lid,
	}

	const fullMessage: waproto.IWebMessageInfo = {
		key,
		messageTimestamp: +stanza.attrs.t,
		pushName: pushname,
		broadcast: isJidBroadcast(from)
	}

	if(key.fromMe) {
		fullMessage.status = waproto.WebMessageInfo.Status.SERVER_ACK
	}

	return {
		fullMessage,
		author,
		sender: msgType === 'chat' ? author : chatId
	}
}

export const decryptMessageNode = (
	stanza: BinaryNode,
	meId: string,
	meLid: string,
	repository: SignalRepository,
	logger: ILogger
) => {
	const { fullMessage, author, sender } = decodeMessageNode(stanza, meId, meLid)
	return {
		fullMessage,
		category: stanza.attrs.category,
		author,
		async decrypt() {
			let decryptables = 0
			if(Array.isArray(stanza.content)) {
				for(const item of stanza.content) {
					const result = await processMessageContent(item, fullMessage, sender, author, repository, logger)
					if(result.processed) {
						decryptables += 1
					}
				}
			}

			if(!decryptables) {
				fullMessage.messageStubType = waproto.WebMessageInfo.StubType.CIPHERTEXT
				fullMessage.messageStubParameters = [NO_MESSAGE_FOUND_ERROR_TEXT]
			}
		}
	}
}
