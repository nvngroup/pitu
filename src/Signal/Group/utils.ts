/**
 * Utility functions for type conversion and validation
 */

export function ensureBuffer(value: string | Uint8Array | Buffer | Record<string, number> | null | undefined): Buffer {
	if(Buffer.isBuffer(value)) {
		return value
	}

	if(value instanceof Uint8Array) {
		return Buffer.from(value)
	}

	if(typeof value === 'string') {
		return Buffer.from(value, 'base64')
	}

	if(value && typeof value === 'object') {
		return Buffer.from(Object.values(value))
	}

	return Buffer.alloc(0)
}

export function validateIteration(iteration: number): void {
	if(!Number.isInteger(iteration) || iteration < 0) {
		throw new Error(`Invalid iteration: ${iteration}. Must be a non-negative integer.`)
	}
}

export function validateKeyId(keyId: number): void {
	if(!Number.isInteger(keyId) || keyId < 0) {
		throw new Error(`Invalid key ID: ${keyId}. Must be a non-negative integer.`)
	}
}
