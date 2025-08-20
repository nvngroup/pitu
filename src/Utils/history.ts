import { AxiosRequestConfig } from 'axios'
import { promisify } from 'util'
import { inflate } from 'zlib'
import { waproto } from '../../WAProto'
import { Chat, Contact, WAMessageStubType } from '../Types'
import { isJidUser } from '../WABinary'
import { toNumber } from './generics'
import { normalizeMessageContent } from './messages'
import { downloadContentFromMessage } from './messages-media'

const inflatePromise = promisify(inflate)

export const downloadHistory = async(
	msg: waproto.Message.IHistorySyncNotification,
	options: AxiosRequestConfig<{}>
) => {
	const stream = await downloadContentFromMessage(msg, 'md-msg-hist', { options })
	const bufferArray: Buffer[] = []
	for await (const chunk of stream) {
		bufferArray.push(chunk)
	}

	let buffer = Buffer.concat(bufferArray)

	// decompress buffer
	const decompressed = await inflatePromise(buffer)
	buffer = Buffer.from(decompressed)

	const syncData = waproto.HistorySync.decode(buffer)
	return syncData
}

export const processHistoryMessage = (item: waproto.IHistorySync) => {
	const messages: waproto.IWebMessageInfo[] = []
	const contacts: Contact[] = []
	const chats: Chat[] = []

	switch (item.syncType) {
	case waproto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP:
	case waproto.HistorySync.HistorySyncType.RECENT:
	case waproto.HistorySync.HistorySyncType.FULL:
	case waproto.HistorySync.HistorySyncType.ON_DEMAND:
		for(const chat of item.conversations! as Chat[]) {
			contacts.push({
				id: chat.id,
				name: chat.name || undefined,
				lid: chat.lidJid || undefined,
				jid: isJidUser(chat.id) ? chat.id : undefined
			})

			const msgs = chat.messages || []
			delete chat.messages
			delete chat.archived
			delete chat.muteEndTime
			delete chat.pinned

			for(const item of msgs) {
				const message = item.message!
				messages.push(message)

				if(!chat.messages?.length) {
					// keep only the most recent message in the chat array
					chat.messages = [{ message }]
				}

				if(!message.key.fromMe && !chat.lastMessageRecvTimestamp) {
					chat.lastMessageRecvTimestamp = toNumber(message.messageTimestamp)
				}

				if(
					(message.messageStubType === WAMessageStubType.BIZ_PRIVACY_MODE_TO_BSP
					|| message.messageStubType === WAMessageStubType.BIZ_PRIVACY_MODE_TO_FB
					)
					&& message.messageStubParameters?.[0]
				) {
					contacts.push({
						id: message.key.participant || message.key.remoteJid!,
						verifiedName: message.messageStubParameters?.[0],
					})
				}
			}

			if(isJidUser(chat.id) && chat.readOnly && chat.archived) {
				delete chat.readOnly
			}

			chats.push({ ...chat })
		}

		break
	case waproto.HistorySync.HistorySyncType.PUSH_NAME:
		for(const c of item.pushnames!) {
			contacts.push({ id: c.id!, notify: c.pushname! })
		}

		break
	}

	return {
		chats,
		contacts,
		messages,
		syncType: item.syncType,
		progress: item.progress
	}
}

export const downloadAndProcessHistorySyncNotification = async(
	msg: waproto.Message.IHistorySyncNotification,
	options: AxiosRequestConfig<{}>
) => {
	const historyMsg = await downloadHistory(msg, options)
	return processHistoryMessage(historyMsg)
}

export const getHistoryMsg = (message: waproto.IMessage) => {
	const normalizedContent = !!message ? normalizeMessageContent(message) : undefined
	const anyHistoryMsg = normalizedContent?.protocolMessage?.historySyncNotification

	return anyHistoryMsg
}
