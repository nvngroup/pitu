import logger from '../../Utils/logger'
import { GROUP_CONSTANTS } from './types'

interface QueueJob<T> {
  awaitable: () => Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

const _queueAsyncBuckets = new Map<string | number, Array<QueueJob<any>>>()

async function _asyncQueueExecutor(queue: Array<QueueJob<any>>, cleanup: () => void): Promise<void> {
	let offset = 0
	while(offset < queue.length) {
		const limit: number = Math.min(queue.length, offset + GROUP_CONSTANTS.QUEUE_GC_LIMIT)
		for(let i = offset; i < limit; i++) {
			const job = queue[i]
			try {
				job.resolve(await job.awaitable())
			} catch(e) {
				job.reject(e)
			}
		}

		if(limit < queue.length) {
			queue.splice(0, limit)
			offset = 0
		} else {
			break
		}
	}

	cleanup()
}

export default function queueJob<T>(bucket: string | number, awaitable: () => Promise<T>): Promise<T> {
	if(typeof bucket !== 'string') {
		logger.warn({ bucket }, 'Unhandled bucket type (for naming)')
	}

	let inactive = false
	if(!_queueAsyncBuckets.has(bucket)) {
		_queueAsyncBuckets.set(bucket, [])
		inactive = true
	}

	const queue = _queueAsyncBuckets.get(bucket)!
	const job = new Promise<T>((resolve, reject) => {
		queue.push({
			awaitable,
			resolve: resolve as (value: any) => void,
			reject
		})
	})

	if(inactive) {
		_asyncQueueExecutor(queue, () => _queueAsyncBuckets.delete(bucket))
	}

	return job
}
