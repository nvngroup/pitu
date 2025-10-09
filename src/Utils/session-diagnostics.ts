import { LIDMappingStore } from '../Signal/lid-mapping'
import type { SignalAuthState, SignalRepository } from '../Types'
import { jidNormalizedUser } from '../WABinary'
import logger from './logger'
import { SessionDiagnosticResult, SessionHealth } from './types'

/**
 * Utility class for diagnosing and recovering corrupted Signal sessions
 */
export class SessionDiagnostics {
	private static instance: SessionDiagnostics
	private sessionErrors = new Map<string, { count: number; lastError: Date; errorTypes: string[] }>()

	static getInstance(): SessionDiagnostics {
		if(!SessionDiagnostics.instance) {
			SessionDiagnostics.instance = new SessionDiagnostics()
		}

		return SessionDiagnostics.instance
	}

	/**
	 * Diagnoses a specific session for potential issues
	 */
	async diagnoseSession(
		jid: string,
		authState: SignalAuthState,
		repository: SignalRepository
	): Promise<SessionDiagnosticResult> {
		const normalizedJid: string = jidNormalizedUser(jid)
		const addr = repository.jidToSignalProtocolAddress(normalizedJid)

		try {
			const { session } = await authState.keys.get('session', [addr.toString()])
			const hasSession: boolean = !!session?.[addr.toString()]

			const { 'pre-key': preKeys } = await authState.keys.get('pre-key', [])
			const hasPreKeys: boolean = preKeys && Object.keys(preKeys).length > 0

			const errorInfo = this.sessionErrors.get(normalizedJid)!
			const hasRecentErrors: boolean | undefined = errorInfo && (Date.now() - errorInfo.lastError.getTime()) < 300000 // 5 minutes

			let recommendation: string = 'Session appears healthy'
			let canRecover: boolean = true

			if(!hasSession) {
				recommendation = 'Session missing - requires key exchange'
				canRecover = false
			} else if(hasRecentErrors && errorInfo.count >= 3) {
				recommendation = 'Frequent errors detected - recommend session reset'
			} else if(hasRecentErrors) {
				recommendation = 'Recent errors detected - monitor closely'
			} else if(!hasPreKeys) {
				recommendation = 'No pre-keys available - may affect future sessions'
			}

			logger.debug({
				jid: normalizedJid,
				hasSession,
				hasPreKeys,
				hasRecentErrors,
				errorCount: errorInfo?.count || 0,
				recommendation
			}, 'Session diagnostic completed')

			return {
				jid: normalizedJid,
				hasSession,
				hasPreKeys,
				hasIdentityKey: hasSession,
				lastError: errorInfo?.errorTypes?.[errorInfo.errorTypes.length - 1],
				recommendation,
				canRecover
			}
		} catch(error) {
			logger.error({ jid: normalizedJid, error }, 'Failed to diagnose session')

			return {
				jid: normalizedJid,
				hasSession: false,
				hasPreKeys: false,
				hasIdentityKey: false,
				lastError: error.message,
				recommendation: 'Diagnostic failed - recommend manual session reset',
				canRecover: false
			}
		}
	}

	/**
	 * Performs a comprehensive health check on all sessions
	 */
	async performHealthCheck(
		authState: SignalAuthState
	): Promise<SessionHealth> {
		try {
			const { session: allSessions } = await authState.keys.get('session', [])

			if(!allSessions) {
				return {
					healthy: 0,
					corrupted: 0,
					missing: 0,
					total: 0,
					score: 100
				}
			}

			const sessionKeys: string[] = Object.keys(allSessions)
			let healthy: number = 0
			let corrupted: number = 0
			let missing: number = 0

			for(const sessionKey of sessionKeys) {
				const sessionData = allSessions[sessionKey]

				if(!sessionData) {
					missing++
					continue
				}

				// Extract JID from session key
				const parts: string[] = sessionKey.split('.')
				if(parts.length >= 2) {
					const jid = `${parts[0]}@s.whatsapp.net`
					const errorInfo = this.sessionErrors.get(jid)

					if(errorInfo && errorInfo.count >= 3) {
						corrupted++
					} else {
						healthy++
					}
				} else {
					healthy++
				}
			}

			const total: number = healthy + corrupted + missing
			const score: number = total > 0 ? Math.round((healthy / total) * 100) : 100

			logger.info({
				healthy,
				corrupted,
				missing,
				total,
				score
			}, 'Session health check completed')

			return { healthy, corrupted, missing, total, score }
		} catch(error) {
			logger.error({ error }, 'Failed to perform session health check')

			return {
				healthy: 0,
				corrupted: 0,
				missing: 0,
				total: 0,
				score: 0
			}
		}
	}

	/**
	 * Records a session error for tracking
	 */
	recordSessionError(jid: string, errorType: string): void {
		const normalizedJid: string = jidNormalizedUser(jid)
		const existing = this.sessionErrors.get(normalizedJid) || {
			count: 0,
			lastError: new Date(),
			errorTypes: []
		}

		existing.count++
		existing.lastError = new Date()
		existing.errorTypes.push(errorType)

		// Keep only last 10 error types
		if(existing.errorTypes.length > 10) {
			existing.errorTypes = existing.errorTypes.slice(-10)
		}

		this.sessionErrors.set(normalizedJid, existing)

		logger.debug({
			jid: normalizedJid,
			errorType,
			totalErrors: existing.count
		}, 'Session error recorded')
	}

	/**
	 * Forces a complete session reset for a problematic JID
	 */
	async forceSessionReset(
		jid: string,
		authState: SignalAuthState,
		repository: SignalRepository,
		options: {
			clearPreKeys?: boolean
			clearSenderKeys?: boolean
			clearLIDMapping?: boolean
		} = {}
	): Promise<boolean> {
		const normalizedJid: string = jidNormalizedUser(jid)

		try {
			logger.warn({ jid: normalizedJid, options }, 'Forcing complete session reset')

			await this.clearSessionData(normalizedJid, authState, repository)

			if(options.clearPreKeys) {
				await authState.keys.set({ 'pre-key': {} })
				logger.debug({ jid: normalizedJid }, 'Pre-keys cleared during forced reset')
			}

			if(options.clearSenderKeys && normalizedJid.includes('@g.us')) {
				await this.clearGroupSenderKeys(normalizedJid, authState)
			}

			if(options.clearLIDMapping && normalizedJid.includes('@s.whatsapp.net')) {
				await this.clearLIDMapping(normalizedJid, repository)
			}

			this.sessionErrors.delete(normalizedJid)

			logger.info({ jid: normalizedJid }, 'Forced session reset completed successfully')
			return true
		} catch(error) {
			logger.error({ jid: normalizedJid, error }, 'Failed to force session reset')
			return false
		}
	}

	/**
	 * Clears session data for a specific JID
	 */
	private async clearSessionData(
		jid: string,
		authState: SignalAuthState,
		repository: SignalRepository
	): Promise<void> {
		const addr: string = repository.jidToSignalProtocolAddress(jid)

		await authState.keys.set({
			session: { [addr.toString()]: null }
		})

		logger.debug({ jid, address: addr.toString() }, 'Session data cleared')
	}

	/**
	 * Clears all sender keys for a group
	 */
	private async clearGroupSenderKeys(groupJid: string, authState: SignalAuthState): Promise<void> {
		const { 'sender-key': allSenderKeys } = await authState.keys.get('sender-key', [])

		if(!allSenderKeys) {
			return
		}

		const keysToDelete: Record<string, null> = {}

		for(const keyId of Object.keys(allSenderKeys)) {
			if(keyId.includes(groupJid)) {
				keysToDelete[keyId] = null
			}
		}

		if(Object.keys(keysToDelete).length > 0) {
			await authState.keys.set({ 'sender-key': keysToDelete })
			logger.debug({ groupJid, clearedKeys: Object.keys(keysToDelete).length }, 'Group sender keys cleared')
		}
	}

	/**
	 * Clears LID mapping for a JID
	 */
	private async clearLIDMapping(jid: string, repository: SignalRepository): Promise<void> {
		try {
			const lidMapping: LIDMappingStore = repository.getLIDMappingStore()
			const lidForPN: string | null = await lidMapping.getLIDForPN(jid)

			if(lidForPN) {
				logger.debug({ jid, lidForPN }, 'LID mapping found but clearing not implemented in current SignalRepository interface')
			}
		} catch(error) {
			logger.debug({ jid, error }, 'No LID mapping found or failed to clear')
		}
	}	/**
	 * Gets error statistics for a specific JID
	 */
	getErrorStats(jid: string) {
		const normalizedJid: string = jidNormalizedUser(jid)
		const errorInfo = this.sessionErrors.get(normalizedJid)

		if(!errorInfo) {
			return {
				jid: normalizedJid,
				errorCount: 0,
				lastError: null,
				recentErrorTypes: []
			}
		}

		return {
			jid: normalizedJid,
			errorCount: errorInfo.count,
			lastError: errorInfo.lastError,
			recentErrorTypes: errorInfo.errorTypes.slice(-5)
		}
	}

	/**
	 * Cleans up old error data
	 */
	cleanup(): void {
		const cutoff: number = Date.now() - (24 * 60 * 60 * 1000) // 24 hours
		let cleaned: number = 0

		for(const [jid, errorInfo] of this.sessionErrors.entries()) {
			if(errorInfo.lastError.getTime() < cutoff) {
				this.sessionErrors.delete(jid)
				cleaned++
			}
		}

		if(cleaned > 0) {
			logger.debug({ cleaned }, 'Cleaned up old session error data')
		}
	}
}

export const sessionDiagnostics = SessionDiagnostics.getInstance()

// Auto-cleanup every hour
setInterval(() => {
	sessionDiagnostics.cleanup()
}, 60 * 60 * 1000)
