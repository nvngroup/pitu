import type { Boom } from '@hapi/boom'
import { waproto } from '../../WAProto'
import { AuthenticationCreds } from './Auth'
import { WACallEvent } from './Call'
import { Chat, ChatUpdate, PresenceData } from './Chat'
import { Contact } from './Contact'
import { GroupMetadata, ParticipantAction, RequestJoinAction, RequestJoinMethod } from './GroupMetadata'
import { Label } from './Label'
import { LabelAssociation } from './LabelAssociation'
import { MessageUpsertType, MessageUserReceiptUpdate, WAMessage, WAMessageKey, WAMessageUpdate } from './Message'
import { ConnectionState } from './State'

export type BaileysEventMap = {
	'connection.update': Partial<ConnectionState>
    'creds.update': Partial<AuthenticationCreds>
    'messaging-history.set': {
        chats: Chat[]
        contacts: Contact[]
        messages: WAMessage[]
        isLatest?: boolean
        progress?: number | null
        syncType?: waproto.HistorySync.HistorySyncType
        peerDataRequestSessionId?: string | null
    }
    'chats.upsert': Chat[]
    'chats.update': ChatUpdate[]
    'chats.phoneNumberShare': {lid: string, jid: string}
    'chats.delete': string[]
    'presence.update': { id: string, presences: { [participant: string]: PresenceData } }
    'contacts.upsert': Contact[]
    'contacts.update': Partial<Contact>[]
    'messages.delete': { keys: WAMessageKey[] } | { jid: string, all: true }
    'messages.update': WAMessageUpdate[]
    'messages.media-update': { key: WAMessageKey, media?: { ciphertext: Uint8Array, iv: Uint8Array }, error?: Boom }[]
    'messages.upsert': { messages: WAMessage[], type: MessageUpsertType, requestId?: string }
    'messages.reaction': { key: WAMessageKey, reaction: waproto.IReaction }[]
    'message-receipt.update': MessageUserReceiptUpdate[]
    'groups.upsert': GroupMetadata[]
    'groups.update': Partial<GroupMetadata>[]
    'group-participants.update': { id: string, author: string, participants: string[], action: ParticipantAction }
    'group.join-request': { id: string, author: string, participant: string, action: RequestJoinAction, method: RequestJoinMethod }
    'blocklist.set': { blocklist: string[] }
    'blocklist.update': { blocklist: string[], type: 'add' | 'remove' }
    'call': WACallEvent[]
    'labels.edit': Label
    'labels.association': { association: LabelAssociation, type: 'add' | 'remove' }
}

export type BufferedEventData = {
    historySets: {
        chats: { [jid: string]: Chat }
        contacts: { [jid: string]: Contact }
        messages: { [uqId: string]: WAMessage }
        empty: boolean
        isLatest: boolean
        progress?: number | null
        syncType?: waproto.HistorySync.HistorySyncType
        peerDataRequestSessionId?: string
    }
    chatUpserts: { [jid: string]: Chat }
    chatUpdates: { [jid: string]: ChatUpdate }
    chatDeletes: Set<string>
    contactUpserts: { [jid: string]: Contact }
    contactUpdates: { [jid: string]: Partial<Contact> }
    messageUpserts: { [key: string]: { type: MessageUpsertType, message: WAMessage } }
    messageUpdates: { [key: string]: WAMessageUpdate }
    messageDeletes: { [key: string]: WAMessageKey }
    messageReactions: { [key: string]: { key: WAMessageKey, reactions: waproto.IReaction[] } }
    messageReceipts: { [key: string]: { key: WAMessageKey, userReceipt: waproto.IUserReceipt[] } }
    groupUpdates: { [jid: string]: Partial<GroupMetadata> }
}

export type BaileysEvent = keyof BaileysEventMap

export interface BaileysEventEmitter {
	on<T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void): void
    off<T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void): void
    removeAllListeners<T extends keyof BaileysEventMap>(event: T): void
	emit<T extends keyof BaileysEventMap>(event: T, arg: BaileysEventMap[T]): boolean
}
