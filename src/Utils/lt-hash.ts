import { hkdf } from './crypto'

/**
 * LT Hash is a summation based hash algorithm that maintains the integrity of a piece of data
 * over a series of mutations. You can add/remove mutations and it'll return a hash equal to
 * if the same series of mutations was made sequentially.
 */

const HASH_SIZE = 128

class LTHash {

	salt: string

	constructor(salt: string) {
		this.salt = salt
	}

	add(hash: ArrayBuffer | Promise<ArrayBuffer>, items: string[] | ArrayBuffer[]) {
		let result = hash
		for(const item of items) {
			result = this._addSingle(result, item)
		}

		return result
	}

	subtract(hash: ArrayBuffer | Promise<ArrayBuffer>, items: string[] | ArrayBuffer[]) {
		let result = hash
		for(const item of items) {
			result = this._subtractSingle(result, item)
		}

		return result
	}

	subtractThenAdd(hash: ArrayBuffer | Promise<ArrayBuffer>, addItems: string[] | ArrayBuffer[], subtractItems: string[] | ArrayBuffer[]) {
		return this.add(this.subtract(hash, subtractItems), addItems)
	}

	async _addSingle(hash: ArrayBuffer | Promise<ArrayBuffer>, item: string | ArrayBuffer) {
		const itemBuffer = typeof item === 'string' ? Buffer.from(item) : Buffer.from(item)
		const itemHash: ArrayBuffer = new Uint8Array(await hkdf(itemBuffer, HASH_SIZE, { info: this.salt })).buffer
		return this.performPointwiseWithOverflow(await hash, itemHash, ((a, b) => a + b))
	}

	async _subtractSingle(hash: ArrayBuffer | Promise<ArrayBuffer>, item: string | ArrayBuffer) {
		const itemBuffer = typeof item === 'string' ? Buffer.from(item) : Buffer.from(item)
		const itemHash: ArrayBuffer = new Uint8Array(await hkdf(itemBuffer, HASH_SIZE, { info: this.salt })).buffer
		return this.performPointwiseWithOverflow(await hash, itemHash, ((a, b) => a - b))
	}

	performPointwiseWithOverflow(
		buffer1: ArrayBuffer,
		buffer2: ArrayBuffer,
		operation: (a: number, b: number) => number
	) {
		const view1 = new DataView(buffer1)
		const view2 = new DataView(buffer2)
		const resultBuffer = new ArrayBuffer(view1.byteLength)
		const resultView = new DataView(resultBuffer)

		for(let index = 0; index < view1.byteLength; index += 2) {
			resultView.setUint16(
				index,
				operation(view1.getUint16(index, true), view2.getUint16(index, true)),
				true
			)
		}

		return resultBuffer
	}
}

export const LT_HASH_ANTI_TAMPERING = new LTHash('WhatsApp Patch Integrity')
