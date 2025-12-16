import { waproto } from '../../WAProto'
import { CacheManager } from '../Socket/cache-manager'
import { CacheStore, SignalRepository, WAMessage, WAMessageKey } from '../Types'
import { areJidsSameUser, BinaryNode, FullJid, isHostedLidUser, isHostedPnUser, isJidBroadcast, isJidGroup, isJidMetaAI, isJidNewsletter, isJidStatusBroadcast, isJidUser, isLidUser, isPnUser, jidDecode, jidEncode, jidNormalizedUser } from '../WABinary'
import { unpadRandomMax16 } from './generics'
import { ILogger } from './logger'
import { macErrorManager } from './mac-error-handler'
import { sessionDiagnostics } from './session-diagnostics'
import { MessageType, NO_MESSAGE_FOUND_ERROR_TEXT } from './types'
import { Boom } from '@hapi/boom'

let lidCache: CacheStore | null = null

const getLidCache = (): CacheStore => {
	if (!lidCache) {
		lidCache = CacheManager.getInstance('LID_CACHE')
	}

	return lidCache
}

const getDecryptionJid = async(sender: string, repository: SignalRepository): Promise<string> => {
	if (!sender.includes('@s.whatsapp.net')) {
		return sender
	}

	const normalizedSender: string = jidNormalizedUser(sender)
	const lidForPN: string | null = await repository.lidMapping.getLIDForPN(normalizedSender)

	if (lidForPN?.includes('@lid')) {
		const senderDecoded: FullJid | undefined = jidDecode(sender)
		const deviceId: number = senderDecoded?.device || 0
		return jidEncode(jidDecode(lidForPN)!.user, 'lid', deviceId)
	}

	return sender
}

const storeMappingFromEnvelope = async(
	stanza: BinaryNode,
	sender: string,
	repository: SignalRepository,
	decryptionJid: string,
	logger: ILogger
): Promise<void> => {
	/**
	 * Extract and store LID<->PN mappings from message envelope.
	 * Handles both standard and hosted ID domains:
	 * - Standard: @lid <-> @s.whatsapp.net
	 * - Hosted: @hosted.lid <-> @hosted
	 */
	const { senderAlt } = extractAddressingContext(stanza)

	if (!senderAlt) {
		return
	}

	// Check if senderAlt is LID (standard or hosted) and sender is PN (standard or hosted)
	const isSenderAltLid: boolean = !!(isLidUser(senderAlt) || isHostedLidUser(senderAlt))
	const isSenderPn: boolean = !!(isPnUser(sender) || isHostedPnUser(sender))

	if (isSenderAltLid && isSenderPn && decryptionJid === sender) {
		try {
			await repository.lidMapping.storeLIDPNMappings([{ lidUser: senderAlt, pnUser: sender }])
			await repository.migrateSession(sender, senderAlt)

			const isHosted: boolean = !!(isHostedLidUser(senderAlt) || isHostedPnUser(sender))
			logger.debug(
				{ sender, senderAlt, isHosted },
				`Stored ${isHosted ? 'hosted ' : ''}LID mapping from envelope`
			)
		} catch (error) {
			logger.warn({ sender, senderAlt, error }, 'Failed to store LID mapping')
		}
	}
}

const processMessageContent = async(
	item: BinaryNode,
	fullMessage: WAMessage,
	sender: string,
	author: string,
	repository: SignalRepository,
	stanza: BinaryNode,
	logger: ILogger
): Promise<{ processed: boolean }> => {
	const { tag, attrs, content } = item

	if (tag === 'verified_name' && content instanceof Uint8Array) {
		const cert = waproto.VerifiedNameCertificate.decode(content)
		const details = waproto.VerifiedNameCertificate.Details.decode(cert.details!)
		fullMessage.verifiedBizName = details.verifiedName
		return { processed: false }
	}

	if (tag === 'unavailable' && attrs.type === 'view_once') {
		fullMessage.key.isViewOnce = true // TODO: remove from here and add a STUB TYPE
	}

	if (attrs.count && tag === 'enc') {
		fullMessage.retryCount = Number(attrs.count)
	}

	if (tag !== 'enc' && tag !== 'plaintext') {
		return { processed: false }
	}

	if (!(content instanceof Uint8Array)) {
		return { processed: false }
	}

	try {
		const msgBuffer: Uint8Array = await decryptMessageContent(tag, attrs, content, sender, author, repository)
		const decryptionJid: string = await getDecryptionJid(author, repository)
		if (tag !== 'plaintext') {
			// Store LID<->PN mapping from envelope (supports standard and hosted IDs)
			storeMappingFromEnvelope(stanza, author, repository, decryptionJid, logger)
		}

		await processDecryptedMessage(msgBuffer, tag, attrs, fullMessage, decryptionJid, repository, logger)
		return { processed: true }
	} catch (err) {
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
	case 'msmsg':
		const user: string = isJidUser(sender) ? sender : author
		const decryptionJid: string = await getDecryptionJid(user, repository)
		const signalType: 'pkmsg' | 'msg' = e2eType === 'msmsg' ? 'msg' : (e2eType)
		return await repository.decryptMessage({
			jid: decryptionJid,
			type: signalType,
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

	if (msg.senderKeyDistributionMessage) {
		try {
			await repository.processSenderKeyDistributionMessage({
				authorJid: author,
				item: msg.senderKeyDistributionMessage
			})
		} catch (err) {
			logger.error({ key: fullMessage.key, err }, 'failed to decrypt message')
		}
	}

	if (fullMessage.message) {
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

	if (isMacError) {
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

		if (!canRetry) {
			logger.error({
				key: fullMessage.key,
				sender: jid,
				author: isGroupMessage ? author : undefined,
				error: 'Persistent MAC errors - session requires manual intervention'
			}, 'Maximum MAC error retries exceeded')
		} else {
			await attemptMACRecovery(jid, author, isGroupMessage, repository, fullMessage.key, logger)
		}
	} else if (isSessionError) {
		logger.trace({
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

	if (isMacError) {
		const canRetry: boolean = macErrorManager.shouldAttemptRecovery(jid)
		fullMessage.messageStubParameters = [
			canRetry
				? 'MAC verification failed - attempting recovery'
				: 'MAC verification failed - session needs reset'
		]
	} else if (isSessionError) {
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

		if (recoverySuccess) {
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
	} catch (recoveryError) {
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
	if (isGroupMessage) {
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
	if (!decoded) {
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

export const extractAddressingContext = (stanza: BinaryNode) => {
	let senderAlt: string | undefined
	let recipientAlt: string | undefined

	const sender: string = stanza.attrs.participant || stanza.attrs.from
	const addressingMode: string = stanza.attrs.addressing_mode || (sender?.endsWith('lid') ? 'lid' : 'pn')

	if (addressingMode === 'lid') {
		// Message is LID-addressed: sender is LID, extract corresponding PN
		// without device data
		senderAlt = stanza.attrs.participant_pn || stanza.attrs.sender_pn || stanza.attrs.peer_recipient_pn
		recipientAlt = stanza.attrs.recipient_pn
		// with device data
		//if (sender && senderAlt) senderAlt = transferDevice(sender, senderAlt)
	} else {
		// Message is PN-addressed: sender is PN, extract corresponding LID
		// without device data
		senderAlt = stanza.attrs.participant_lid || stanza.attrs.sender_lid || stanza.attrs.peer_recipient_lid
		recipientAlt = stanza.attrs.recipient_lid

		//with device data
		//if (sender && senderAlt) senderAlt = transferDevice(sender, senderAlt)
	}

	return {
		addressingMode,
		senderAlt,
		recipientAlt
	}
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

	const msgId: string = stanza.attrs.id
	const from: string = stanza.attrs.from
	const senderPn: string | undefined = stanza?.attrs?.sender_pn
	const senderLid: string | undefined = stanza?.attrs?.sender_lid
	const participant: string | undefined = stanza?.attrs?.participant
	const participantPn: string | undefined = stanza?.attrs?.participant_pn
	const participantLid: string | undefined = stanza?.attrs?.participant_lid
	const peerRecipientPn: string | undefined = stanza?.attrs?.peer_recipient_pn
	const peerRecipientLid: string | undefined = stanza?.attrs?.peer_recipient_lid
	const recipient: string | undefined = stanza?.attrs?.recipient
	const addressingMode: string | undefined = stanza?.attrs?.addressing_mode
	const isMe = (jid: string) => areJidsSameUser(jid, meId)
	const isMeLid = (jid: string) => areJidsSameUser(jid, meLid)
	const fromMe: boolean = (isLidUser(from) || isLidUser(participant) ? isMeLid : isMe)(stanza.attrs.participant || stanza.attrs.from)

	if (isJidUser(from) || isLidUser(from)) {
		if (recipient && !isJidMetaAI(recipient)) {
			if (!isMe(from) && !isMeLid(from)) {
				throw new Boom('receipient present, but msg not from me', { data: stanza })
			}

			chatId = recipient
		} else {
			chatId = from || senderLid
		}

		msgType = 'chat'

		const deviceOrigem = jidDecode(from)?.device

		if (fromMe) {
			const userDestino = jidDecode(jidNormalizedUser(meLid))?.user
			author = deviceOrigem
				? `${userDestino}:${deviceOrigem}@lid`
				: `${userDestino}@lid`
		} else {
			if (!senderLid) {
				author = from
			} else {
				const userDestino = jidDecode(senderLid)?.user
				author = deviceOrigem
					? `${userDestino}:${deviceOrigem}@lid`
					: `${userDestino}@lid`
			}
		}

		if (senderLid && senderPn) {
			const cache: CacheStore = getLidCache()
			const verify: string | undefined = cache.get<string>(jidNormalizedUser(senderPn))
			if (!verify) {
				cache.set(jidNormalizedUser(senderPn), jidNormalizedUser(senderLid))
			}
		}
	} else if (isJidGroup(from)) {
		if (!participant) {
			throw new Boom('No participant in group message')
		}

		msgType = 'group'
		chatId = from || senderLid
		const deviceOrigem: number | undefined = jidDecode(participant)?.device
		if (fromMe) {
			const userDestino: string | undefined = jidDecode(jidNormalizedUser(meLid))?.user
			author = deviceOrigem
				? `${userDestino}:${deviceOrigem}@lid`
				: `${userDestino}@lid`
		} else {
			if (!participantLid) {
				author = participant
			} else {
				const userDestino: string | undefined = jidDecode(participantLid)?.user
				author = deviceOrigem
					? `${userDestino}:${deviceOrigem}@lid`
					: `${userDestino}@lid`
			}
		}

	} else if (isJidBroadcast(from)) {
		if (!participant && participantLid) {
			throw new Boom('No participant in group message')
		}

		const isParticipantMe: boolean = isMe(participant)
		if (isJidStatusBroadcast(from)) {
			msgType = isParticipantMe ? 'direct_peer_status' : 'other_status'
		} else {
			msgType = isParticipantMe ? 'peer_broadcast' : 'other_broadcast'
		}

		chatId = from
		author = participantLid || participant

	} else if (isJidNewsletter(from)) {
		msgType = 'newsletter'
		chatId = from
		author = from
	} else {
		throw new Boom('Unknown message type', { data: stanza })
	}

	const pushname: string = stanza?.attrs?.notify

	const key: WAMessageKey = {
		remoteJid: chatId,
		fromMe,
		id: msgId,
		...(senderPn && { senderPn }),
		...(senderLid && { senderLid }),
		...(participantPn && { participantPn }),
		...(participantLid && { participantLid }),
		...(peerRecipientPn && { peerRecipientPn }),
		...(peerRecipientLid && { peerRecipientLid }),
		...(addressingMode && { addressingMode })
	}

	const fullMessage: WAMessage = {
		key,
		category: stanza.attrs.category,
		messageTimestamp: +stanza.attrs.t,
		pushName: pushname,
		broadcast: isJidBroadcast(from)
	}

	if (key.fromMe) {
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
			if (Array.isArray(stanza.content)) {
				for (const item of stanza.content) {
					const result = await processMessageContent(item, fullMessage, sender, author, repository, stanza, logger)
					if (result.processed) {
						decryptables += 1
					}
				}
			}

			if (!decryptables && !fullMessage.key?.isViewOnce) {
				fullMessage.messageStubType = waproto.WebMessageInfo.StubType.CIPHERTEXT
				fullMessage.messageStubParameters = [NO_MESSAGE_FOUND_ERROR_TEXT]
			}
		}
	}
}
