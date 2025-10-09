import { Boom } from '@hapi/boom'
import { waproto } from '../../WAProto'
import { NOISE_MODE, WA_CERT_DETAILS } from '../Defaults'
import { KeyPair } from '../Types'
import { BinaryNode, decodeBinaryNode } from '../WABinary'
import { aesDecryptGCM, aesEncryptGCM, Curve, hkdf, sha256 } from './crypto'
import { ILogger } from './logger'

const generateIV = (counter: number) => {
	const iv = new ArrayBuffer(12)
	new DataView(iv).setUint32(8, counter)

	return new Uint8Array(iv)
}

export const makeNoiseHandler = ({
	keyPair: { private: privateKey, public: publicKey },
	NOISE_HEADER,
	logger,
	routingInfo
}: {
	keyPair: KeyPair
	NOISE_HEADER: Uint8Array
	logger: ILogger
	routingInfo?: Buffer | undefined
}) => {
	logger = logger.child({ class: 'ns' })

	const authenticate = (data: Uint8Array) => {
		if(!isFinished) {
			hash = sha256(Buffer.concat([hash, data]))
		}
	}

	const encrypt = (plaintext: Uint8Array) => {
		const result: Buffer = aesEncryptGCM(plaintext, encKey, generateIV(writeCounter), hash)

		writeCounter += 1

		authenticate(result)
		return result
	}

	const decrypt = (ciphertext: Uint8Array) => {
		if(!ciphertext || ciphertext.length === 0) {
			throw new Error('Invalid ciphertext: empty or null')
		}

		const iv: Uint8Array = generateIV(isFinished ? readCounter : writeCounter)
		const result: Buffer = aesDecryptGCM(ciphertext, decKey, iv, hash)

		if(isFinished) {
			readCounter += 1
		} else {
			writeCounter += 1
		}

		authenticate(ciphertext)
		return result
	}

	const localHKDF = async(data: Uint8Array) => {
		const key: Buffer = await hkdf(Buffer.from(data), 64, { salt, info: '' })
		return [key.subarray(0, 32), key.subarray(32)]
	}

	const mixIntoKey = async(data: Uint8Array) => {
		const [write, read] = await localHKDF(data)
		salt = write
		encKey = read
		decKey = read
		readCounter = 0
		writeCounter = 0
	}

	const finishInit = async() => {
		const [write, read] = await localHKDF(new Uint8Array(0))
		encKey = write
		decKey = read
		hash = Buffer.from([])
		readCounter = 0
		writeCounter = 0
		isFinished = true
	}

	const data: Buffer = Buffer.from(NOISE_MODE)
	let hash: Buffer = data.byteLength === 32 ? data : sha256(data)
	let salt: Buffer = hash
	let encKey: Buffer = hash
	let decKey: Buffer = hash
	let readCounter: number = 0
	let writeCounter: number = 0
	let isFinished: boolean = false
	let sentIntro: boolean = false

	let inBytes: Buffer = Buffer.alloc(0)

	authenticate(NOISE_HEADER)
	authenticate(publicKey)

	return {
		encrypt,
		decrypt,
		authenticate,
		mixIntoKey,
		finishInit,
		processHandshake: async({ serverHello }: waproto.HandshakeMessage, noiseKey: KeyPair) => {
			authenticate(serverHello!.ephemeral!)
			await mixIntoKey(Curve.sharedKey(privateKey, serverHello!.ephemeral!))

			const decStaticContent: Buffer = decrypt(serverHello!.static!)
			await mixIntoKey(Curve.sharedKey(privateKey, decStaticContent))

			const certDecoded: Buffer = decrypt(serverHello!.payload!)

			const { intermediate: certIntermediate } = waproto.CertChain.decode(certDecoded)

			const { issuerSerial } = waproto.CertChain.NoiseCertificate.Details.decode(certIntermediate!.details!)

			if(issuerSerial !== WA_CERT_DETAILS.SERIAL) {
				throw new Boom('certification match failed', { statusCode: 400 })
			}

			const keyEnc: Buffer = encrypt(noiseKey.public)
			await mixIntoKey(Curve.sharedKey(noiseKey.private, serverHello!.ephemeral!))

			return keyEnc
		},
		encodeFrame: (data: Buffer | Uint8Array) => {
			if(isFinished) {
				data = encrypt(data)
			}

			let header: Buffer

			if(routingInfo) {
				header = Buffer.alloc(7)
				header.write('ED', 0, 'utf8')
				header.writeUint8(0, 2)
				header.writeUint8(1, 3)
				header.writeUint8(routingInfo.byteLength >> 16, 4)
				header.writeUint16BE(routingInfo.byteLength & 65535, 5)
				header = Buffer.concat([header, routingInfo, NOISE_HEADER])
			} else {
				header = Buffer.from(NOISE_HEADER)
			}

			const introSize: number = sentIntro ? 0 : header.length
			const frame: Buffer = Buffer.alloc(introSize + 3 + data.byteLength)

			if(!sentIntro) {
				frame.set(header)
				sentIntro = true
			}

			frame.writeUInt8(data.byteLength >> 16, introSize)
			frame.writeUInt16BE(65535 & data.byteLength, introSize + 1)
			frame.set(data, introSize + 3)

			return frame
		},
		decodeFrame: async(newData: Buffer | Uint8Array, onFrame: (buff: Uint8Array | BinaryNode) => void) => {
			const getBytesSize = () => {
				if(inBytes.length >= 3) {
					try {
						return (inBytes.readUInt8() << 16) | inBytes.readUInt16BE(1)
					} catch(error) {
						logger.error({ error }, 'Failed to read bytes size from buffer')
						return undefined
					}
				}

				return undefined
			}

			inBytes = Buffer.concat([ inBytes, newData ])

			logger.trace({ newData, inBytes }, `recv ${newData.length} bytes, total recv ${inBytes.length} bytes`)

			let size: number | undefined = getBytesSize()
			while(size && size > 0 && inBytes.length >= size + 3) {
				let frame: Uint8Array | BinaryNode = inBytes.subarray(3, size + 3)
				inBytes = inBytes.subarray(size + 3)

				if(isFinished) {
					const result: Buffer = decrypt(frame)
					if(!result || result.length === 0) {
						logger.warn({}, 'Received empty or null decrypted frame, skipping')
						size = getBytesSize()
						continue
					}

					try {
						frame = await decodeBinaryNode(result)
					} catch(error) {
						logger.error({ error }, 'Failed to decode binary node')
						size = getBytesSize()
						continue
					}
				}

				logger.trace({ msg: (frame as BinaryNode)?.attrs?.id }, 'recv frame')

				onFrame(frame)
				size = getBytesSize()
			}
		}
	}
}
