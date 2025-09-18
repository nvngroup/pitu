import { Boom } from '@hapi/boom'
import { BinaryNode } from '../WABinary'

export interface RetryConfig {
	maxRetries: number
	baseDelayMs: number
	maxDelayMs: number
	jitter: boolean
}

export interface QueryFunction {
	<T>(node: BinaryNode, timeoutMs?: number): Promise<T>
}

/**
 * Enhanced query utility with configurable retry logic and exponential backoff
 */
export class QueryManager {
	private static defaultRetryConfig: RetryConfig = {
		maxRetries: 3,
		baseDelayMs: 1000,
		maxDelayMs: 10000,
		jitter: true
	}

	/**
	 * Execute a query with retry logic and exponential backoff
	 */
	static async executeWithRetry<T>(
		queryFn: QueryFunction,
		node: BinaryNode,
		timeoutMs?: number,
		retryConfig: Partial<RetryConfig> = {}
	): Promise<T> {
		const config = { ...this.defaultRetryConfig, ...retryConfig }
		let lastError: Error | undefined

		for(let attempt = 0; attempt <= config.maxRetries; attempt++) {
			try {
				return await queryFn(node, timeoutMs)
			} catch(error) {
				lastError = error as Error

				if(error instanceof Boom) {
					const statusCode = error.output?.statusCode
					if(statusCode === 401 || statusCode === 403 || statusCode === 404) {
						throw error
					}
				}

				if(attempt === config.maxRetries) {
					break
				}

				const delay = this.calculateDelay(attempt, config)
				await this.sleep(delay)
			}
		}

		throw lastError || new Error('Query failed after retries')
	}

	/**
	 * Calculate exponential backoff delay with optional jitter
	 */
	private static calculateDelay(attempt: number, config: RetryConfig): number {
		const exponentialDelay = Math.min(
			config.baseDelayMs * Math.pow(2, attempt),
			config.maxDelayMs
		)

		if(config.jitter) {
			const jitterRange = exponentialDelay * 0.25
			return exponentialDelay + (Math.random() - 0.5) * 2 * jitterRange
		}

		return exponentialDelay
	}

	/**
	 * Promise-based sleep utility
	 */
	private static sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}

	/**
	 * Create a query function with specific retry configuration
	 */
	static createRetryableQuery(
		baseQueryFn: QueryFunction,
		defaultRetryConfig?: Partial<RetryConfig>
	) {
		return (node: BinaryNode, timeoutMs?: number, retryConfig?: Partial<RetryConfig>) => this.executeWithRetry(
			baseQueryFn,
			node,
			timeoutMs,
			{ ...defaultRetryConfig, ...retryConfig }
		)
	}
}
