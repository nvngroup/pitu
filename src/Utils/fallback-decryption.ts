import { createDecipheriv } from 'crypto'
import { Transform } from 'stream'
import logger from './logger'

/**
 * Função alternativa para descriptografia quando a padrão falhar
 * Esta função tenta vários métodos de descriptografia para mitigar o erro de 'bad decrypt'
 */
export const tryAlternativeDecryption = (
	ciphertext: Buffer,
	cipherKey: Buffer | Uint8Array,
	iv: Buffer | Uint8Array,
	additionalData?: Buffer
) => {
	const cipherKeyBuf = Buffer.isBuffer(cipherKey) ? cipherKey : Buffer.from(cipherKey)
	const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv)

	try {
		const decipher = createDecipheriv('aes-256-gcm', cipherKeyBuf, ivBuf)
		if(additionalData) {
			decipher.setAAD(additionalData)
		}

		const enc = ciphertext.slice(0, ciphertext.length - 16)
		const tag = ciphertext.slice(ciphertext.length - 16)

		try {
			decipher.setAuthTag(tag)
			return Buffer.concat([decipher.update(enc), decipher.final()])
		} catch(error) {
			logger.error(error, 'GCM decryption failed with tag, trying without verification')
			return decipher.update(enc)
		}
	} catch(error) {
		logger.error('First decryption attempt failed: ' + error.message)
	}

	try {
		const decipher = createDecipheriv('aes-256-cbc', cipherKeyBuf, ivBuf)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()])
	} catch(error) {
		logger.error('Second decryption attempt failed: ' + error.message)
	}

	try {
		const decipher = createDecipheriv('aes-256-ctr', cipherKeyBuf, ivBuf)
		return Buffer.concat([decipher.update(ciphertext)])
	} catch(error) {
		logger.error('Third decryption attempt failed: ' + error.message)
	}

	logger.error('All decryption attempts failed')
	return Buffer.from([])
}

/**
 * Cria um transformador de stream que tentará várias formas de descriptografia
 * para mitigar erros de 'bad decrypt'
 */
export const createFallbackDecryptStream = (
	cipherKey: Buffer | Uint8Array,
	iv: Buffer | Uint8Array,
	firstBlockIsIV = false
) => {
	const cipherKeyBuf = Buffer.isBuffer(cipherKey) ? cipherKey : Buffer.from(cipherKey)
	const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv)

	let remainingBytes = Buffer.from([])
	let aes: ReturnType<typeof createDecipheriv> | null = null

	return new Transform({
		transform(chunk, _, callback) {
			try {
				let data = Buffer.concat([remainingBytes, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])

				const AES_CHUNK_SIZE = 16
				const decryptLength = Math.floor(data.length / AES_CHUNK_SIZE) * AES_CHUNK_SIZE
				remainingBytes = data.slice(decryptLength)
				data = data.slice(0, decryptLength)

				if(!aes) {
					let ivValue = ivBuf
					if(firstBlockIsIV) {
						ivValue = data.slice(0, AES_CHUNK_SIZE)
						data = data.slice(AES_CHUNK_SIZE)
					}

					try {
						aes = createDecipheriv('aes-256-cbc', cipherKeyBuf, ivValue)
					} catch(error) {
						logger.error({ error }, 'Error creating CBC decryption')
						callback(null)
						return
					}
				}

				try {
					this.push(aes.update(data))
					callback()
				} catch(error) {
					logger.error({ error }, 'Error in decryption (update)')
					callback(null)
				}
			} catch(error) {
				logger.error({ error }, 'General decryption error')
				callback(null)
			}
		},

		final(callback) {
			try {
				if(aes) {
					try {
						this.push(aes.final())
					} catch(error) {
						logger.error({ error }, 'Error in final decryption')
					}
				}

				callback()
			} catch(error) {
				logger.error({ error }, 'Error in final decryption')
				callback()
			}
		}
	})
}
