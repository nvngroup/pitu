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
