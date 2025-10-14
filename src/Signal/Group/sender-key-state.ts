import { SenderChainKey } from './sender-chain-key'
import { SenderMessageKey } from './sender-message-key'
import { GROUP_CONSTANTS, SenderChainKeyStructure, SenderKeyStateStructure, SenderMessageKeyStructure, SenderSigningKeyStructure } from './types'
import { ensureBuffer, validateIteration, validateKeyId } from './utils'

export class SenderKeyState {
	private readonly MAX_MESSAGE_KEYS = GROUP_CONSTANTS.MAX_MESSAGE_KEYS
	private readonly senderKeyStateStructure: SenderKeyStateStructure

	constructor(
		id?: number | null,
		iteration?: number | null,
		chainKey?: Uint8Array | null,
		signatureKeyPair?: { public: Uint8Array; private: Uint8Array } | null,
		signatureKeyPublic?: Uint8Array | null,
		signatureKeyPrivate?: Uint8Array | null,
		senderKeyStateStructure?: SenderKeyStateStructure | null
	) {
		if(senderKeyStateStructure) {
			this.senderKeyStateStructure = {
				...senderKeyStateStructure,
				senderMessageKeys: senderKeyStateStructure.senderMessageKeys || []
			}
		} else {
			const keyId: number = id ?? 0
			const iter: number = iteration ?? 0

			validateKeyId(keyId)
			validateIteration(iter)

			if(signatureKeyPair) {
				signatureKeyPublic = signatureKeyPair.public
				signatureKeyPrivate = signatureKeyPair.private
			}

			const senderChainKeyStructure: SenderChainKeyStructure = {
				iteration: iter,
				seed: ensureBuffer(chainKey)
			}

			const signingKeyStructure: SenderSigningKeyStructure = {
				public: ensureBuffer(signatureKeyPublic)
			}

			if(signatureKeyPrivate) {
				signingKeyStructure.private = ensureBuffer(signatureKeyPrivate)
			}

			this.senderKeyStateStructure = {
				senderKeyId: keyId,
				senderChainKey: senderChainKeyStructure,
				senderSigningKey: signingKeyStructure,
				senderMessageKeys: []
			}
		}
	}

	public getKeyId(): number {
		return this.senderKeyStateStructure.senderKeyId
	}

	public getSenderChainKey(): SenderChainKey {
		return new SenderChainKey(
			this.senderKeyStateStructure.senderChainKey.iteration,
			this.senderKeyStateStructure.senderChainKey.seed
		)
	}

	public setSenderChainKey(chainKey: SenderChainKey): void {
		this.senderKeyStateStructure.senderChainKey = {
			iteration: chainKey.getIteration(),
			seed: chainKey.getSeed()
		}
	}

	public getSigningKeyPublic(): Buffer {
		return ensureBuffer(this.senderKeyStateStructure.senderSigningKey.public)
	}

	public getSigningKeyPrivate(): Buffer | undefined {
		const privateKey: Uint8Array | undefined = this.senderKeyStateStructure.senderSigningKey.private
		return privateKey ? ensureBuffer(privateKey) : undefined
	}

	public hasSenderMessageKey(iteration: number): boolean {
		return this.senderKeyStateStructure.senderMessageKeys.some(key => key.iteration === iteration)
	}

	public addSenderMessageKey(senderMessageKey: SenderMessageKey): void {
		this.senderKeyStateStructure.senderMessageKeys.push({
			iteration: senderMessageKey.getIteration(),
			seed: senderMessageKey.getSeed()
		})

		if(this.senderKeyStateStructure.senderMessageKeys.length > this.MAX_MESSAGE_KEYS) {
			this.senderKeyStateStructure.senderMessageKeys.shift()
		}
	}

	public removeSenderMessageKey(iteration: number): SenderMessageKey | null {
		const index: number = this.senderKeyStateStructure.senderMessageKeys.findIndex(key => key.iteration === iteration)

		if(index !== -1) {
			const messageKey: SenderMessageKeyStructure = this.senderKeyStateStructure.senderMessageKeys[index]
			this.senderKeyStateStructure.senderMessageKeys.splice(index, 1)
			return new SenderMessageKey(messageKey.iteration, messageKey.seed)
		}

		return null
	}

	public getStructure(): SenderKeyStateStructure {
		return this.senderKeyStateStructure
	}
}
