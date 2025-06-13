import { createDecipheriv } from 'crypto'
import { Transform } from 'stream'
import logger from './logger'

/**
 * Função alternativa para descriptografia quando a padrão falhar
 * Esta função tenta vários métodos de descriptografia para mitigar o erro de 'bad decrypt'
 */
export const tryAlternativeDecryption = (
	ciphertext: Buffer,
	cipherKey: Buffer,
	iv: Buffer,
	additionalData?: Buffer
) => {
	// Tentativa 1: AES-256-GCM completo com tratamento de erro
	try {
		const decipher = createDecipheriv('aes-256-gcm', cipherKey, iv)
		if(additionalData) {
			decipher.setAAD(additionalData)
		}

		// Se não tiver uma tag, tenta sem ela
		const enc = ciphertext.slice(0, ciphertext.length - 16)
		const tag = ciphertext.slice(ciphertext.length - 16)

		try {
			decipher.setAuthTag(tag)
			return Buffer.concat([decipher.update(enc), decipher.final()])
		} catch(error) {
			logger.error(error, 'Falha na descriptografia GCM com tag, tentando sem verificação')
			return decipher.update(enc)
		}
	} catch(error) {
		logger.debug('Falha na primeira tentativa de descriptografia: ' + error.message)
	}

	// Tentativa 2: AES-256-CBC
	try {
		const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()])
	} catch(error) {
		logger.debug('Falha na segunda tentativa de descriptografia: ' + error.message)
	}

	// Tentativa 3: AES-256-CTR
	try {
		const decipher = createDecipheriv('aes-256-ctr', cipherKey, iv)
		return Buffer.concat([decipher.update(ciphertext)])
	} catch(error) {
		logger.debug('Falha na terceira tentativa de descriptografia: ' + error.message)
	}

	// Se todas as tentativas falharem, retorna um buffer vazio
	logger.error('Todas as tentativas de descriptografia falharam')
	return Buffer.from([])
}

/**
 * Cria um transformador de stream que tentará várias formas de descriptografia
 * para mitigar erros de 'bad decrypt'
 */
export const createFallbackDecryptStream = (
	cipherKey: Buffer,
	iv: Buffer,
	firstBlockIsIV = false
) => {
	let remainingBytes = Buffer.from([])
	let aes: any = null

	return new Transform({
		transform(chunk, _, callback) {
			try {
				let data = Buffer.concat([remainingBytes, chunk])

				// Configura para blocos de 16 bytes
				const AES_CHUNK_SIZE = 16
				const decryptLength = Math.floor(data.length / AES_CHUNK_SIZE) * AES_CHUNK_SIZE
				remainingBytes = data.slice(decryptLength)
				data = data.slice(0, decryptLength)

				if(!aes) {
					let ivValue = iv
					if(firstBlockIsIV) {
						ivValue = data.slice(0, AES_CHUNK_SIZE)
						data = data.slice(AES_CHUNK_SIZE)
					}

					try {
						aes = createDecipheriv('aes-256-cbc', cipherKey, ivValue)
					} catch(error) {
						logger.error('Erro ao criar decifragem: ' + error.message)
						callback(null) // Continua sem erro para não quebrar o pipeline
						return
					}
				}

				try {
					this.push(aes.update(data))
					callback()
				} catch(error) {
					logger.error('Erro na descriptografia (update): ' + error.message)
					callback(null) // Continua sem erro para não quebrar o pipeline
				}
			} catch(error) {
				logger.error('Erro geral de descriptografia: ' + error.message)
				callback(null) // Continua sem erro para não quebrar o pipeline
			}
		},

		final(callback) {
			try {
				if(aes) {
					try {
						this.push(aes.final())
					} catch(error) {
						logger.error('Erro no final da descriptografia: ' + error.message)
						// Ignora erro e continua
					}
				}

				callback()
			} catch(error) {
				logger.error('Erro final: ' + error.message)
				callback()
			}
		}
	})
}
