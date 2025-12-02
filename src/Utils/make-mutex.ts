export const makeMutex = () => {
	let task: Promise<unknown> = Promise.resolve()

	let taskTimeout: NodeJS.Timeout | undefined

	return {
		mutex<T>(code: () => Promise<T> | T): Promise<T> {
			const newTask = (async() => {
				try {
					await task
				} catch { }

				try {
					const result = await code()
					return result
				} finally {
					clearTimeout(taskTimeout)
				}
			})()
			task = newTask
			return newTask
		},
	}
}

export type Mutex = ReturnType<typeof makeMutex>

export const makeKeyedMutex = () => {
	const map: { [id: string]: Mutex } = {}

	return {
		mutex<T>(key: string, task: () => Promise<T> | T): Promise<T> {
			if (!map[key]) {
				map[key] = makeMutex()
			}

			return map[key].mutex(task)
		}
	}
}
