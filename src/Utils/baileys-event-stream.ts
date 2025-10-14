import EventEmitter from 'events'
import { createReadStream, ReadStream } from 'fs'
import { writeFile } from 'fs/promises'
import { createInterface, Interface } from 'readline'
import type { BaileysEventEmitter } from '../Types'
import { delay } from './generics'
import { makeMutex } from './make-mutex'

/**
 * Captures events from a baileys event emitter & stores them in a file
 * @param ev The event emitter to read events from
 * @param filename File to save to
 */
export const captureEventStream = (ev: BaileysEventEmitter, filename: string) => {
	const oldEmit = ev.emit
	const writeMutex = makeMutex()
	ev.emit = function(...args: any[]) {
		const content: string = JSON.stringify({ timestamp: Date.now(), event: args[0], data: args[1] }) + '\n'
		const result = oldEmit.apply(ev, args)

		writeMutex.mutex(
			async() => {
				await writeFile(filename, content, { flag: 'a' })
			}
		)

		return result
	}
}

/**
 * Read event file and emit events from there
 * @param filename filename containing event data
 * @param delayIntervalMs delay between each event emit
 */
export const readAndEmitEventStream = (filename: string, delayIntervalMs = 0) => {
	const ev = new EventEmitter() as BaileysEventEmitter

	const fireEvents = async() => {
		// from: https://stackoverflow.com/questions/6156501/read-a-file-one-line-at-a-time-in-node-js
		const fileStream: ReadStream = createReadStream(filename)

		const rl: Interface = createInterface({
			input: fileStream,
			crlfDelay: Infinity
		})
		for await (const line of rl) {
			if(line) {
				const { event, data } = JSON.parse(line)
				ev.emit(event, data)
				delayIntervalMs && await delay(delayIntervalMs)
			}
		}

		fileStream.close()
	}

	return {
		ev,
		task: fireEvents()
	}
}
