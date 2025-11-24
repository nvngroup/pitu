import type { waproto } from '../../WAProto/index.js'
import { CacheManager } from '../Socket'
import type { CacheStore } from '../Types'
import type { ILogger } from './logger'

/** Timeout for session recreation - 1 hour */
const RECREATE_SESSION_TIMEOUT = 60 * 60 // 1 hour in seconds
const PHONE_REQUEST_DELAY = 3000
export interface RecentMessageKey {
	to: string
	id: string
}

export interface RecentMessage {
	message: waproto.IMessage
	timestamp: number
}

export interface SessionRecreateHistory {
	[jid: string]: number // timestamp
}

export interface RetryCounter {
	[messageId: string]: number
}

export interface PendingPhoneRequest {
	[messageId: string]: NodeJS.Timeout
}

export interface RetryStatistics {
	totalRetries: number
	successfulRetries: number
	failedRetries: number
	mediaRetries: number
	sessionRecreations: number
	phoneRequests: number
}

export class MessageRetryManager {
	private recentMessagesMap: CacheStore = CacheManager.getInstance('RECENT_MESSAGES_MAP')
	private sessionRecreateHistory: CacheStore = CacheManager.getInstance('SESSION_RECREATE_HISTORY')
	private retryCounters: CacheStore = CacheManager.getInstance('RETRY_COUNTERS')
	private pendingPhoneRequests: PendingPhoneRequest = {}
	private readonly maxMsgRetryCount: number = 5
	private statistics: RetryStatistics = {
		totalRetries: 0,
		successfulRetries: 0,
		failedRetries: 0,
		mediaRetries: 0,
		sessionRecreations: 0,
		phoneRequests: 0
	}

	constructor(
		private logger: ILogger,
		maxMsgRetryCount: number
	) {
		this.maxMsgRetryCount = maxMsgRetryCount
	}

	/**
	 * Add a recent message to the cache for retry handling
	 */
	addRecentMessage(to: string, id: string, message: waproto.IMessage): void {
		const key: RecentMessageKey = { to, id }
		const keyStr = this.keyToString(key)

		// Add new message
		this.recentMessagesMap.set(keyStr, {
			message,
			timestamp: Date.now()
		})

		this.logger.debug({ to, id }, `Added message to retry cache: ${to}/${id}`)
	}

	/**
	 * Get a recent message from the cache
	 */
	getRecentMessage(to: string, id: string): RecentMessage | undefined {
		const key: RecentMessageKey = { to, id }
		const keyStr = this.keyToString(key)
		return this.recentMessagesMap.get(keyStr)
	}

	/**
	 * Check if a session should be recreated based on retry count and history
	 */
	shouldRecreateSession(jid: string, retryCount: number, hasSession: boolean): { reason: string; recreate: boolean } {
		// If we don't have a session, always recreate
		if (!hasSession) {
			this.sessionRecreateHistory.set(jid, Date.now())
			this.statistics.sessionRecreations++
			return {
				reason: "we don't have a session with them",
				recreate: true
			}
		}

		// Only consider recreation if retry count > 1
		if (retryCount < 2) {
			return { reason: '', recreate: false }
		}

		const now = Date.now()
		const prevTime = this.sessionRecreateHistory.get<number>(jid)

		// If no previous recreation or it's been more than an hour
		if (!prevTime || now - prevTime > RECREATE_SESSION_TIMEOUT * 1000) {
			this.sessionRecreateHistory.set(jid, now)
			this.statistics.sessionRecreations++
			return {
				reason: 'retry count > 1 and over an hour since last recreation',
				recreate: true
			}
		}

		return { reason: '', recreate: false }
	}

	/**
	 * Increment retry counter for a message
	 */
	incrementRetryCount(messageId: string): number {
		const currentCount = this.retryCounters.get<number>(messageId) || 0
		this.retryCounters.set(messageId, currentCount + 1)
		this.statistics.totalRetries++
		return this.retryCounters.get<number>(messageId)!
	}

	/**
	 * Get retry count for a message
	 */
	getRetryCount(messageId: string): number {
		return this.retryCounters.get<number>(messageId) || 0
	}

	/**
	 * Check if message has exceeded maximum retry attempts
	 */
	hasExceededMaxRetries(messageId: string): boolean {
		return this.getRetryCount(messageId) >= this.maxMsgRetryCount
	}

	/**
	 * Mark retry as successful
	 */
	markRetrySuccess(messageId: string): void {
		this.statistics.successfulRetries++
		// Clean up retry counter for successful message
		this.retryCounters.del(messageId)
		this.cancelPendingPhoneRequest(messageId)
	}

	/**
	 * Mark retry as failed
	 */
	markRetryFailed(messageId: string): void {
		this.statistics.failedRetries++
		this.retryCounters.del(messageId)
	}

	/**
	 * Schedule a phone request with delay
	 */
	schedulePhoneRequest(messageId: string, callback: () => void, delay: number = PHONE_REQUEST_DELAY): void {
		// Cancel any existing request for this message
		this.cancelPendingPhoneRequest(messageId)

		this.pendingPhoneRequests[messageId] = setTimeout(() => {
			delete this.pendingPhoneRequests[messageId]
			this.statistics.phoneRequests++
			callback()
		}, delay)

		this.logger.debug({ messageId, delay }, `Scheduled phone request for message ${messageId} with ${delay}ms delay`)
	}

	/**
	 * Cancel pending phone request
	 */
	cancelPendingPhoneRequest(messageId: string): void {
		const timeout = this.pendingPhoneRequests[messageId]
		if (timeout) {
			clearTimeout(timeout)
			delete this.pendingPhoneRequests[messageId]
			this.logger.debug({ messageId }, `Cancelled pending phone request for message ${messageId}`)
		}
	}

	/**
		* Dispose the manager and clear timers/caches to avoid leaks
		*/
	shutdown(): void {
		for (const timeout of Object.values(this.pendingPhoneRequests)) {
			clearTimeout(timeout)
		}

		this.pendingPhoneRequests = {}
		// this.recentMessagesMap.clear()
		// this.sessionRecreateHistory.clear()
		// this.retryCounters.clear()
		this.logger.debug({}, 'Message retry manager shutdown complete')
	}

	private keyToString(key: RecentMessageKey): string {
		return `${key.to}:${key.id}`
	}
}
