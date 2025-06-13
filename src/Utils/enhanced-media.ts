import { AxiosRequestConfig } from 'axios'
import { MediaDecryptionKeyInfo } from '../Types'
import { createFallbackDecryptStream } from '../Utils/fallback-decryption'
import { downloadEncryptedContent as originalDownloadEncryptedContent } from '../Utils/messages-media'

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
		console.error('Erro na descriptografia original, tentando método alternativo', error)

		// Baixa o conteúdo criptografado e aplica o stream de descriptografia alternativo
		const { fetch } = await import('undici')
		const response = await fetch(downloadUrl)

		if(!response.ok) {
			throw new Error(`Falha ao baixar o conteúdo: ${response.status}`)
		}

		const { cipherKey, iv } = keys

		// Cria um stream de descriptografia alternativo
		const stream = response.body
		const startByte = options.startByte || 0
		const firstBlockIsIV = startByte > 0 // Se tiver start byte, provavelmente o primeiro bloco é o IV

		// Retorna o stream com o método alternativo
		return stream?.pipeThrough(
			new TransformStream({
				transform(chunk, controller) {
					controller.enqueue(chunk)
				}
			})
		).pipeThrough(
			new TransformStream({
				transformer: createFallbackDecryptStream(cipherKey, iv, firstBlockIsIV)
			})
		)
	}
}
