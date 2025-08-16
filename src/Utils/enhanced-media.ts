import axios, { AxiosRequestConfig } from 'axios'
import { MediaDecryptionKeyInfo } from '../Types'
import { createFallbackDecryptStream } from '../Utils/fallback-decryption'
import { downloadEncryptedContent as originalDownloadEncryptedContent } from '../Utils/messages-media'
import logger from './logger'

export type MediaDownloadOptions = {
  startByte?: number
  endByte?: number
  options?: AxiosRequestConfig<{}>
}

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
		// Primeiro tenta usar o método original
		return await originalDownloadEncryptedContent(downloadUrl, keys, options)
	} catch(error) {
		// Se der erro, registra e tenta o método alternativo
		logger.error('Error in original decryption, trying alternative method', error)

		const response = await axios.get(downloadUrl, {
			responseType: 'arraybuffer',
			...options.options
		})

		if(response.status !== 200) {
			throw new Error(`Falha ao baixar o conteúdo: ${response.status}`)
		}

		const { cipherKey, iv } = keys

		const { Readable } = await import('stream')
		const buffer = Buffer.from(response.data)
		const nodeReadable = new Readable()

		nodeReadable._read = function() { }

		nodeReadable.push(buffer)
		nodeReadable.push(null)

		const startByte = options.startByte || 0
		const firstBlockIsIV = startByte > 0

		const fallbackDecryptor = createFallbackDecryptStream(cipherKey, iv, firstBlockIsIV)
		return nodeReadable.pipe(fallbackDecryptor)
	}
}
