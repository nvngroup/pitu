import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto'
import * as libsignal from 'libsignal'
import { KEY_BUNDLE_TYPE } from '../Defaults'
import { KeyPair } from '../Types'
import logger from './logger'

export const generateSignalPubKey = (pubKey: Uint8Array | Buffer) => (
	pubKey.length === 33
		? pubKey
		: Buffer.concat([ KEY_BUNDLE_TYPE, pubKey ])
)

export const Curve = {
	generateKeyPair: (): KeyPair => {
		const { pubKey, privKey } = libsignal.curve.generateKeyPair()
		return {
			private: Buffer.from(privKey),
			public: Buffer.from((pubKey as Uint8Array).slice(1))
		}
	},
	sharedKey: (privateKey: Uint8Array, publicKey: Uint8Array) => {
		const shared = libsignal.curve.calculateAgreement(generateSignalPubKey(publicKey), privateKey)
		return Buffer.from(shared)
	},
	sign: (privateKey: Uint8Array, buf: Uint8Array) => (
		libsignal.curve.calculateSignature(privateKey, buf)
	),
	verify: (pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => {
		try {
			libsignal.curve.verifySignature(generateSignalPubKey(pubKey), message, signature)
			return true
		} catch(error) {
			logger.error({ error }, 'Error verifying signature')
			return false
		}
	}
}

export const signedKeyPair = (identityKeyPair: KeyPair, keyId: number) => {
	const preKey = Curve.generateKeyPair()
	const pubKey = generateSignalPubKey(preKey.public)

	const signature = Curve.sign(identityKeyPair.private, pubKey)

	return { keyPair: preKey, signature, keyId }
}

const GCM_TAG_LENGTH = 128 >> 3

/**
 * encrypt AES 256 GCM;
 * where the tag tag is suffixed to the ciphertext
 * */
export function aesEncryptGCM(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array, additionalData: Uint8Array) {
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	cipher.setAAD(additionalData)
	return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

/**
 * decrypt AES 256 GCM;
 * where the auth tag is suffixed to the ciphertext
 * */
export function aesDecryptGCM(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array, additionalData: Uint8Array) {
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, iv)
		const enc = ciphertext.slice(0, ciphertext.length - GCM_TAG_LENGTH)
		const tag = ciphertext.slice(ciphertext.length - GCM_TAG_LENGTH)

		decipher.setAAD(additionalData)
		decipher.setAuthTag(tag)

		return Buffer.concat([decipher.update(enc), decipher.final()])
	} catch(error) {
		logger.error({
			error: error instanceof Error ? error.message : String(error),
			ciphertextLength: ciphertext.length,
			keyLength: key.length,
			ivLength: iv.length,
			additionalDataLength: additionalData.length
		}, 'Fatal error in GCM decoding')
		return Buffer.from([])
	}
}

export function aesEncryptCTR(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array) {
	const cipher = createCipheriv('aes-256-ctr', key, iv)
	return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

export function aesDecryptCTR(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array) {
	const decipher = createDecipheriv('aes-256-ctr', key, iv)
	return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function aesDecrypt(buffer: Buffer, key: Buffer) {
	return aesDecryptWithIV(buffer.slice(16, buffer.length), key, buffer.slice(0, 16))
}

export function aesDecryptWithIV(buffer: Buffer, key: Buffer, IV: Buffer) {
	const aes = createDecipheriv('aes-256-cbc', key, IV)
	return Buffer.concat([aes.update(buffer), aes.final()])
}

export function aesEncrypt(buffer: Buffer | Uint8Array, key: Buffer) {
	const IV = randomBytes(16)
	const aes = createCipheriv('aes-256-cbc', key, IV)
	return Buffer.concat([IV, aes.update(buffer), aes.final()])
}

export function aesEncrypWithIV(buffer: Buffer, key: Buffer, IV: Buffer) {
	const aes = createCipheriv('aes-256-cbc', key, IV)
	return Buffer.concat([aes.update(buffer), aes.final()])
}

export function hmacSign(buffer: Buffer | Uint8Array, key: Buffer | Uint8Array, variant: 'sha256' | 'sha512' = 'sha256') {
	return createHmac(variant, key).update(buffer).digest()
}

export function sha256(buffer: Buffer) {
	return createHash('sha256').update(buffer).digest()
}

export function md5(buffer: Buffer) {
	return createHash('md5').update(buffer).digest()
}

export async function hkdf(
	buffer: Uint8Array | Buffer,
	expandedLength: number,
	info: { salt?: Buffer, info?: string }
): Promise<Buffer> {
	const inputKeyMaterial = buffer instanceof Uint8Array
		? buffer
		: new Uint8Array(buffer)

	const salt = info.salt ? new Uint8Array(info.salt) : new Uint8Array(0)
	const infoBytes = info.info
		? new TextEncoder().encode(info.info)
		: new Uint8Array(0)

	const keyBuffer = new ArrayBuffer(inputKeyMaterial.byteLength)
	new Uint8Array(keyBuffer).set(inputKeyMaterial)

	const importedKey = await crypto.subtle.importKey(
		'raw',
		keyBuffer,
		{ name: 'HKDF' },
		false,
		['deriveBits']
	)

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: salt,
			info: infoBytes
		},
		importedKey,
		expandedLength * 8
	)

	return Buffer.from(derivedBits)
}

export async function derivePairingCodeKey(pairingCode: string, salt: Buffer): Promise<Buffer> {
	const encoder = new TextEncoder()
	const pairingCodeBuffer = encoder.encode(pairingCode)

	const saltArrayBuffer = new ArrayBuffer(salt.byteLength)
	new Uint8Array(saltArrayBuffer).set(salt)

	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		pairingCodeBuffer,
		{ name: 'PBKDF2' },
		false,
		['deriveBits']
	)

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: saltArrayBuffer,
			iterations: 2 << 16,
			hash: 'SHA-256'
		},
		keyMaterial,
		32 * 8
	)

	return Buffer.from(derivedBits)
}
