import { AxiosRequestConfig } from 'axios'
import { waproto } from '../../WAProto'
import { AuthenticationCreds, BaileysEventEmitter, CacheStore, Chat, Contact, GroupMetadata, ParticipantAction, RequestJoinAction, RequestJoinMethod, SignalKeyStoreWithTransaction, SocketConfig, WAMessageStubType } from '../Types'
import { getContentType, normalizeMessageContent } from '../Utils/messages'
import { areJidsSameUser, isJidBroadcast, isJidStatusBroadcast, jidNormalizedUser } from '../WABinary'
import { aesDecryptGCM, hmacSign } from './crypto'
import { getKeyAuthor, toNumber } from './generics'
import { downloadAndProcessHistorySyncNotification } from './history'
import { ILogger } from './logger'

type ProcessMessageContext = {
	shouldProcessHistoryMsg: boolean
	placeholderResendCache?: CacheStore
	creds: AuthenticationCreds
	keyStore: SignalKeyStoreWithTransaction
	ev: BaileysEventEmitter
	getMessage: SocketConfig['getMessage']
	logger?: ILogger
	options: AxiosRequestConfig<{}>
}

const REAL_MSG_STUB_TYPES = new Set([
	WAMessageStubType.CALL_MISSED_GROUP_VIDEO,
	WAMessageStubType.CALL_MISSED_GROUP_VOICE,
	WAMessageStubType.CALL_MISSED_VIDEO,
	WAMessageStubType.CALL_MISSED_VOICE
])

const REAL_MSG_REQ_ME_STUB_TYPES = new Set([
	WAMessageStubType.GROUP_PARTICIPANT_ADD
])

export const cleanMessage = (message: waproto.IWebMessageInfo, meId: string) => {
	message.key.remoteJid = jidNormalizedUser(message.key.remoteJid!)
	message.key.participant = message.key.participant ? jidNormalizedUser(message.key.participant) : undefined
	const content: waproto.IMessage | undefined = normalizeMessageContent(message.message)
	if(content?.reactionMessage) {
		normaliseKey(content.reactionMessage.key!)
	}

	if(content?.pollUpdateMessage) {
		normaliseKey(content.pollUpdateMessage.pollCreationMessageKey!)
	}

	function normaliseKey(msgKey: waproto.IMessageKey) {
		if(!message.key.fromMe) {
			msgKey.fromMe = !msgKey.fromMe
				? areJidsSameUser(msgKey.participant || msgKey.remoteJid!, meId)
				: false
			msgKey.remoteJid = message.key.remoteJid
			msgKey.participant = msgKey.participant || message.key.participant
		}
	}
}

export const isRealMessage = (message: waproto.IWebMessageInfo, meId: string) => {
	const normalizedContent: waproto.IMessage | undefined = normalizeMessageContent(message.message)
	const hasSomeContent = !!getContentType(normalizedContent)
	return (
		!!normalizedContent
		|| REAL_MSG_STUB_TYPES.has(message.messageStubType!)
		|| (
			REAL_MSG_REQ_ME_STUB_TYPES.has(message.messageStubType!)
			&& message.messageStubParameters?.some(p => areJidsSameUser(meId, p))
		)
	)
	&& hasSomeContent
	&& !normalizedContent?.protocolMessage
	&& !normalizedContent?.reactionMessage
	&& !normalizedContent?.pollUpdateMessage
}

export const shouldIncrementChatUnread = (message: waproto.IWebMessageInfo) => (
	!message.key.fromMe && !message.messageStubType
)

/**
 * Get the ID of the chat from the given key.
 * Typically -- that'll be the remoteJid, but for broadcasts, it'll be the participant
 */
export const getChatId = ({ remoteJid, participant, fromMe }: waproto.IMessageKey) => {
	if(
		isJidBroadcast(remoteJid!)
		&& !isJidStatusBroadcast(remoteJid!)
		&& !fromMe
	) {
		return participant!
	}

	return remoteJid!
}

type PollContext = {
	pollCreatorJid: string
	pollMsgId: string
	pollEncKey: Uint8Array
	voterJid: string
}

/**
 * Decrypt a poll vote
 * @param vote encrypted vote
 * @param ctx additional info about the poll required for decryption
 * @returns list of SHA256 options
 */
export function decryptPollVote(
	{ encPayload, encIv }: waproto.Message.IPollEncValue,
	{
		pollCreatorJid,
		pollMsgId,
		pollEncKey,
		voterJid,
	}: PollContext
) {
	const sign: Buffer = Buffer.concat(
		[
			toBinary(pollMsgId),
			toBinary(pollCreatorJid),
			toBinary(voterJid),
			toBinary('Poll Vote'),
			new Uint8Array([1])
		]
	)

	const key0: Buffer = hmacSign(pollEncKey, new Uint8Array(32), 'sha256')
	const decKey: Buffer = hmacSign(sign, key0, 'sha256')
	const aad: Buffer = toBinary(`${pollMsgId}\u0000${voterJid}`)

	const decrypted: Buffer = aesDecryptGCM(encPayload!, decKey, encIv!, aad)
	return waproto.Message.PollVoteMessage.decode(decrypted)

	function toBinary(txt: string) {
		return Buffer.from(txt)
	}
}

const processMessage = async(
	message: waproto.IWebMessageInfo,
	{
		shouldProcessHistoryMsg,
		placeholderResendCache,
		ev,
		creds,
		keyStore,
		logger,
		options,
		getMessage
	}: ProcessMessageContext
) => {
	const meId: string = creds.me!.id
	const { accountSettings } = creds

	const chat: Partial<Chat> = { id: jidNormalizedUser(getChatId(message.key)) }
	const isRealMsg: boolean | undefined = isRealMessage(message, meId)

	if(isRealMsg) {
		chat.messages = [{ message }]
		chat.conversationTimestamp = toNumber(message.messageTimestamp)
		if(shouldIncrementChatUnread(message)) {
			chat.unreadCount = (chat.unreadCount || 0) + 1
		}
	}

	const content: waproto.IMessage | undefined = normalizeMessageContent(message.message)

	if(
		(isRealMsg || content?.reactionMessage?.key?.fromMe)
		&& accountSettings?.unarchiveChats
	) {
		chat.archived = false
		chat.readOnly = false
	}

	const protocolMsg: waproto.Message.IProtocolMessage | null | undefined = content?.protocolMessage
	if(protocolMsg) {
		switch (protocolMsg.type) {
		case waproto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION:
			const histNotification: waproto.Message.IHistorySyncNotification = protocolMsg.historySyncNotification!
			const process: boolean = shouldProcessHistoryMsg
			const isLatest = !creds.processedHistoryMessages?.length

			logger?.trace({
				histNotification,
				process,
				id: message.key.id,
				isLatest,
			}, 'got history notification')

			if(process) {
				if(histNotification.syncType !== waproto.HistorySync.HistorySyncType.ON_DEMAND) {
					ev.emit('creds.update', {
						processedHistoryMessages: [
							...(creds.processedHistoryMessages || []),
							{ key: message.key, messageTimestamp: message.messageTimestamp }
						]
					})
				}

				const data: {
					chats: Chat[];
					contacts: Contact[];
					messages: waproto.IWebMessageInfo[];
					syncType: waproto.HistorySync.HistorySyncType;
					progress: number | null | undefined;
				} = await downloadAndProcessHistorySyncNotification(
					histNotification,
					options
				)

				ev.emit('messaging-history.set', {
					...data,
					isLatest:
						histNotification.syncType !== waproto.HistorySync.HistorySyncType.ON_DEMAND
							? isLatest
							: undefined,
					peerDataRequestSessionId: histNotification.peerDataRequestSessionId
				})
			}

			break
		case waproto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_SHARE:
			const keys: waproto.Message.IAppStateSyncKey[] | null | undefined = protocolMsg.appStateSyncKeyShare!.keys
			if(keys?.length) {
				let newAppStateSyncKeyId = ''
				await keyStore.transaction(
					async() => {
						const newKeys: string[] = []
						for(const { keyData, keyId } of keys) {
							const strKeyId: string = Buffer.from(keyId!.keyId!).toString('base64')
							newKeys.push(strKeyId)

							await keyStore.set({ 'app-state-sync-key': { [strKeyId]: keyData! } })

							newAppStateSyncKeyId = strKeyId
						}

						logger?.info(
							{ newAppStateSyncKeyId, newKeys },
							'injecting new app state sync keys'
						)
					}
				)

				ev.emit('creds.update', { myAppStateKeyId: newAppStateSyncKeyId })
			} else {
				logger?.info({ protocolMsg }, 'recv app state sync with 0 keys')
			}

			break
		case waproto.Message.ProtocolMessage.Type.REVOKE:
			ev.emit('messages.update', [
				{
					key: {
						...message.key,
						id: protocolMsg.key!.id
					},
					update: { message: null, messageStubType: WAMessageStubType.REVOKE, key: message.key }
				}
			])
			break
		case waproto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING:
			Object.assign(chat, {
				ephemeralSettingTimestamp: toNumber(message.messageTimestamp),
				ephemeralExpiration: protocolMsg.ephemeralExpiration || null
			})
			break
		case waproto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE:
			const response: waproto.Message.IPeerDataOperationRequestResponseMessage = protocolMsg.peerDataOperationRequestResponseMessage!
			if(response) {
				placeholderResendCache?.del(response.stanzaId!)
				// TODO: IMPLEMENT HISTORY SYNC ETC (sticker uploads etc.).
				const { peerDataOperationResult } = response
				for(const result of peerDataOperationResult!) {
					const { placeholderMessageResendResponse: retryResponse } = result
					if(retryResponse) {
						const webMessageInfo = waproto.WebMessageInfo.decode(retryResponse.webMessageInfoBytes!)
						setTimeout(() => {
							ev.emit('messages.upsert', {
								messages: [webMessageInfo],
								type: 'notify',
								requestId: response.stanzaId!
							})
						}, 500)
					}
				}
			}

		case waproto.Message.ProtocolMessage.Type.MESSAGE_EDIT:
			ev.emit(
				'messages.update',
				[
					{
						key: { ...message.key, id: protocolMsg.key?.id },
						update: {
							message: {
								editedMessage: {
									message: protocolMsg.editedMessage
								}
							},
							messageTimestamp: protocolMsg.timestampMs
								? Math.floor(toNumber(protocolMsg.timestampMs) / 1000)
								: message.messageTimestamp
						}
					}
				]
			)
			break
		}
	} else if(content?.reactionMessage) {
		const reaction: waproto.IReaction = {
			...content.reactionMessage,
			key: message.key,
		}
		ev.emit('messages.reaction', [{
			reaction,
			key: content.reactionMessage?.key!,
		}])
	} else if(message.messageStubType) {
		const jid: string = message.key?.remoteJid!
		let participants: string[]
		const emitParticipantsUpdate = (action: ParticipantAction) => (
			ev.emit('group-participants.update', { id: jid, author: message.participant!, participants, action })
		)
		const emitGroupUpdate = (update: Partial<GroupMetadata>) => {
			ev.emit('groups.update', [{ id: jid, ...update, author: message.participant ?? undefined }])
		}

		const emitGroupRequestJoin = (participant: string, action: RequestJoinAction, method: RequestJoinMethod) => {
			ev.emit('group.join-request', { id: jid, author: message.participant!, participant, action, method: method! })
		}

		const participantsIncludesMe = () => participants.find(jid => areJidsSameUser(meId, jid))

		switch (message.messageStubType) {
		case WAMessageStubType.GROUP_PARTICIPANT_CHANGE_NUMBER:
			participants = message.messageStubParameters || []
			emitParticipantsUpdate('modify')
			break
		case WAMessageStubType.GROUP_PARTICIPANT_LEAVE:
		case WAMessageStubType.GROUP_PARTICIPANT_REMOVE:
			participants = message.messageStubParameters || []
			emitParticipantsUpdate('remove')
			if(participantsIncludesMe()) {
				chat.readOnly = true
			}

			break
		case WAMessageStubType.GROUP_PARTICIPANT_ADD:
		case WAMessageStubType.GROUP_PARTICIPANT_INVITE:
		case WAMessageStubType.GROUP_PARTICIPANT_ADD_REQUEST_JOIN:
			participants = message.messageStubParameters || []
			if(participantsIncludesMe()) {
				chat.readOnly = false
			}

			emitParticipantsUpdate('add')
			break
		case WAMessageStubType.GROUP_PARTICIPANT_DEMOTE:
			participants = message.messageStubParameters || []
			emitParticipantsUpdate('demote')
			break
		case WAMessageStubType.GROUP_PARTICIPANT_PROMOTE:
			participants = message.messageStubParameters || []
			emitParticipantsUpdate('promote')
			break
		case WAMessageStubType.GROUP_CHANGE_ANNOUNCE:
			const announceValue: string | undefined = message.messageStubParameters?.[0]
			emitGroupUpdate({ announce: announceValue === 'true' || announceValue === 'on' })
			break
		case WAMessageStubType.GROUP_CHANGE_RESTRICT:
			const restrictValue: string | undefined = message.messageStubParameters?.[0]
			emitGroupUpdate({ restrict: restrictValue === 'true' || restrictValue === 'on' })
			break
		case WAMessageStubType.GROUP_CHANGE_SUBJECT:
			const name: string | undefined = message.messageStubParameters?.[0]
			chat.name = name
			emitGroupUpdate({ subject: name })
			break
		case WAMessageStubType.GROUP_CHANGE_DESCRIPTION:
			const description: string | undefined = message.messageStubParameters?.[0]
			chat.description = description
			emitGroupUpdate({ desc: description })
			break
		case WAMessageStubType.GROUP_CHANGE_INVITE_LINK:
			const code: string | undefined = message.messageStubParameters?.[0]
			emitGroupUpdate({ inviteCode: code })
			break
		case WAMessageStubType.GROUP_MEMBER_ADD_MODE:
			const memberAddValue: string | undefined = message.messageStubParameters?.[0]
			emitGroupUpdate({ memberAddMode: memberAddValue === 'all_member_add' })
			break
		case WAMessageStubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE:
			const approvalMode: string | undefined = message.messageStubParameters?.[0]
			emitGroupUpdate({ joinApprovalMode: approvalMode === 'on' })
			break
		case WAMessageStubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD:
			const participant = message.messageStubParameters?.[0] as string
			const action = message.messageStubParameters?.[1] as RequestJoinAction
			const method = message.messageStubParameters?.[2] as RequestJoinMethod
			emitGroupRequestJoin(participant, action, method)
			break
		}

	} else if(content?.pollUpdateMessage) {
		const creationMsgKey: waproto.IMessageKey = content.pollUpdateMessage.pollCreationMessageKey!
		const pollMsg: waproto.IMessage | undefined = await getMessage(creationMsgKey)
		if(pollMsg) {
			const meIdNormalised: string = jidNormalizedUser(meId)
			const pollCreatorJid: string = getKeyAuthor(creationMsgKey, meIdNormalised)
			const voterJid: string = getKeyAuthor(message.key, meIdNormalised)
			const pollEncKey: Uint8Array = pollMsg.messageContextInfo?.messageSecret!

			try {
				const voteMsg: waproto.Message.PollVoteMessage = decryptPollVote(
					content.pollUpdateMessage.vote!,
					{
						pollEncKey,
						pollCreatorJid,
						pollMsgId: creationMsgKey.id!,
						voterJid,
					}
				)
				ev.emit('messages.update', [
					{
						key: creationMsgKey,
						update: {
							pollUpdates: [
								{
									pollUpdateMessageKey: message.key,
									vote: voteMsg,
									senderTimestampMs: (content.pollUpdateMessage.senderTimestampMs! as Long).toNumber(),
								}
							]
						}
					}
				])
			} catch(err) {
				logger?.error(
					{ err, creationMsgKey },
					'failed to decrypt poll vote'
				)
			}
		} else {
			logger?.warn(
				{ creationMsgKey },
				'poll creation message not found, cannot decrypt update'
			)
		}
	}

	if(Object.keys(chat).length > 1) {
		ev.emit('chats.update', [chat])
	}
}

export default processMessage
