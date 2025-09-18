
import { AxiosRequestConfig } from 'axios'
import type { Agent } from 'https'
import type { URL } from 'url'
import { waproto } from '../../WAProto'
import { ILogger } from '../Utils/logger'
import { AuthenticationState, SignalAuthState, TransactionCapabilityOptions } from './Auth'
import { GroupMetadata } from './GroupMetadata'
import { MediaConnInfo } from './Message'
import { SignalRepository } from './Signal'

export type WAVersion = [number, number, number]
export type WABrowserDescription = [string, string, string]

export type CacheStore = {
    get<T>(key: string): T | undefined
    set<T>(key: string, value: T): void
    del(key: string): void
    flushAll(): void
}

export type SocketConfig = {
    waWebSocketUrl: string | URL
    connectTimeoutMs: number
    defaultQueryTimeoutMs: number | undefined
    keepAliveIntervalMs: number
	mobile?: boolean
    agent?: Agent
    logger: ILogger
    version: WAVersion
    browser: WABrowserDescription
    fetchAgent?: Agent
    printQRInTerminal?: boolean
    emitOwnEvents: boolean
    customUploadHosts: MediaConnInfo['hosts']
    retryRequestDelayMs: number
    maxMsgRetryCount: number
    qrTimeout?: number
    auth: AuthenticationState
    shouldSyncHistoryMessage: (msg: waproto.Message.IHistorySyncNotification) => boolean
    transactionOpts: TransactionCapabilityOptions
    markOnlineOnConnect: boolean
    countryCode: string
    mediaCache?: CacheStore
    msgRetryCounterCache?: CacheStore
    userDevicesCache?: CacheStore
    callOfferCache?: CacheStore
    placeholderResendCache?: CacheStore
    onWhatsAppCache?: CacheStore
    linkPreviewImageThumbnailWidth: number
    syncFullHistory: boolean
    fireInitQueries: boolean
    generateHighQualityLinkPreview: boolean
    shouldIgnoreJid: (jid: string) => boolean | undefined
    patchMessageBeforeSending: (
        msg: waproto.IMessage,
        recipientJids: string[],
    ) => Promise<waproto.IMessage> | waproto.IMessage
    appStateMacVerification: {
        patch: boolean
        snapshot: boolean
    }
    options: AxiosRequestConfig<{}>
    getMessage: (key: waproto.IMessageKey) => Promise<waproto.IMessage | undefined>
    cachedGroupMetadata: (jid: string) => Promise<GroupMetadata | undefined>
    makeSignalRepository: (auth: SignalAuthState) => SignalRepository
}
