
import { AxiosRequestConfig } from 'axios'
import type { Readable } from 'stream'
import type { URL } from 'url'
import { waproto } from '../../WAProto'
import { MEDIA_HKDF_KEY_MAPPING } from '../Defaults'
import { BinaryNode } from '../WABinary'
import type { GroupMetadata } from './GroupMetadata'
import { CacheStore } from './Socket'

export { waproto as WAProto }
export type WAMessage = waproto.IWebMessageInfo
export type WAMessageContent = waproto.IMessage
export type WAContactMessage = waproto.Message.IContactMessage
export type WAContactsArrayMessage = waproto.Message.IContactsArrayMessage
export type WAMessageKey = waproto.IMessageKey & {
    senderPn?: string
    senderLid?: string
    participantPn?: string
    participantLid?: string
    peerRecipientPn?: string
    peerRecipientLid?: string
    isViewOnce?: boolean
}
export type WATextMessage = waproto.Message.IExtendedTextMessage
export type WAContextInfo = waproto.IContextInfo
export type WALocationMessage = waproto.Message.ILocationMessage
export type WAGenericMediaMessage = waproto.Message.IVideoMessage | waproto.Message.IImageMessage | waproto.Message.IAudioMessage | waproto.Message.IDocumentMessage | waproto.Message.IStickerMessage
export const WAMessageStubType = waproto.WebMessageInfo.StubType
export const WAMessageStatus = waproto.WebMessageInfo.Status
import { ILogger } from '../Utils/logger'
export type WAMediaPayloadURL = { url: URL | string }
export type WAMediaPayloadStream = { stream: Readable }
export type WAMediaUpload = Buffer | WAMediaPayloadStream | WAMediaPayloadURL
export type MessageType = keyof waproto.Message

export type MessageWithContextInfo =
    | 'imageMessage'
    | 'contactMessage'
    | 'locationMessage'
    | 'extendedTextMessage'
    | 'documentMessage'
    | 'audioMessage'
    | 'videoMessage'
    | 'call'
    | 'contactsArrayMessage'
    | 'liveLocationMessage'
    | 'templateMessage'
    | 'stickerMessage'
    | 'groupInviteMessage'
    | 'templateButtonReplyMessage'
    | 'productMessage'
    | 'listMessage'
    | 'orderMessage'
    | 'listResponseMessage'
    | 'buttonsMessage'
    | 'buttonsResponseMessage'
    | 'interactiveMessage'
    | 'interactiveResponseMessage'
    | 'pollCreationMessage'
    | 'requestPhoneNumberMessage'
    | 'messageHistoryBundle'
    | 'eventMessage'
    | 'newsletterAdminInviteMessage'
    | 'albumMessage'
    | 'stickerPackMessage'
    | 'pollResultSnapshotMessage'
    | 'messageHistoryNotice'

export const nativeFlowSpecials = [
    'mpm', 'cta_catalog', 'send_location',
    'call_permission_request', 'wa_payment_transaction_details',
    'automated_greeting_message_view_catalog', 'payment_info', 'review_and_pay'
]

export type DownloadableMessage = { mediaKey?: Uint8Array | null, directPath?: string | null, url?: string | null }

export type MessageReceiptType = 'read' | 'read-self' | 'hist_sync' | 'peer_msg' | 'sender' | 'inactive' | 'played' | undefined

export type MediaConnInfo = {
    auth: string
    ttl: number
    hosts: { hostname: string, maxContentLengthBytes: number }[]
    fetchDate: Date
}

export interface WAUrlInfo {
    'canonical-url': string
    'matched-text': string
    title: string
    description?: string
    jpegThumbnail?: Buffer
    highQualityThumbnail?: waproto.Message.IImageMessage
    originalThumbnailUrl?: string
}

export interface Carousel {
    image?: WAMediaUpload
    video?: WAMediaUpload
    product?: WASendableProduct
    title: string
    body: string
    footer: string
    buttons: waproto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[]
}

type Mentionable = {
    /** list of jids that are mentioned in the accompanying text */
    mentions?: string[]
}
type Contextable = {
    /** add contextInfo to the message */
    contextInfo?: waproto.IContextInfo
}
type ViewOnce = {
    viewOnce?: boolean
}

type Buttonable = {
    buttons?: waproto.Message.ButtonsMessage.IButton[]
}

type Templatable = {
    templateButtons?: waproto.IHydratedTemplateButton[]

    footer?: string
}

type Interactiveable = {
    interactiveButtons?: waproto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[]
    title?: string
    subtitle?: string
    footer?: string
    hasMediaAttachment?: boolean
}

type Editable = {
  edit?: WAMessageKey
}

type Shopable = {
    shop?: waproto.Message.InteractiveMessage.IShopMessage
    title?: string
    subtitle?: string
    footer?: string
    hasMediaAttachment?: boolean
}

type Collectionable = {
    collection?: waproto.Message.InteractiveMessage.ICollectionMessage
    title?: string
    subtitle?: string
    footer?: string
    hasMediaAttachment?: boolean
}

type Listable = {
    /** Sections of the List */
    sections?: waproto.Message.ListMessage.ISection[]
    /** Title of a List Message only */
    title?: string
    /** Text of the button on the list (required) */
    buttonText?: string
    /** ListType of a List Message only */
    listType?: waproto.Message.ListMessage.ListType
}

type Cardsable = {
    cards?: Carousel[]
    title?: string
    subtitle?: string
    footer?: string
}

type WithDimensions = {
    width?: number
    height?: number
}

export type PollMessageOptions = {
    name: string
    selectableCount?: number
    values: string[]
    messageSecret?: Uint8Array
    toAnnouncementGroup?: boolean
}

export type EventMessageOptions = {
    name: string
    description?: string
    startDate: Date
    endDate?: Date
    location?: WALocationMessage
    call?: 'audio' | 'video'
    isCancelled?: boolean
    isScheduleCall?: boolean
    extraGuestsAllowed?: boolean
    messageSecret?: Uint8Array<ArrayBufferLike>
}

type SharePhoneNumber = {
    sharePhoneNumber: boolean
}

type RequestPhoneNumber = {
    requestPhoneNumber: boolean
}

export type MediaType = keyof typeof MEDIA_HKDF_KEY_MAPPING
export type AnyMediaMessageContent = (
    ({
        image: WAMediaUpload
        caption?: string
        jpegThumbnail?: string
    } & Mentionable & Contextable & Buttonable & Templatable & WithDimensions)
    | ({
        video: WAMediaUpload
        caption?: string
        gifPlayback?: boolean
        jpegThumbnail?: string
        ptv?: boolean
    } & Mentionable & Contextable & Buttonable & Templatable & WithDimensions)
    | {
        audio: WAMediaUpload
        ptt?: boolean
        seconds?: number
    }
    | ({
        sticker: WAMediaUpload
        isAnimated?: boolean
    } & WithDimensions) | ({
        document: WAMediaUpload
        mimetype: string
        fileName?: string
        caption?: string
    } & Contextable & Buttonable & Templatable))
    & { mimetype?: string } & Editable

export type ButtonReplyInfo = {
    displayText: string
    id: string
    index: number
} | {
    title?: string
    description?: string
    rowId: string
} | {
    body?: string
    nativeFlows?: {
        name: string
        paramsJson: string
        version: number
    }
}

export type PaymentInfo = {
    note: string
    currency?: string
    offset?: number
    amount?: number
    expiry?: number
    from?: string
    image?: {
        placeholderArgb: number
        textArgb: number
        subtextArgb: number
    }
}

export type GroupInviteInfo = {
    inviteCode: string
    inviteExpiration: number
    text: string
    jid: string
    subject: string
}

export type WASendableProduct = Omit<waproto.Message.ProductMessage.IProductSnapshot, 'productImage'> & {
    productImage: WAMediaUpload
}

export type AnyRegularMessageContent = (
    ({
        body: string
        linkPreview?: WAUrlInfo | null
    } & Interactiveable
    | {
        text: string
        linkPreview?: WAUrlInfo | null
    }
        & Mentionable & Contextable & Buttonable & Templatable & Interactiveable & Shopable & Collectionable & Cardsable & Listable & Editable)
    | AnyMediaMessageContent
    | ({
        poll: PollMessageOptions
    } & Mentionable & Contextable & Buttonable & Templatable & Interactiveable & Shopable & Collectionable & Cardsable & Listable & Editable)
    | {
        contacts: {
            displayName?: string
            contacts: waproto.Message.IContactMessage[]
        }
    }
    | {
        location: WALocationMessage
    }
    | { react: waproto.Message.IReactionMessage }
    | {
        buttonReply: ButtonReplyInfo
        type: 'template' | 'plain' | 'list' | 'interactive'
    }
    | {
        groupInvite: GroupInviteInfo
    }
    | {
        listReply: Omit<waproto.Message.IListResponseMessage, 'contextInfo'>
    }
    | {
        pin: WAMessageKey
        type: waproto.PinInChat.Type
        /**
         * 24 hours, 7 days, 30 days
         */
        time?: 86400 | 604800 | 2592000
    }
    | {
        product: WASendableProduct
        businessOwnerJid?: string
        body?: string
        footer?: string
    }
    | {
        payment: PaymentInfo
    } | SharePhoneNumber | RequestPhoneNumber
    | {
        event: EventMessageOptions
    }
) & ViewOnce

export type AnyMessageContent = AnyRegularMessageContent | {
	forward: WAMessage
	force?: boolean
} | {
	delete: WAMessageKey
} | {
	disappearingMessagesInChat: boolean | number
}

export type GroupMetadataParticipants = Pick<GroupMetadata, 'participants'>

type MinimalRelayOptions = {
    messageId?: string
    useCachedGroupMetadata?: boolean
}

export type MessageRelayOptions = MinimalRelayOptions & {
    participant?: { jid: string, count: number }
    additionalAttributes?: { [_: string]: string }
    additionalNodes?: BinaryNode[]
    useUserDevicesCache?: boolean
    statusJidList?: string[],
    isretry?: boolean
}

export type MiscMessageGenerationOptions = MinimalRelayOptions & {
	timestamp?: Date
	quoted?: WAMessage
    ephemeralExpiration?: number | string
    mediaUploadTimeoutMs?: number
    statusJidList?: string[]
    backgroundColor?: string
    font?: number
    broadcast?: boolean
}
export type MessageGenerationOptionsFromContent = MiscMessageGenerationOptions & {
	userJid: string
}

export type WAMediaUploadFunction = (encFilePath: string, opts: { fileEncSha256B64: string, mediaType: MediaType, timeoutMs?: number }) => Promise<{ mediaUrl: string, directPath: string }>

export type MediaGenerationOptions = {
	logger?: ILogger
    mediaTypeOverride?: MediaType
    upload: WAMediaUploadFunction
    mediaCache?: CacheStore

    mediaUploadTimeoutMs?: number

    options?: AxiosRequestConfig

    backgroundColor?: string

    font?: number
    jid?: string
}
export type MessageContentGenerationOptions = MediaGenerationOptions & {
	getUrlInfo?: (text: string) => Promise<WAUrlInfo | undefined>
    getProfilePicUrl?: (jid: string, type: 'image' | 'preview') => Promise<string | undefined>
    getCallLink?: (type: 'audio' | 'video', event?: { startTime: number }) => Promise<string | undefined>
}
export type MessageGenerationOptions = MessageContentGenerationOptions & MessageGenerationOptionsFromContent

/**
 * Type of message upsert
 * 1. notify => notify the user, this message was just received
 * 2. append => append the message to the chat history, no notification required
 */
export type MessageUpsertType = 'append' | 'notify'

export type MessageUserReceipt = waproto.IUserReceipt

export type WAMessageUpdate = { update: Partial<WAMessage>, key: waproto.IMessageKey }

export type WAMessageCursor = { before: WAMessageKey | undefined } | { after: WAMessageKey | undefined }

export type MessageUserReceiptUpdate = { key: waproto.IMessageKey, receipt: MessageUserReceipt }

export type MediaDecryptionKeyInfo = {
    iv: Buffer
    cipherKey: Buffer
    macKey?: Buffer
}

export type MinimalMessage = Pick<waproto.IWebMessageInfo, 'key' | 'messageTimestamp'>
