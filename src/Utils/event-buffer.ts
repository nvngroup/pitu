import EventEmitter from 'events'
import { waproto } from '../../WAProto'
import { BaileysEvent, BaileysEventMap, BufferedEventData, Chat, ChatUpdate, Contact, GroupMetadata, MessageUpsertType, WAMessage, WAMessageKey, WAMessageStatus, WAMessageUpdate } from '../Types'
import { trimUndefined } from './generics'
import { ILogger } from './logger'
import { updateMessageWithReaction, updateMessageWithReceipt } from './messages'
import { isRealMessage, shouldIncrementChatUnread } from './process-message'
import { BaileysBufferableEventEmitter, BaileysEventData, BUFFERABLE_EVENT_SET, BufferableEvent } from './types'

/**
 * The event buffer logically consolidates different events into a single event
 * making the data processing more efficient.
 * @param ev the baileys event emitter
 */
export const makeEventBuffer = (logger: ILogger): BaileysBufferableEventEmitter => {
	const ev = new EventEmitter()
	const historyCache = new Set<string>()

	let data: BufferedEventData = makeBufferData()
	let isBuffering = false

	ev.on('event', (map: BaileysEventData) => {
		for(const event in map) {
			ev.emit(event, map[event])
		}
	})

	function buffer() {
		if(!isBuffering) {
			logger.trace({}, 'Event buffer activated')
			isBuffering = true
		}
	}

	function flush() {
		if(!isBuffering) {
			return false
		}

		logger.trace({}, 'Flushing event buffer')
		isBuffering = false

		const newData: BufferedEventData = makeBufferData()
		const chatUpdates = Object.values(data.chatUpdates)
		let conditionalChatUpdatesLeft = 0
		for(const update of chatUpdates) {
			if(update.conditional) {
				conditionalChatUpdatesLeft += 1
				newData.chatUpdates[update.id!] = update
				delete data.chatUpdates[update.id!]
			}
		}

		const consolidatedData: Partial<BaileysEventMap> = consolidateEvents(data)
		if(Object.keys(consolidatedData).length) {
			ev.emit('event', consolidatedData)
		}

		data = newData

		logger.trace(
			{ conditionalChatUpdatesLeft },
			'released buffered events'
		)

		return true
	}

	return {
		process(handler) {
			const listener = (map: BaileysEventData) => {
				handler(map)
			}

			ev.on('event', listener)
			return () => {
				ev.off('event', listener)
			}
		},
		emit<T extends BaileysEvent>(event: BaileysEvent, evData: BaileysEventMap[T]) {
			if(isBuffering && BUFFERABLE_EVENT_SET.has(event)) {
				append(data, historyCache, event as BufferableEvent, evData, logger)
				return true
			}

			return ev.emit('event', { [event]: evData })
		},
		isBuffering() {
			return isBuffering
		},
		buffer,
		flush,
		createBufferedFunction(work) {
			return async(...args) => {
				buffer()
				try {
					return await work(...args)
				} finally { }
			}
		},
		on: (...args) => ev.on(...args),
		off: (...args) => ev.off(...args),
		removeAllListeners: (...args) => ev.removeAllListeners(...args),
	}
}

const makeBufferData = (): BufferedEventData => {
	return {
		historySets: {
			chats: { },
			messages: { },
			contacts: { },
			isLatest: false,
			empty: true
		},
		chatUpserts: { },
		chatUpdates: { },
		chatDeletes: new Set(),
		contactUpserts: { },
		contactUpdates: { },
		messageUpserts: { },
		messageUpdates: { },
		messageReactions: { },
		messageDeletes: { },
		messageReceipts: { },
		groupUpdates: { }
	}
}

function append<E extends BufferableEvent>(
	data: BufferedEventData,
	historyCache: Set<string>,
	event: E,
	eventData: any,
	logger: ILogger
) {
	switch (event) {
	case 'messaging-history.set':
		for(const chat of eventData.chats as Chat[]) {
			const existingChat: Chat = data.historySets.chats[chat.id]
			if(existingChat) {
				existingChat.endOfHistoryTransferType = chat.endOfHistoryTransferType
			}

			if(!existingChat && !historyCache.has(chat.id)) {
				data.historySets.chats[chat.id] = chat
				historyCache.add(chat.id)

				absorbingChatUpdate(chat)
			}
		}

		for(const contact of eventData.contacts as Contact[]) {
			const existingContact: Contact = data.historySets.contacts[contact.id]
			if(existingContact) {
				Object.assign(existingContact, trimUndefined(contact))
			} else {
				const historyContactId = `c:${contact.id}`
				const hasAnyName: string | undefined = contact.notify || contact.name || contact.verifiedName
				if(!historyCache.has(historyContactId) || hasAnyName) {
					data.historySets.contacts[contact.id] = contact
					historyCache.add(historyContactId)
				}
			}
		}

		for(const message of eventData.messages as WAMessage[]) {
			const key: string = stringifyMessageKey(message.key)
			const existingMsg: WAMessage = data.historySets.messages[key]
			if(!existingMsg && !historyCache.has(key)) {
				data.historySets.messages[key] = message
				historyCache.add(key)
			}
		}

		data.historySets.empty = false
		data.historySets.syncType = eventData.syncType
		data.historySets.progress = eventData.progress
		data.historySets.peerDataRequestSessionId = eventData.peerDataRequestSessionId
		data.historySets.isLatest = eventData.isLatest || data.historySets.isLatest

		break
	case 'chats.upsert':
		for(const chat of eventData as Chat[]) {
			let upsert: Chat = data.chatUpserts[chat.id]
			if(!upsert) {
				upsert = data.historySets[chat.id]
				if(upsert) {
					logger.debug({ chatId: chat.id }, 'absorbed chat upsert in chat set')
				}
			}

			if(upsert) {
				upsert = concatChats(upsert, chat)
			} else {
				upsert = chat
				data.chatUpserts[chat.id] = upsert
			}

			absorbingChatUpdate(upsert)

			if(data.chatDeletes.has(chat.id)) {
				data.chatDeletes.delete(chat.id)
			}
		}

		break
	case 'chats.update':
		for(const update of eventData as ChatUpdate[]) {
			const chatId: string = update.id!
			const conditionMatches: boolean | undefined = update.conditional ? update.conditional(data) : true
			if(conditionMatches) {
				delete update.conditional

				const upsert: Chat = data.historySets.chats[chatId] || data.chatUpserts[chatId]
				if(upsert) {
					concatChats(upsert, update)
				} else {
					const chatUpdate = data.chatUpdates[chatId] || { }
					data.chatUpdates[chatId] = concatChats(chatUpdate, update)
				}
			} else if(conditionMatches === undefined) {
				data.chatUpdates[chatId] = update
			}

			if(data.chatDeletes.has(chatId)) {
				data.chatDeletes.delete(chatId)
			}
		}

		break
	case 'chats.delete':
		for(const chatId of eventData as string[]) {
			if(!data.chatDeletes.has(chatId)) {
				data.chatDeletes.add(chatId)
			}

			if(data.chatUpdates[chatId]) {
				delete data.chatUpdates[chatId]
			}

			if(data.chatUpserts[chatId]) {
				delete data.chatUpserts[chatId]

			}

			if(data.historySets.chats[chatId]) {
				delete data.historySets.chats[chatId]
			}
		}

		break
	case 'contacts.upsert':
		for(const contact of eventData as Contact[]) {
			let upsert: Contact = data.contactUpserts[contact.id]
			if(!upsert) {
				upsert = data.historySets.contacts[contact.id]
				if(upsert) {
					logger.debug({ contactId: contact.id }, 'absorbed contact upsert in contact set')
				}
			}

			if(upsert) {
				upsert = Object.assign(upsert, trimUndefined(contact))
			} else {
				upsert = contact
				data.contactUpserts[contact.id] = upsert
			}

			if(data.contactUpdates[contact.id]) {
				upsert = Object.assign(data.contactUpdates[contact.id], trimUndefined(contact)) as Contact
				delete data.contactUpdates[contact.id]
			}
		}

		break
	case 'contacts.update':
		const contactUpdates = eventData as BaileysEventMap['contacts.update']
		for(const update of contactUpdates) {
			const id: string = update.id!
			const upsert: Contact = data.historySets.contacts[id] || data.contactUpserts[id]
			if(upsert) {
				Object.assign(upsert, update)
			} else {
				const contactUpdate: Partial<Contact> = data.contactUpdates[id] || { }
				data.contactUpdates[id] = Object.assign(contactUpdate, update)
			}
		}

		break
	case 'messages.upsert':
		const { messages, type } = eventData as BaileysEventMap['messages.upsert']
		for(const message of messages) {
			const key: string = stringifyMessageKey(message.key)
			let existing: WAMessage = data.messageUpserts[key]?.message
			if(!existing) {
				existing = data.historySets.messages[key]
				if(existing) {
					logger.debug({ messageId: key }, 'absorbed message upsert in message set')
				}
			}

			if(existing) {
				message.messageTimestamp = existing.messageTimestamp
			}

			if(data.messageUpdates[key]) {
				logger.debug({}, 'absorbed prior message update in message upsert')
				Object.assign(message, data.messageUpdates[key].update)
				delete data.messageUpdates[key]
			}

			if(data.historySets.messages[key]) {
				data.historySets.messages[key] = message
			} else {
				data.messageUpserts[key] = {
					message,
					type: type === 'notify' || data.messageUpserts[key]?.type === 'notify'
						? 'notify'
						: type
				}
			}
		}

		break
	case 'messages.update':
		const msgUpdates = eventData as BaileysEventMap['messages.update']
		for(const { key, update } of msgUpdates) {
			const keyStr: string = stringifyMessageKey(key)
			const existing: WAMessage = data.historySets.messages[keyStr] || data.messageUpserts[keyStr]?.message
			if(existing) {
				Object.assign(existing, update)
				if(update.status === WAMessageStatus.READ && !key.fromMe) {
					decrementChatReadCounterIfMsgDidUnread(existing)
				}
			} else {
				const msgUpdate: WAMessageUpdate = data.messageUpdates[keyStr] || { key, update: { } }
				Object.assign(msgUpdate.update, update)
				data.messageUpdates[keyStr] = msgUpdate
			}
		}

		break
	case 'messages.delete':
		const deleteData = eventData as BaileysEventMap['messages.delete']
		if('keys' in deleteData) {
			const { keys } = deleteData
			for(const key of keys) {
				const keyStr: string = stringifyMessageKey(key)
				if(!data.messageDeletes[keyStr]) {
					data.messageDeletes[keyStr] = key

				}

				if(data.messageUpserts[keyStr]) {
					delete data.messageUpserts[keyStr]
				}

				if(data.messageUpdates[keyStr]) {
					delete data.messageUpdates[keyStr]
				}
			}
		} else {
			// TODO: add support for "all" deletion
			logger.trace({ eventData }, 'messages.delete with "all" not yet supported in event buffer')
		}

		break
	case 'messages.reaction':
		const reactions = eventData as BaileysEventMap['messages.reaction']
		for(const { key, reaction } of reactions) {
			const keyStr: string = stringifyMessageKey(key)
			const existing = data.messageUpserts[keyStr]
			if(existing) {
				updateMessageWithReaction(existing.message, reaction)
			} else {
				data.messageReactions[keyStr] = data.messageReactions[keyStr]
					|| { key, reactions: [] }
				updateMessageWithReaction(data.messageReactions[keyStr], reaction)
			}
		}

		break
	case 'message-receipt.update':
		const receipts = eventData as BaileysEventMap['message-receipt.update']
		for(const { key, receipt } of receipts) {
			const keyStr: string = stringifyMessageKey(key)
			const existing = data.messageUpserts[keyStr]
			if(existing) {
				updateMessageWithReceipt(existing.message, receipt)
			} else {
				data.messageReceipts[keyStr] = data.messageReceipts[keyStr]
					|| { key, userReceipt: [] }
				updateMessageWithReceipt(data.messageReceipts[keyStr], receipt)
			}
		}

		break
	case 'groups.update':
		const groupUpdates = eventData as BaileysEventMap['groups.update']
		for(const update of groupUpdates) {
			const id: string = update.id!
			const groupUpdate: Partial<GroupMetadata> = data.groupUpdates[id] || { }
			if(!data.groupUpdates[id]) {
				data.groupUpdates[id] = Object.assign(groupUpdate, update)

			}
		}

		break
	default:
		throw new Error(`"${event}" cannot be buffered`)
	}

	function absorbingChatUpdate(existing: Chat) {
		const chatId: string = existing.id
		const update = data.chatUpdates[chatId]
		if(update) {
			const conditionMatches = update.conditional ? update.conditional(data) : true
			if(conditionMatches) {
				delete update.conditional
				logger.debug({ chatId }, 'absorbed chat update in existing chat')
				Object.assign(existing, concatChats(update as Chat, existing))
				delete data.chatUpdates[chatId]
			} else if(conditionMatches === false) {
				logger.debug({ chatId }, 'chat update condition fail, removing')
				delete data.chatUpdates[chatId]
			}
		}
	}

	function decrementChatReadCounterIfMsgDidUnread(message: WAMessage) {
		const chatId: string = message.key.remoteJid!
		const chat = data.chatUpdates[chatId] || data.chatUpserts[chatId]
		if(
			isRealMessage(message, '')
			&& shouldIncrementChatUnread(message)
			&& typeof chat?.unreadCount === 'number'
			&& chat.unreadCount > 0
		) {
			logger.debug({ chatId: chat.id }, 'decrementing chat counter')
			chat.unreadCount -= 1
			if(chat.unreadCount === 0) {
				delete chat.unreadCount
			}
		}
	}
}

function consolidateEvents(data: BufferedEventData) {
	const map: BaileysEventData = { }

	if(!data.historySets.empty) {
		map['messaging-history.set'] = {
			chats: Object.values(data.historySets.chats),
			messages: Object.values(data.historySets.messages),
			contacts: Object.values(data.historySets.contacts),
			syncType: data.historySets.syncType,
			progress: data.historySets.progress,
			isLatest: data.historySets.isLatest,
			peerDataRequestSessionId: data.historySets.peerDataRequestSessionId
		}
	}

	const chatUpsertList: Chat[] = Object.values(data.chatUpserts)
	if(chatUpsertList.length) {
		map['chats.upsert'] = chatUpsertList
	}

	const chatUpdateList = Object.values(data.chatUpdates)
	if(chatUpdateList.length) {
		map['chats.update'] = chatUpdateList
	}

	const chatDeleteList: string[] = Array.from(data.chatDeletes)
	if(chatDeleteList.length) {
		map['chats.delete'] = chatDeleteList
	}

	const messageUpsertList = Object.values(data.messageUpserts)
	if(messageUpsertList.length) {
		const type: MessageUpsertType = messageUpsertList[0].type
		map['messages.upsert'] = {
			messages: messageUpsertList.map(m => m.message),
			type
		}
	}

	const messageUpdateList: WAMessageUpdate[] = Object.values(data.messageUpdates)
	if(messageUpdateList.length) {
		map['messages.update'] = messageUpdateList
	}

	const messageDeleteList: WAMessageKey[] = Object.values(data.messageDeletes)
	if(messageDeleteList.length) {
		map['messages.delete'] = { keys: messageDeleteList }
	}

	const messageReactionList = Object.values(data.messageReactions).flatMap(
		({ key, reactions }) => reactions.flatMap(reaction => ({ key, reaction }))
	)
	if(messageReactionList.length) {
		map['messages.reaction'] = messageReactionList
	}

	const messageReceiptList = Object.values(data.messageReceipts).flatMap(
		({ key, userReceipt }) => userReceipt.flatMap(receipt => ({ key, receipt }))
	)
	if(messageReceiptList.length) {
		map['message-receipt.update'] = messageReceiptList
	}

	const contactUpsertList: Contact[] = Object.values(data.contactUpserts)
	if(contactUpsertList.length) {
		map['contacts.upsert'] = contactUpsertList
	}

	const contactUpdateList: Partial<Contact>[] = Object.values(data.contactUpdates)
	if(contactUpdateList.length) {
		map['contacts.update'] = contactUpdateList
	}

	const groupUpdateList: Partial<GroupMetadata>[] = Object.values(data.groupUpdates)
	if(groupUpdateList.length) {
		map['groups.update'] = groupUpdateList
	}

	return map
}

function concatChats<C extends Partial<Chat>>(a: C, b: Partial<Chat>) {
	if(b.unreadCount === null &&
		a.unreadCount! < 0) {
		a.unreadCount = undefined
		b.unreadCount = undefined
	}

	if(typeof a.unreadCount === 'number' && typeof b.unreadCount === 'number') {
		b = { ...b }
		if(b.unreadCount! >= 0) {
			b.unreadCount = Math.max(b.unreadCount!, 0) + Math.max(a.unreadCount, 0)
		}
	}

	return Object.assign(a, b)
}

const stringifyMessageKey = (key: waproto.IMessageKey) => `${key.remoteJid},${key.id},${key.fromMe ? '1' : '0'}`
