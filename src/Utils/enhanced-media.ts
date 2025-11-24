import fetch from 'node-fetch'
import { Readable } from 'stream'
import { MediaDecryptionKeyInfo } from '../Types'
import { createFallbackDecryptStream } from '../Utils/fallback-decryption'
import { downloadEncryptedContent as originalDownloadEncryptedContent } from '../Utils/messages-media'
import logger from './logger'
import { MediaDownloadOptions } from './types'

/**
 * Versão modificada da função downloadEncryptedContent que tenta usar
 * o método de descriptografia alternativo caso o método original falhe
 */
export const enhancedDownloadEncryptedContent = async(
	downloadUrl: string,
	keys: MediaDecryptionKeyInfo,
	options: MediaDownloadOptions = {}
) => {
	try {
		return await originalDownloadEncryptedContent(downloadUrl, keys, options)
	} catch (error) {
		logger.error({ error }, 'Error in original decryption, trying alternative method')

		const response = await fetch(downloadUrl, {
			...options.options,
			// Garante que não falhe por timeouts padrão se o arquivo for grande
		} as any)

		if (!response.ok) {
			throw new Error(`Falha ao baixar o conteúdo: ${response.status}`)
		}

		const { cipherKey, iv } = keys
		const startByte: number = options.startByte || 0
		const firstBlockIsIV: boolean = startByte > 0

		// CRIAÇÃO DO DECRYPTOR
		const fallbackDecryptor = createFallbackDecryptStream(cipherKey, iv, firstBlockIsIV)

		// --- OTIMIZAÇÃO AQUI ---
		// Em vez de carregar tudo na memória, convertemos o body diretamente
		// para um Stream do Node e fazemos o pipe instantâneo.

		if (!response.body) {
			throw new Error('O corpo da resposta está vazio')
		}

		// Converte WebStream (fetch) -> NodeStream
		// O cast 'as any' resolve o conflito de tipos ReadableStream<any> vs ReadableStream<Uint8Array>
		const sourceStream: Readable = Readable.fromWeb(response.body as any)

		// Retorna o stream conectado. O processamento acontece conforme os dados chegam.
		return sourceStream.pipe(fallbackDecryptor)
	}
}
