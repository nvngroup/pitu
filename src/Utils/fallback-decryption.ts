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
			logger.debug(error, 'Falha na descriptografia GCM com tag, tentando sem verificação')
			return decipher.update(enc)
		}
	} catch(error) {
		logger.debug('Falha na primeira tentativa de descriptografia: ' + error.message)
	}

	try {
		const decipher = createDecipheriv('aes-256-cbc', cipherKeyBuf, ivBuf)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()])
	} catch(error) {
		logger.debug('Falha na segunda tentativa de descriptografia: ' + error.message)
	}

	try {
		const decipher = createDecipheriv('aes-256-ctr', cipherKeyBuf, ivBuf)
		return Buffer.concat([decipher.update(ciphertext)])
	} catch(error) {
		logger.debug('Falha na terceira tentativa de descriptografia: ' + error.message)
	}

	logger.error('Todas as tentativas de descriptografia falharam')
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
						logger.error({ error }, 'Erro ao criar decifragem')
						callback(null)
						return
					}
				}

				try {
					this.push(aes.update(data))
					callback()
				} catch(error) {
					logger.error({ error }, 'Erro na descriptografia (update)')
					callback(null)
				}
			} catch(error) {
				logger.error({ error }, 'Erro geral de descriptografia')
				callback(null)
			}
		},

		final(callback) {
			try {
				if(aes) {
					try {
						this.push(aes.final())
					} catch(error) {
						logger.error({ error }, 'Erro no final da descriptografia')
					}
				}

				callback()
			} catch(error) {
				logger.error({ error }, 'Erro final')
				callback()
			}
		}
	})
}
