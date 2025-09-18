import logger from './logger'

export interface SessionErrorInfo {
	jid: string
	errorType: 'bad_mac' | 'session_corrupt' | 'key_missing' | 'unknown'
	originalError: string
	timestamp: number
}

/**
 * Detecta e categoriza erros de sessão/criptografia
 */
export function detectSessionError(error: Error): SessionErrorInfo | null {
	const errorMsg = error.message?.toLowerCase() || ''

	// Padrões de erro conhecidos
	const patterns = {
		badMac: ['bad mac', 'mac verification failed', 'invalid mac'],
		sessionCorrupt: ['session', 'no session', 'session corrupt'],
		keyMissing: ['no key', 'key not found', 'missing key', 'key used already']
	}

	for(const [type, patternList] of Object.entries(patterns)) {
		if(patternList.some(pattern => errorMsg.includes(pattern))) {
			return {
				jid: '', // será preenchido pelo caller
				errorType: type as SessionErrorInfo['errorType'],
				originalError: error.message,
				timestamp: Date.now()
			}
		}
	}

	return null
}

/**
 * Cria uma estratégia de recuperação para erros de sessão
 */
export class SessionRecoveryStrategy {
	private errorHistory = new Map<string, SessionErrorInfo[]>()
	private maxRetries = 3

	/**
	 * Registra um erro de sessão
	 */
	recordError(jid: string, errorInfo: SessionErrorInfo) {
		errorInfo.jid = jid

		if(!this.errorHistory.has(jid)) {
			this.errorHistory.set(jid, [])
		}

		const errors = this.errorHistory.get(jid)!
		errors.push(errorInfo)

		// Mantém apenas os últimos 10 erros
		if(errors.length > 10) {
			errors.splice(0, errors.length - 10)
		}

		logger.warn({
			jid,
			errorType: errorInfo.errorType,
			recentErrorCount: this.getRecentErrorCount(jid)
		}, 'Session error recorded')
	}

	/**
	 * Verifica se deve tentar recuperar a sessão
	 */
	shouldAttemptRecovery(jid: string): boolean {
		const recentErrors = this.getRecentErrorCount(jid)
		return recentErrors < this.maxRetries
	}

	/**
	 * Obtém contagem de erros recentes (últimos 5 minutos)
	 */
	private getRecentErrorCount(jid: string): number {
		const errors = this.errorHistory.get(jid) || []
		const recentThreshold = Date.now() - 300000 // 5 minutos

		return errors.filter(error => error.timestamp > recentThreshold).length
	}

	/**
	 * Limpa histórico antigo de erros
	 */
	cleanup() {
		const cleanupThreshold = Date.now() - 3600000 // 1 hora

		for(const [jid, errors] of this.errorHistory.entries()) {
			const recentErrors = errors.filter(error => error.timestamp > cleanupThreshold)

			if(recentErrors.length === 0) {
				this.errorHistory.delete(jid)
			} else {
				this.errorHistory.set(jid, recentErrors)
			}
		}
	}

	/**
	 * Gera recomendações de recuperação
	 */
	getRecoveryRecommendation(jid: string, errorType: SessionErrorInfo['errorType']): string {
		const recentErrors = this.getRecentErrorCount(jid)

		switch (errorType) {
		case 'bad_mac':
			if(recentErrors > 2) {
				return 'Consider full session reset - persistent MAC errors detected'
			}

			return 'Session key corruption detected - attempting automatic recovery'

		case 'session_corrupt':
			return 'Session state corrupted - reinitializing session'

		case 'key_missing':
			return 'Encryption keys missing - waiting for key exchange'

		default:
			return 'Unknown session error - monitoring for patterns'
		}
	}

	/**
	 * Obtém estatísticas de erro para um JID
	 */
	getErrorStats(jid: string) {
		const errors = this.errorHistory.get(jid) || []
		const recentErrors = this.getRecentErrorCount(jid)

		const errorsByType = errors.reduce((acc, error) => {
			acc[error.errorType] = (acc[error.errorType] || 0) + 1
			return acc
		}, {} as Record<string, number>)

		return {
			totalErrors: errors.length,
			recentErrors,
			errorsByType,
			lastError: errors[errors.length - 1]
		}
	}
}

export const sessionRecovery = new SessionRecoveryStrategy()

setInterval(() => {
	sessionRecovery.cleanup()
}, 3600000)
