export interface MessageRelayMutexConfig {
	maxConcurrent?: number
	maxQueueSize?: number
}

export const makeMessageRelayMutex = (config: MessageRelayMutexConfig = {}) => {
	const maxConcurrent: number = config.maxConcurrent || 5
	const maxQueueSize: number = config.maxQueueSize || 100

	let activeCount = 0
	const queue: Array<{
		task: () => Promise<any>
		resolve: (value: any) => void
		reject: (error: any) => void
	}> = []

	const processNext = () => {
		if (activeCount >= maxConcurrent || queue.length === 0) {
			return
		}

		const next = queue.shift()
		if (!next) {
			return
		}

		activeCount++

		next.task()
			.then(next.resolve)
			.catch(next.reject)
			.finally(() => {
				activeCount--
				processNext()
			})
	}

	return {
		async mutex<T>(task: () => Promise<T>): Promise<T> {
			if (queue.length >= maxQueueSize) {
				throw new Error(`Message relay queue is full (max: ${maxQueueSize}). Too many concurrent requests.`)
			}

			return new Promise<T>((resolve, reject) => {
				queue.push({
					task: task as () => Promise<any>,
					resolve,
					reject
				})

				processNext()
			})
		},
		getStats() {
			return {
				activeCount,
				queueSize: queue.length,
				maxConcurrent,
				maxQueueSize
			}
		}
	}
}

export type MessageRelayMutex = ReturnType<typeof makeMessageRelayMutex>
