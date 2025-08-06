import { Boom } from '@hapi/boom'
import { waproto } from '../../WAProto'
import { SignalRepository, WAMessageKey } from '../Types'
import { areJidsSameUser, BinaryNode, isJidBroadcast, isJidGroup, isJidNewsletter, isJidStatusBroadcast, isJidUser, isLidUser, jidNormalizedUser } from '../WABinary'
import { unpadRandomMax16 } from './generics'
import { ILogger } from './logger'
import { macErrorManager } from './mac-error-handler'

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

type MessageType = 'chat' | 'peer_broadcast' | 'other_broadcast' | 'group' | 'direct_peer_status' | 'other_status' | 'newsletter'

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

	const msgId = stanza.attrs.id
	const from = stanza.attrs.from
	const participant: string | undefined = stanza.attrs.participant
	const recipient: string | undefined = stanza.attrs.recipient

	const isMe = (jid: string) => areJidsSameUser(jid, meId)
	const isMeLid = (jid: string) => areJidsSameUser(jid, meLid)

	if(isJidUser(from)) {
		if(recipient) {
			if(!isMe(from)) {
				throw new Boom('receipient present, but msg not from me', { data: stanza })
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

		msgType = 'group'
		author = participant
		chatId = from
	} else if(isJidBroadcast(from)) {
		if(!participant) {
			throw new Boom('No participant in group message')
		}

		const isParticipantMe = isMe(participant)
		if(isJidStatusBroadcast(from)) {
			msgType = isParticipantMe ? 'direct_peer_status' : 'other_status'
		} else {
			msgType = isParticipantMe ? 'peer_broadcast' : 'other_broadcast'
		}

		chatId = from
		author = participant
	} else if(isJidNewsletter(from)) {
		msgType = 'newsletter'
		chatId = from
		author = from
	} else {
		throw new Boom('Unknown message type', { data: stanza })
	}

	const fromMe = (isLidUser(from) ? isMeLid : isMe)(stanza.attrs.participant || stanza.attrs.from)
	const pushname = stanza?.attrs?.notify

	const key: WAMessageKey = {
		remoteJid: chatId,
		fromMe,
		id: msgId,
		senderLid: stanza?.attrs?.sender_lid || jidNormalizedUser(chatId),
		senderPn: stanza?.attrs?.sender_pn || jidNormalizedUser(chatId),
		participant,
		participantPn: stanza?.attrs?.participant_pn,
		participantLid: stanza?.attrs?.participant_lid
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
				for(const { tag, attrs, content } of stanza.content) {
					if(tag === 'verified_name' && content instanceof Uint8Array) {
						const cert = waproto.VerifiedNameCertificate.decode(content)
						const details = waproto.VerifiedNameCertificate.Details.decode(cert.details!)
						fullMessage.verifiedBizName = details.verifiedName
					}

					if(tag !== 'enc' && tag !== 'plaintext') {
						continue
					}

					if(!(content instanceof Uint8Array)) {
						continue
					}

					decryptables += 1

					let msgBuffer: Uint8Array

					try {
						const e2eType = tag === 'plaintext' ? 'plaintext' : attrs.type
						switch (e2eType) {
						case 'skmsg':
							msgBuffer = await repository.decryptGroupMessage({
								group: sender,
								authorJid: author,
								msg: content
							})
							break
						case 'pkmsg':
						case 'msg':
							const user = isJidUser(sender) ? sender : author
							msgBuffer = await repository.decryptMessage({
								jid: user,
								type: e2eType,
								ciphertext: content
							})
							break
						case 'plaintext':
							msgBuffer = content
							break
						default:
							throw new Error(`Unknown e2e type: ${e2eType}`)
						}

						let msg: waproto.IMessage = waproto.Message.decode(e2eType !== 'plaintext' ? unpadRandomMax16(msgBuffer) : msgBuffer)
						msg = msg.deviceSentMessage?.message || msg
						if(msg.senderKeyDistributionMessage) {
							//eslint-disable-next-line max-depth
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
					} catch(err) {
						// Usar o gerenciador MAC para classificar o erro
						const isMacError = macErrorManager.isMACError(err)
						const isSessionError = isMacError ||
											  err.message?.includes('InvalidMessageException') ||
											  err.message?.includes('session') ||
											  err.message?.includes('Bad MAC')

						const jid = fullMessage.key?.remoteJid || 'unknown'

						if(isMacError) {
							// Registrar o erro MAC
							macErrorManager.recordMACError(jid, err)
							const stats = macErrorManager.getErrorStats(jid)
							const canRetry = macErrorManager.shouldAttemptRecovery(jid)

							logger.warn({
								key: fullMessage.key,
								sender: jid,
								error: err.message,
								errorStats: stats,
								canRetry,
								recommendations: macErrorManager.getRecoveryRecommendations(jid)
							}, 'MAC verification error during message decryption')

							// Para erros MAC persistentes, marcar mensagem como não decifrável
							if(!canRetry) {
								logger.error({
									key: fullMessage.key,
									sender: jid,
									error: 'Persistent MAC errors - session requires manual intervention'
								}, 'Maximum MAC error retries exceeded')
							}
						} else if(isSessionError) {
							logger.warn({
								key: fullMessage.key,
								sender: jid,
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

						// Mensagem de erro mais informativa baseada no tipo
						if(isMacError) {
							const canRetry = macErrorManager.shouldAttemptRecovery(jid)
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
				}
			}

			// if nothing was found to decrypt
			if(!decryptables) {
				fullMessage.messageStubType = waproto.WebMessageInfo.StubType.CIPHERTEXT
				fullMessage.messageStubParameters = [NO_MESSAGE_FOUND_ERROR_TEXT]
			}
		}
	}
}
