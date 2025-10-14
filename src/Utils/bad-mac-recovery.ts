import { Boom } from '@hapi/boom'
import { LIDMappingStore } from '../Signal/lid-mapping'
import type { SignalAuthState, SignalRepository } from '../Types'
import { FullJid, jidNormalizedUser } from '../WABinary'
import logger from './logger'
import { BadMACError } from './types'

/**
 * Specific handler for libsignal "Bad MAC" errors
 */
export class BadMACRecoveryManager {
	private errorHistory = new Map<string, BadMACError[]>()
	private recoveryAttempts = new Map<string, number>()
	private maxRetries = 3
	private cooldownPeriod = 60000

	/**
	 * Detects if an error is specifically libsignal's "Bad MAC"
	 */
	isBadMACError(error: Error): boolean {
		const msg: string = error.message?.toLowerCase() || ''
		const stack: string = error.stack?.toLowerCase() || ''

		return (
			msg.includes('bad mac') ||
			msg.includes('bac mac') ||
			msg.includes('mac error') ||
			msg.includes('authentication failed') ||
			msg.includes('mac verification failed') ||
			(stack.includes('verifymac') && stack.includes('crypto.js')) ||
			(stack.includes('session_cipher.js') && (msg.includes('mac') || msg.includes('auth'))) ||
			stack.includes('doDecryptWhisperMessage') ||
			stack.includes('decryptWithSessions')
		)
	}

	/**
	 * Logs a Bad MAC error
	 */
	recordBadMACError(jid: string, error: Error, type: '1:1' | 'group', authorJid?: string): BadMACError {
		const normalizedJid: string = jidNormalizedUser(jid)
		const key: string = type === 'group' && authorJid ? `${normalizedJid}:${jidNormalizedUser(authorJid)}` : normalizedJid

		const currentAttempts: number = this.recoveryAttempts.get(key) || 0
		this.recoveryAttempts.set(key, currentAttempts + 1)

		const badMACError: BadMACError = {
			jid: normalizedJid,
			type,
			authorJid: authorJid ? jidNormalizedUser(authorJid) : undefined,
			timestamp: Date.now(),
			attempt: currentAttempts + 1,
			stackTrace: error.stack || ''
		}

		if(!this.errorHistory.has(key)) {
			this.errorHistory.set(key, [])
		}

		this.errorHistory.get(key)!.push(badMACError)

		logger.warn({
			jid: normalizedJid,
			type,
			authorJid,
			attempt: badMACError.attempt,
			error: error.message
		}, 'Bad MAC error recorded')

		return badMACError
	}

	/**
	 * Checks if automatic recovery should be attempted
	 */
	shouldAttemptRecovery(jid: string, authorJid?: string): boolean {
		const normalizedJid: string = jidNormalizedUser(jid)
		const key: string = authorJid ? `${normalizedJid}:${jidNormalizedUser(authorJid)}` : normalizedJid

		const attempts: number = this.recoveryAttempts.get(key) || 0
		const lastErrors: BadMACError[] = this.errorHistory.get(key) || []

		if(lastErrors.length > 0) {
			const lastError: BadMACError = lastErrors[lastErrors.length - 1]
			if(Date.now() - lastError.timestamp < this.cooldownPeriod) {
				return attempts < this.maxRetries
			}
		}

		this.recoveryAttempts.set(key, 0)
		return true
	}

	/**
	 * Executes automatic recovery for Bad MAC error
	 */
	async attemptRecovery(
		jid: string,
		authState: SignalAuthState,
		repository: SignalRepository,
		type: '1:1' | 'group',
		authorJid?: string
	): Promise<boolean> {
		const normalizedJid: string = jidNormalizedUser(jid)
		const normalizedAuthorJid: string | undefined = authorJid ? jidNormalizedUser(authorJid) : undefined

		if(!this.shouldAttemptRecovery(normalizedJid, normalizedAuthorJid)) {
			logger.warn({
				jid: normalizedJid,
				authorJid: normalizedAuthorJid,
				type
			}, 'Bad MAC recovery skipped - max retries exceeded or in cooldown')
			return false
		}

		try {
			logger.info({
				jid: normalizedJid,
				authorJid: normalizedAuthorJid,
				type
			}, 'Attempting Bad MAC recovery')

			if(type === '1:1') {
				await this.recover1to1Session(normalizedJid, authState, repository)
			} else if(type === 'group' && normalizedAuthorJid) {
				await this.recoverGroupSenderKey(normalizedJid, normalizedAuthorJid, authState)
			}

			logger.info({
				jid: normalizedJid,
				authorJid: normalizedAuthorJid,
				type
			}, 'Bad MAC recovery completed successfully')

			return true
		} catch(recoveryError) {
			logger.error({
				jid: normalizedJid,
				authorJid: normalizedAuthorJid,
				type,
				recoveryError
			}, 'Bad MAC recovery failed')

			return false
		}
	}

	/**
	 * Recovers 1:1 session by removing corrupted data
	 */
	private async recover1to1Session(jid: string, authState: SignalAuthState, repository: SignalRepository): Promise<void> {
		logger.info({ jid }, 'Starting comprehensive 1:1 session recovery for Bad MAC error')

		if(jid.includes('@s.whatsapp.net')) {
			const lidMapping: LIDMappingStore = repository.getLIDMappingStore()
			const lidForPN: string | null = await lidMapping.getLIDForPN(jid)

			if(lidForPN?.includes('@lid')) {
				const pnAddr: string = repository.jidToSignalProtocolAddress(jid)
				const lidAddr: string = repository.jidToSignalProtocolAddress(lidForPN)

				logger.debug({ jid, lidForPN, pnAddr: pnAddr.toString(), lidAddr: lidAddr.toString() },
					'Clearing both PN and LID sessions due to Bad MAC error')

				await authState.keys.set({
					session: {
						[pnAddr.toString()]: null,
						[lidAddr.toString()]: null
					}
				})

				await authState.keys.set({
					'pre-key': {
						[pnAddr.toString()]: null,
						[lidAddr.toString()]: null
					}
				})

				logger.debug({ jid, lidForPN }, 'Reset both PN and LID sessions with identity keys for Bad MAC recovery')
			}
		}

		const addr: string = repository.jidToSignalProtocolAddress(jid)
		logger.debug({ jid, address: addr.toString() }, 'Clearing session data for Bad MAC recovery')

		await authState.keys.set({
			session: { [addr.toString()]: null }
		})

		await authState.keys.set({
			session: { [addr.toString()]: null }
		})

		logger.debug({ jid }, 'Performing aggressive pre-key cleanup for Bad MAC recovery')

		const { 'pre-key': existingPreKeys } = await authState.keys.get('pre-key', [])
		if(existingPreKeys && Object.keys(existingPreKeys).length > 0) {
			logger.debug({ jid, preKeyCount: Object.keys(existingPreKeys).length },
				'Clearing existing pre-keys during Bad MAC recovery')
		}

		await authState.keys.set({
			session: { [addr.toString()]: null }
		})

		await authState.keys.set({
			'pre-key': {}
		})

		logger.info({ jid, address: addr.toString() },
			'Completed comprehensive session recovery for Bad MAC error - session, identity, and keys cleared')
	}

	/**
	 * Recovers group sender key by removing corrupted data
	 */
	private async recoverGroupSenderKey(groupJid: string, authorJid: string, authState: SignalAuthState): Promise<void> {
		const { SenderKeyName } = await import('../Signal/Group/sender-key-name')
		const { jidDecode } = await import('../WABinary')

		const decoded: FullJid | undefined = jidDecode(authorJid)
		if(!decoded) {
			throw new Error(`Invalid JID format: ${authorJid}`)
		}

		const sender = {
			id: decoded.user,
			deviceId: decoded.device || 0,
			toString: () => `${decoded.user}.${decoded.device || 0}`
		}

		const senderKeyName = new SenderKeyName(groupJid, sender)
		const keyId: string = senderKeyName.toString()

		await authState.keys.set({
			'sender-key': { [keyId]: null }
		})

		logger.debug({ groupJid, authorJid, keyId }, 'Reset sender key for Bad MAC recovery')
	}

	/**
	 * Clears old error history
	 */
	cleanup(): void {
		const cutoff: number = Date.now() - (this.cooldownPeriod * 10)
		let cleaned = 0

		this.errorHistory.forEach((errors, key) => {
			const recentErrors: BadMACError[] = errors.filter(err => err.timestamp > cutoff)

			if(recentErrors.length === 0) {
				this.errorHistory.delete(key)
				this.recoveryAttempts.delete(key)
				cleaned++
			} else if(recentErrors.length < errors.length) {
				this.errorHistory.set(key, recentErrors)
			}
		})

		if(cleaned > 0) {
			logger.debug({ cleaned }, 'Cleaned up old Bad MAC error history')
		}
	}

	/**
	 * Get Bad MAC error statistics
	 */
	getStats(jid?: string, authorJid?: string) {
		if(jid) {
			const normalizedJid: string = jidNormalizedUser(jid)
			const key: string = authorJid ? `${normalizedJid}:${jidNormalizedUser(authorJid)}` : normalizedJid
			const errors: BadMACError[] = this.errorHistory.get(key) || []
			const attempts: number = this.recoveryAttempts.get(key) || 0

			return {
				jid: normalizedJid,
				authorJid: authorJid ? jidNormalizedUser(authorJid) : undefined,
				totalErrors: errors.length,
				recoveryAttempts: attempts,
				lastError: errors[errors.length - 1]?.timestamp || 0,
				canRetry: this.shouldAttemptRecovery(normalizedJid, authorJid)
			}
		}

		let totalErrors = 0
		let totalAttempts = 0
		let activeJids = 0

		this.errorHistory.forEach((errors, key) => {
			totalErrors += errors.length
			const attempts: number = this.recoveryAttempts.get(key) || 0
			totalAttempts += attempts

			if(attempts > 0) {
				activeJids++
			}
		})

		return {
			totalJIDs: this.errorHistory.size,
			totalErrors,
			totalAttempts,
			activeJids,
			healthScore: Math.max(0, 100 - (activeJids / Math.max(1, this.errorHistory.size)) * 100)
		}
	}
}

export const badMACRecovery = new BadMACRecoveryManager()

setInterval(() => {
	badMACRecovery.cleanup()
}, 300000)

/**
 * Utility function to automatically handle Bad MAC errors
 */
export async function handleBadMACError(
	jid: string,
	error: Error,
	authState: SignalAuthState,
	repository: SignalRepository,
	authorJid?: string
): Promise<never> {
	const type: 'group' | '1:1' = authorJid ? 'group' : '1:1'

	const errorInfo: BadMACError = badMACRecovery.recordBadMACError(jid, error, type, authorJid)

	const recovered: boolean = await badMACRecovery.attemptRecovery(jid, authState, repository, type, authorJid)

	const boom = new Boom(
		`Bad MAC error ${recovered ? 'with automatic recovery' : 'requiring manual intervention'}`,
		{
			statusCode: 500,
			data: {
				jid: errorInfo.jid,
				type: errorInfo.type,
				authorJid: errorInfo.authorJid,
				attempt: errorInfo.attempt,
				recovered,
				canRetry: badMACRecovery.shouldAttemptRecovery(jid, authorJid),
				stats: badMACRecovery.getStats(jid, authorJid)
			}
		}
	)

	throw boom
}
