import { Boom } from '@hapi/boom'
import { exec } from 'child_process'
import * as Crypto from 'crypto'
import { once } from 'events'
import { createReadStream, createWriteStream, promises as fs, ReadStream, WriteStream } from 'fs'
import { ResizeStrategy } from 'jimp'
import type { IAudioMetadata } from 'music-metadata'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { URL } from 'url'
import { waproto } from '../../WAProto'
import { DEFAULT_ORIGIN, MEDIA_HKDF_KEY_MAPPING, MEDIA_PATH_MAP } from '../Defaults'
import { BaileysEventMap, DownloadableMessage, MediaConnInfo, MediaDecryptionKeyInfo, MediaType, MessageType, SocketConfig, WAGenericMediaMessage, WAMediaUpload, WAMediaUploadFunction, WAMessageContent } from '../Types'
import { BinaryNode, getBinaryNodeChild, getBinaryNodeChildBuffer, jidNormalizedUser } from '../WABinary'
import { aesDecryptGCM, aesEncryptGCM, hkdf } from './crypto'
import { generateMessageIDV2 } from './generics'
import logger, { ILogger } from './logger'

const getTmpFilesDirectory = () => tmpdir()

const getImageProcessingLibrary = async() => {
	const [jimp, sharp] = await Promise.all([import('jimp').catch(() => { }), import('sharp').catch(() => { })])

	if (sharp) {
		return { sharp }
	}

	if (jimp) {
		return { jimp }
	}

	throw new Boom('No image processing library available')
}

export const hkdfInfoKey = (type: MediaType) => {
	const hkdfInfo: string = MEDIA_HKDF_KEY_MAPPING[type]
	return `WhatsApp ${hkdfInfo} Keys`
}

export const getRawMediaUploadData = async(media: WAMediaUpload, mediaType: MediaType, logger?: ILogger) => {
	const { stream } = await getStream(media)
	logger?.debug({}, 'got stream for raw upload')

	const hasher: Crypto.Hash = Crypto.createHash('sha256')
	const filePath: string = join(tmpdir(), mediaType + generateMessageIDV2())
	const fileWriteStream: WriteStream = createWriteStream(filePath)

	let fileLength = 0
	try {
		for await (const data of stream) {
			fileLength += data.length
			hasher.update(data)
			if (!fileWriteStream.write(data)) {
				await once(fileWriteStream, 'drain')
			}
		}

		fileWriteStream.end()
		await once(fileWriteStream, 'finish')
		stream.destroy()
		const fileSha256: Buffer = hasher.digest()
		logger?.debug({}, 'hashed data for raw upload')
		return {
			filePath: filePath,
			fileSha256,
			fileLength
		}
	} catch (error) {
		fileWriteStream.destroy()
		stream.destroy()
		try {
			await fs.unlink(filePath)
		} catch (error) {
			logger?.trace(error)
		}

		throw error
	}
}

/** generates all the keys required to encrypt/decrypt & sign a media message */
export async function getMediaKeys(buffer: Uint8Array | string | null | undefined, mediaType: MediaType): Promise<MediaDecryptionKeyInfo> {
	if (!buffer) {
		throw new Boom('Cannot derive from empty media key')
	}

	if (typeof buffer === 'string') {
		buffer = Buffer.from(buffer.replace('data:;base64,', ''), 'base64')
	}

	const expandedMediaKey: Buffer = await hkdf(buffer, 112, { info: hkdfInfoKey(mediaType) })
	return {
		iv: expandedMediaKey.subarray(0, 16),
		cipherKey: expandedMediaKey.subarray(16, 48),
		macKey: expandedMediaKey.subarray(48, 80),
	}
}

/** Extracts video thumb using FFMPEG */
const extractVideoThumb = async(
	path: string,
	destPath: string,
	time: string,
	size: { width: number, height: number },
) => new Promise<void>((resolve, reject) => {
	const cmd = `ffmpeg -ss ${time} -i ${path} -y -vf scale=${size.width}:-1 -vframes 1 -f image2 ${destPath}`
	exec(cmd, (err) => {
		if (err) {
			reject(err)
		} else {
			resolve()
		}
	})
})

export const extractImageThumb = async(bufferOrFilePath: Readable | Buffer | string, width = 32) => {
	if (bufferOrFilePath instanceof Readable) {
		bufferOrFilePath = await toBuffer(bufferOrFilePath)
	}

	const lib = await getImageProcessingLibrary()
	if ('sharp' in lib && typeof lib.sharp?.default === 'function') {
		const img = lib.sharp.default(bufferOrFilePath)
		const dimensions = await img.metadata()

		const buffer: Buffer = await img
			.resize(width)
			.jpeg({ quality: 50 })
			.toBuffer()
		return {
			buffer,
			original: {
				width: dimensions.width,
				height: dimensions.height,
			},
		}
	} else if ('jimp' in lib && typeof lib.jimp?.Jimp === 'function') {
		const jimp = await lib.jimp.default.Jimp.read(bufferOrFilePath)

		const dimensions = {
			width: jimp.width,
			height: jimp.height
		}
		const buffer: Buffer = await jimp
			.resize({ w: width, mode: ResizeStrategy.BILINEAR })
			.getBuffer('image/jpeg', { quality: 50 })
		return {
			buffer,
			original: dimensions
		}
	} else {
		throw new Boom('No image processing library available')
	}
}

export const encodeBase64EncodedStringForUpload = (b64: string) => (
	encodeURIComponent(
		b64
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/\=+$/, '')
	)
)

export const generateProfilePicture = async(mediaUpload: WAMediaUpload, dimensions?: { w: number; h: number }) => {

	const { w = 640, h = 640 } = dimensions || {}
	let bufferOrFilePath: Buffer | string
	if (Buffer.isBuffer(mediaUpload)) {
		bufferOrFilePath = mediaUpload
	} else if ('url' in mediaUpload) {
		bufferOrFilePath = mediaUpload.url.toString()
	} else {
		bufferOrFilePath = await toBuffer(mediaUpload.stream)
	}

	const lib = await getImageProcessingLibrary()
	let img: Promise<Buffer>
	if ('sharp' in lib && typeof lib.sharp?.default === 'function') {
		img = lib.sharp.default(bufferOrFilePath)
			.resize(w, h)
			.jpeg({
				quality: 50,
			})
			.toBuffer()
	} else if ('jimp' in lib && typeof lib.jimp?.Jimp === 'object') {
		const jimp = await lib.jimp.default.Jimp.read(bufferOrFilePath)
		const min: number = Math.min(jimp.width, jimp.height)
		const cropped = jimp.crop({ x: 0, y: 0, w: min, h: min })


		img = cropped.resize({ w, h, mode: ResizeStrategy.BILINEAR }).getBuffer('image/jpeg', { quality: 50 })
	} else {
		throw new Boom('No image processing library available')
	}

	return {
		img: await img,
	}
}

/** gets the SHA256 of the given media message */
export const mediaMessageSHA256B64 = (message: WAMessageContent) => {
	const media = Object.values(message)[0] as WAGenericMediaMessage
	return media?.fileSha256 && Buffer.from(media.fileSha256).toString('base64')
}

export async function getAudioDuration(buffer: Buffer | string | Readable) {
	const musicMetadata = await import('music-metadata')
	let metadata: IAudioMetadata
	const options = { duration: true }
	if (Buffer.isBuffer(buffer)) {
		metadata = await musicMetadata.parseBuffer(buffer, undefined, options)
	} else if (typeof buffer === 'string') {
		metadata = await musicMetadata.parseFile(buffer, options)
	} else {
		metadata = await musicMetadata.parseStream(buffer, undefined, options)
	}

	return metadata.format.duration
}

/**
	referenced from and modifying https://github.com/wppconnect-team/wa-js/blob/main/src/chat/functions/prepareAudioWaveform.ts
 */
export async function getAudioWaveform(buffer: Buffer | string | Readable, logger?: ILogger) {
	try {
		const { default: decoder } = await eval('import(\'audio-decode\')')
		let audioData: Buffer
		if (Buffer.isBuffer(buffer)) {
			audioData = buffer
		} else if (typeof buffer === 'string') {
			const rStream: ReadStream = createReadStream(buffer)
			audioData = await toBuffer(rStream)
		} else {
			audioData = await toBuffer(buffer)
		}

		const audioBuffer = await decoder(audioData)

		const rawData = audioBuffer.getChannelData(0)
		const samples = 64
		const blockSize: number = Math.floor(rawData.length / samples)
		const filteredData: number[] = []
		for (let i = 0; i < samples; i++) {
			const blockStart: number = blockSize * i
			let sum = 0
			for (let j = 0; j < blockSize; j++) {
				sum = sum + Math.abs(rawData[blockStart + j])
			}

			filteredData.push(sum / blockSize)
		}

		const multiplier: number = Math.pow(Math.max(...filteredData), -1)
		const normalizedData: number[] = filteredData.map((n) => n * multiplier)
		const waveform = new Uint8Array(
			normalizedData.map((n) => Math.floor(100 * n))
		)

		return waveform
	} catch (e) {
		logger?.error({ e }, 'Failed to generate waveform:')
	}
}

export const toReadable = (buffer: Buffer) => {
	const readable = new Readable({ read: () => { } })
	readable.push(buffer)
	readable.push(null)
	return readable
}

export const toBuffer = async(stream: Readable) => {
	const chunks: Buffer[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}

	stream.destroy()
	return Buffer.concat(chunks)
}

export const getStream = async(item: WAMediaUpload, opts?: RequestInit & { maxContentLength?: number }) => {
	if (Buffer.isBuffer(item)) {
		return { stream: toReadable(item), type: 'buffer' } as const
	}

	if ('stream' in item) {
		return { stream: item.stream, type: 'readable' } as const
	}

	const urlStr: string = item.url.toString()

	if (urlStr.startsWith('data:')) {
		const buffer: Buffer = Buffer.from(urlStr.split(',')[1], 'base64')
		return { stream: toReadable(buffer), type: 'buffer' } as const
	}

	if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
		return { stream: await getHttpStream(item.url, opts), type: 'remote' } as const
	}

	return { stream: createReadStream(item.url), type: 'file' } as const
}

/** generates a thumbnail for a given media, if required */
export async function generateThumbnail(
	file: string,
	mediaType: 'video' | 'image',
	options: {
		logger?: ILogger
	}
) {
	let thumbnail: string | undefined
	let originalImageDimensions: { width: number, height: number } | undefined
	if (mediaType === 'image') {
		const { buffer, original } = await extractImageThumb(file)
		thumbnail = buffer.toString('base64')
		if (original.width && original.height) {
			originalImageDimensions = {
				width: original.width,
				height: original.height,
			}
		}
	} else if (mediaType === 'video') {
		const imgFilename: string = join(getTmpFilesDirectory(), generateMessageIDV2() + '.jpg')
		try {
			await extractVideoThumb(file, imgFilename, '00:00:00', { width: 32, height: 32 })
			const buff: Buffer = await fs.readFile(imgFilename)
			thumbnail = buff.toString('base64')

			await fs.unlink(imgFilename)
		} catch (err) {
			options.logger?.error({ err }, 'could not generate video thumb:')
		}
	}

	return {
		thumbnail,
		originalImageDimensions
	}
}

export const getHttpStream = async(url: string | URL, options: RequestInit & { isStream?: true } = {}) => {
	const response = await fetch(url.toString(), {
		// dispatcher: options.dispatcher,
		method: 'GET',
		headers: options.headers as HeadersInit
	})
	if (!response.ok) {
		throw new Boom(`Failed to fetch stream from ${url}`, { statusCode: response.status, data: { url } })
	}

	return response.body instanceof Readable ? response.body : Readable.fromWeb(response.body as any)
}

type EncryptedStreamOptions = {
	saveOriginalFileIfRequired?: boolean
	logger?: ILogger
	opts?: RequestInit
}

export const encryptedStream = async(
	media: WAMediaUpload,
	mediaType: MediaType,
	{ logger, saveOriginalFileIfRequired, opts }: EncryptedStreamOptions = {}
) => {
	const { stream, type } = await getStream(media, opts)

	logger?.debug({}, 'fetched media stream')

	const mediaKey: Buffer = Crypto.randomBytes(32)
	const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, mediaType)
	const encFilePath = join(
		getTmpFilesDirectory(),
		mediaType + generateMessageIDV2() + '-enc'
	)
	const encFileWriteStream: WriteStream = createWriteStream(encFilePath)

	let originalFileStream: WriteStream | undefined
	let originalFilePath: string | undefined

	if (saveOriginalFileIfRequired) {
		originalFilePath = join(
			getTmpFilesDirectory(),
			mediaType + generateMessageIDV2() + '-original'
		)
		originalFileStream = createWriteStream(originalFilePath)
	}

	let fileLength = 0
	const aes: Crypto.Cipheriv = Crypto.createCipheriv('aes-256-cbc', cipherKey, iv)
	const hmac: Crypto.Hmac = Crypto.createHmac('sha256', macKey!).update(iv)
	const sha256Plain: Crypto.Hash = Crypto.createHash('sha256')
	const sha256Enc: Crypto.Hash = Crypto.createHash('sha256')

	const onChunk = (buff: Buffer) => {
		sha256Enc.update(buff)
		hmac.update(buff)
		encFileWriteStream.write(buff)
	}

	try {
		for await (const data of stream) {
			fileLength += data.length

			if (
				type === 'remote' &&
				(opts as any)?.maxContentLength &&
				fileLength + data.length > (opts as any).maxContentLength
			) {
				throw new Boom(
					`content length exceeded when encrypting "${type}"`,
					{
						data: { media, type }
					}
				)
			}

			if (originalFileStream) {
				if (!originalFileStream.write(data)) {
					await once(originalFileStream, 'drain')
				}
			}

			sha256Plain.update(data)
			onChunk(aes.update(data))
		}

		onChunk(aes.final())

		const mac: Buffer = hmac.digest().subarray(0, 10)
		sha256Enc.update(mac)

		const fileSha256: Buffer = sha256Plain.digest()
		const fileEncSha256: Buffer = sha256Enc.digest()

		encFileWriteStream.write(mac)

		encFileWriteStream.end()
		originalFileStream?.end?.()
		stream.destroy()

		logger?.debug({}, 'encrypted data successfully')

		return {
			mediaKey,
			originalFilePath,
			encFilePath,
			mac,
			fileEncSha256,
			fileSha256,
			fileLength
		}
	} catch (error) {
		encFileWriteStream.destroy()
		originalFileStream?.destroy?.()
		aes.destroy()
		hmac.destroy()
		sha256Plain.destroy()
		sha256Enc.destroy()
		stream.destroy()

		try {
			await fs.unlink(encFilePath)
			if (originalFilePath) {
				await fs.unlink(originalFilePath)
			}
		} catch (err) {
			logger?.error({ err }, 'failed deleting tmp files')
		}

		throw error
	}
}

const DEF_HOST = 'mmg.whatsapp.net'
const AES_CHUNK_SIZE = 16

const toSmallestChunkSize = (num: number) => {
	return Math.floor(num / AES_CHUNK_SIZE) * AES_CHUNK_SIZE
}

export type MediaDownloadOptions = {
	startByte?: number
	endByte?: number
	options?: RequestInit
}

export const getUrlFromDirectPath = (directPath: string) => `https://${DEF_HOST}${directPath}`

export const downloadContentFromMessage = async(
	{ mediaKey, directPath, url }: DownloadableMessage,
	type: MediaType,
	opts: MediaDownloadOptions = {}
) => {
	const isValidMediaUrl: boolean | undefined = url?.startsWith('https://mmg.whatsapp.net/')
	const downloadUrl: string | null | undefined = isValidMediaUrl ? url : getUrlFromDirectPath(directPath!)
	if (!downloadUrl) {
		throw new Boom('No valid media URL or directPath present in message', { statusCode: 400 })
	}

	if (!mediaKey) {
		throw new Boom('Media key is required for decryption', { statusCode: 400 })
	}

	const keys: MediaDecryptionKeyInfo = await getMediaKeys(mediaKey, type)

	return downloadEncryptedContent(downloadUrl, keys, opts)
}

/**
 * Decrypts and downloads an AES256-CBC encrypted file given the keys.
 * Assumes the SHA256 of the plaintext is appended to the end of the ciphertext
 * */
export const downloadEncryptedContent = async(
	downloadUrl: string,
	{ cipherKey, iv, macKey }: MediaDecryptionKeyInfo,
	{ startByte, endByte, options }: MediaDownloadOptions = {}
) => {
	let bytesFetched = 0
	let startChunk = 0
	let firstBlockIsIV = false
	if (startByte) {
		const chunk: number = toSmallestChunkSize(startByte || 0)
		if (chunk) {
			startChunk = chunk - AES_CHUNK_SIZE
			bytesFetched = chunk

			firstBlockIsIV = true
		}
	}

	const endChunk: number | undefined = endByte ? toSmallestChunkSize(endByte || 0) + AES_CHUNK_SIZE : undefined

	const headersInit = options?.headers ? options.headers : undefined
	const headers: Record<string, string> = {
		...(headersInit
			? Array.isArray(headersInit)
				? Object.fromEntries(headersInit)
				: (headersInit as Record<string, string>)
			: {}),
		Origin: DEFAULT_ORIGIN
	}
	if (startChunk || endChunk) {
		headers.Range = `bytes=${startChunk}-`
		if (endChunk) {
			headers.Range += endChunk
		}
	}

	let fetched: Readable
	try {
		fetched = await getHttpStream(
			downloadUrl,
			{
				...options || {},
				headers,
			}
		)
	} catch (error) {
		logger.error({ error, downloadUrl }, 'Falha ao obter stream HTTP para download de mídia')
		throw new Boom('Falha ao baixar mídia', { statusCode: 500, data: error })
	}

	let remainingBytes: Buffer = Buffer.from([])

	let aes: Crypto.Decipheriv
	let hmac: Crypto.Hmac | undefined
	const encryptedChunks: Buffer[] = []
	let totalBytesReceived = 0

	if (macKey && !endByte) {
		hmac = Crypto.createHmac('sha256', macKey).update(iv)
	}

	const pushBytes = (bytes: Buffer, push: (bytes: Buffer) => void) => {
		if (startByte || endByte) {
			const start: number | undefined = bytesFetched >= startByte! ? undefined : Math.max(startByte! - bytesFetched, 0)
			const end: number | undefined = bytesFetched + bytes.length < endByte! ? undefined : Math.max(endByte! - bytesFetched, 0)

			push(bytes.subarray(start, end))

			bytesFetched += bytes.length
		} else {
			push(bytes)
		}
	}

	const output = new Transform({
		transform(chunk, _, callback) {
			try {
				let data: Buffer = Buffer.concat([remainingBytes, chunk])

				if (hmac && !startByte && !endByte) {
					encryptedChunks.push(Buffer.from(chunk))
				}

				totalBytesReceived += chunk.length

				const decryptLength: number = toSmallestChunkSize(data.length)
				remainingBytes = data.subarray(decryptLength)
				data = data.subarray(0, decryptLength)

				if (!aes) {
					let ivValue: Buffer = iv
					if (firstBlockIsIV) {
						ivValue = data.subarray(0, AES_CHUNK_SIZE)
						data = data.subarray(AES_CHUNK_SIZE)
					}

					try {
						aes = Crypto.createDecipheriv('aes-256-cbc', cipherKey, ivValue)
						if (endByte) {
							aes.setAutoPadding(false)
						}
					} catch (error) {
						callback(new Error(`Falha ao criar decifrador: ${error.message}`))
						return
					}
				}

				try {
					pushBytes(aes.update(data), b => this.push(b))
					callback()
				} catch (error) {
					callback(new Error(`Erro na descriptografia (update): ${error.message}`))
				}
			} catch (error) {
				callback(new Error(`Erro geral de descriptografia: ${error.message}`))
			}
		},
		final(callback) {
			try {
				if (!aes) {
					callback(new Error('Decifrador não iniciado corretamente'))
					return
				}

				try {
					let dataToDecrypt: Buffer = remainingBytes
					let receivedMac: Buffer | undefined

					if (!endByte && remainingBytes.length >= 10) {
						receivedMac = remainingBytes.subarray(-10)
						dataToDecrypt = remainingBytes.subarray(0, -10)
					}

					if (dataToDecrypt.length > 0) {
						pushBytes(aes.update(dataToDecrypt), b => this.push(b))
					}

					if (!endByte) {
						try {
							const finalData: Buffer = aes.final()
							if (finalData.length > 0) {
								pushBytes(finalData, b => this.push(b))
							}
						} catch (finalError) {
							logger.debug({ finalError }, 'Erro ao finalizar descriptografia, possivelmente já processado')
						}

						if (hmac && receivedMac && encryptedChunks.length > 0) {
							try {
								const allEncryptedData: Buffer = Buffer.concat(encryptedChunks)

								if (allEncryptedData.length < 10) {
									logger.warn({
										encryptedDataLength: allEncryptedData.length,
										totalBytesReceived
									}, 'Dados criptografados insuficientes para verificação do MAC')
									callback()
									return
								}

								const encryptedDataWithoutMac: Buffer = allEncryptedData.subarray(0, -10)

								hmac.update(encryptedDataWithoutMac)
								const calculatedMac: Buffer = hmac.digest().subarray(0, 10)

								if (!calculatedMac.equals(receivedMac)) {
									logger.error({
										receivedMac: receivedMac.toString('hex'),
										calculatedMac: calculatedMac.toString('hex'),
										encryptedDataLength: allEncryptedData.length,
										totalBytesReceived
									}, 'Falha na verificação do MAC')
									callback(new Error('Falha na verificação do MAC: dados podem estar corrompidos'))
									return
								}

								logger.debug({}, 'MAC verificado com sucesso')
							} catch (macError) {
								logger.error({ macError }, 'Erro ao processar verificação do MAC')
								callback(macError)
								return
							}
						}
					}

					callback()
				} catch (error) {
					logger.error(error)
					callback(error)
				}
			} catch (error) {
				logger.error(error)
				callback(error)
			}
		},
	})

	fetched.on('error', (error) => {
		logger.error({ error }, 'Erro no stream de download')
		output.destroy(error)
	})

	output.on('error', (error) => {
		logger.error({ error }, 'Erro no stream de descriptografia')
		fetched.destroy()
	})

	return fetched.pipe(output, { end: true })
}

export function extensionForMediaMessage(message: WAMessageContent) {
	const getExtension = (mimetype: string) => mimetype.split(';')[0].split('/')[1]
	const type = Object.keys(message)[0] as MessageType
	let extension: string
	if (
		type === 'locationMessage' ||
		type === 'liveLocationMessage' ||
		type === 'productMessage'
	) {
		extension = '.jpeg'
	} else {
		const messageContent = message[type] as WAGenericMediaMessage
		extension = getExtension(messageContent.mimetype!)
	}

	return extension
}

export const getWAUploadToServer = (
	{ customUploadHosts, logger, options }: SocketConfig,
	refreshMediaConn: (force: boolean) => Promise<MediaConnInfo>
): WAMediaUploadFunction => {
	return async(filePath, { mediaType, fileEncSha256B64, timeoutMs }) => {
		// send a query JSON to obtain the url & auth token to upload our media
		let uploadInfo: MediaConnInfo = await refreshMediaConn(false)

		let urls: { mediaUrl: string; directPath: string; meta_hmac?: string; ts?: number; fbid?: number } | undefined
		const hosts = [...customUploadHosts, ...uploadInfo.hosts]

		fileEncSha256B64 = encodeBase64EncodedStringForUpload(fileEncSha256B64)

		for (const { hostname } of hosts) {
			logger.debug({ hostname }, `uploading to "${hostname}"`)

			const auth = encodeURIComponent(uploadInfo.auth) // the auth token
			const url = `https://${hostname}${MEDIA_PATH_MAP[mediaType]}/${fileEncSha256B64}?auth=${auth}&token=${fileEncSha256B64}`
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let result: any
			try {
				const stream = createReadStream(filePath)
				const response = await fetch(url, {
					method: 'POST',
					body: stream as any,
					headers: {
						...(() => {
							const hdrs = options?.headers
							if (!hdrs) {
								return {}
							}

							return Array.isArray(hdrs) ? Object.fromEntries(hdrs) : (hdrs as Record<string, string>)
						})(),
						'Content-Type': 'application/octet-stream',
						Origin: DEFAULT_ORIGIN
					},
					// duplex: 'half',
					// Note: custom agents/proxy require undici Agent; omitted here.
					signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
				})
				let parsed: any = undefined
				try {
					parsed = await response.json()
				} catch {
					parsed = undefined
				}

				result = parsed

				if (result?.url || result?.directPath) {
					urls = {
						mediaUrl: result.url,
						directPath: result.direct_path,
						meta_hmac: result.meta_hmac,
						fbid: result.fbid,
						ts: result.ts
					}
					break
				} else {
					uploadInfo = await refreshMediaConn(true)
					throw new Error(`upload failed, reason: ${JSON.stringify(result)}`)
				}
			} catch (error: any) {
				const isLast = hostname === hosts[uploadInfo.hosts.length - 1]?.hostname
				logger.warn(
					{ trace: error?.stack, uploadResult: result },
					`Error in uploading to ${hostname} ${isLast ? '' : ', retrying...'}`
				)
			}
		}

		if (!urls) {
			throw new Boom('Media upload failed on all hosts', { statusCode: 500 })
		}

		return urls
	}
}

const getMediaRetryKey = (mediaKey: Buffer | Uint8Array) => {
	return hkdf(mediaKey, 32, { info: 'WhatsApp Media Retry Notification' })
}

/**
 * Generate a binary node that will request the phone to re-upload the media & return the newly uploaded URL
 */
export const encryptMediaRetryRequest = async(
	key: waproto.IMessageKey,
	mediaKey: Buffer | Uint8Array,
	meId: string
) => {
	const recp: waproto.IServerErrorReceipt = { stanzaId: key.id }
	const recpBuffer: Uint8Array = waproto.ServerErrorReceipt.encode(recp).finish()

	const iv: Buffer = Crypto.randomBytes(12)
	const retryKey: Buffer = await getMediaRetryKey(mediaKey)
	const ciphertext: Buffer = aesEncryptGCM(recpBuffer, retryKey, iv, Buffer.from(key.id!))

	const req: BinaryNode = {
		tag: 'receipt',
		attrs: {
			id: key.id!,
			to: jidNormalizedUser(meId),
			type: 'server-error'
		},
		content: [
			{
				tag: 'encrypt',
				attrs: {},
				content: [
					{ tag: 'enc_p', attrs: {}, content: ciphertext },
					{ tag: 'enc_iv', attrs: {}, content: iv }
				]
			},
			{
				tag: 'rmr',
				attrs: {
					jid: key.remoteJid!,
					'from_me': (!!key.fromMe).toString(),
					participant: key.participant!
				}
			}
		]
	}

	return req
}

export const decodeMediaRetryNode = (node: BinaryNode) => {
	const rmrNode: BinaryNode = getBinaryNodeChild(node, 'rmr')!

	const event: BaileysEventMap['messages.media-update'][number] = {
		key: {
			id: node.attrs.id,
			remoteJid: rmrNode.attrs.jid,
			fromMe: rmrNode.attrs.from_me === 'true',
			participant: rmrNode.attrs.participant
		}
	}

	const errorNode: BinaryNode | undefined = getBinaryNodeChild(node, 'error')
	if (errorNode) {
		const errorCode: number = +errorNode.attrs.code
		event.error = new Boom(
			`Failed to re-upload media (${errorCode})`,
			{ data: errorNode.attrs, statusCode: getStatusCodeForMediaRetry(errorCode) }
		)
	} else {
		const encryptedInfoNode: BinaryNode | undefined = getBinaryNodeChild(node, 'encrypt')
		const ciphertext: Uint8Array | Buffer | undefined = getBinaryNodeChildBuffer(encryptedInfoNode, 'enc_p')
		const iv: Uint8Array | Buffer | undefined = getBinaryNodeChildBuffer(encryptedInfoNode, 'enc_iv')
		if (ciphertext && iv) {
			event.media = { ciphertext, iv }
		} else {
			event.error = new Boom('Failed to re-upload media (missing ciphertext)', { statusCode: 404 })
		}
	}

	return event
}

export const decryptMediaRetryData = async(
	{ ciphertext, iv }: { ciphertext: Uint8Array, iv: Uint8Array },
	mediaKey: Uint8Array,
	msgId: string
) => {
	const retryKey: Buffer = await getMediaRetryKey(mediaKey)
	const plaintext: Buffer = aesDecryptGCM(ciphertext, retryKey, iv, Buffer.from(msgId))
	return waproto.MediaRetryNotification.decode(plaintext)
}

export const getStatusCodeForMediaRetry = (code: number) => MEDIA_RETRY_STATUS_MAP[code]

const MEDIA_RETRY_STATUS_MAP = {
	[waproto.MediaRetryNotification.ResultType.SUCCESS]: 200,
	[waproto.MediaRetryNotification.ResultType.DECRYPTION_ERROR]: 412,
	[waproto.MediaRetryNotification.ResultType.NOT_FOUND]: 404,
	[waproto.MediaRetryNotification.ResultType.GENERAL_ERROR]: 418,
} as const
