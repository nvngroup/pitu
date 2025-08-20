/**
 * Exemplo de como tratar erros MAC/Bad MAC no Baileys
 * 
 * Este exemplo mostra como o sistema de recuperação automática
 * funciona quando erros MAC são encontrados durante a descriptografia de mensagens.
 */

import makeWASocket, { 
	useMultiFileAuthState, 
	DisconnectReason
} from '../src'
import { Boom } from '@hapi/boom'

async function connectToWhatsApp() {
	// Configurar autenticação
	const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
	
	// Criar socket com configurações que ajudam na recuperação de MAC
	const sock = makeWASocket({
		auth: state,
		printQRInTerminal: true,
		// Configurações de rede que ajudam na estabilidade
		connectTimeoutMs: 60000,
		defaultQueryTimeoutMs: 0,
		// Configurar retry para mensagens com falha
		retryRequestDelayMs: 250,
		// Configurações que podem ajudar com erros MAC
		generateHighQualityLinkPreview: true,
		syncFullHistory: false, // Evitar sincronização completa que pode causar conflitos
	})

	// Evento para salvar credenciais quando atualizadas
	sock.ev.on('creds.update', saveCreds)

	// Evento para tratar conexões
	sock.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect } = update
		if(connection === 'close') {
			const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
			console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
			
			if(shouldReconnect) {
				connectToWhatsApp()
			}
		} else if(connection === 'open') {
			console.log('opened connection')
		}
	})

	// Evento para tratar mensagens
	sock.ev.on('messages.upsert', async(m) => {
		console.log('received messages', JSON.stringify(m, undefined, 2))

		const msg = m.messages[0]
		if(!msg.key.fromMe && m.type === 'notify') {
			// Exemplo de como responder mensagens
			// O sistema de recuperação MAC funcionará automaticamente
			// se houver problemas de descriptografia
			try {
				await sock.sendMessage(msg.key.remoteJid!, { 
					text: 'Mensagem recebida!' 
				})
			} catch(error) {
				console.error('Erro ao enviar mensagem:', error)
				
				// Verificar se é um erro relacionado a MAC
				if(error.message?.includes('Bad MAC') || error.message?.includes('MAC verification failed')) {
					console.log('Erro MAC detectado - sistema de recuperação está trabalhando...')
					// O sistema automaticamente tentará recuperar a sessão
					// Você pode implementar lógica adicional aqui se necessário
				}
			}
		}
	})

	return sock
}

// Função para demonstrar como monitorar estatísticas de erro MAC
function setupMACErrorMonitoring() {
	// Verificar estatísticas de erro MAC a cada 5 minutos
	setInterval(() => {
		try {
			// Importar os gerenciadores de erro
			import('../src/Utils/mac-error-handler').then(({ macErrorManager }) => {
				const stats = macErrorManager.getErrorStats()
				console.log('MAC Error Statistics:', {
					globalStats: stats,
					timestamp: new Date().toISOString()
				})

				// Se há muitos erros, você pode implementar lógica adicional
				if(stats.jidsWithIssues > 5) {
					console.warn('⚠️  Múltiplos JIDs com problemas MAC detectados!')
					console.log('Considerações:')
					console.log('- Verificar se o arquivo de auth não está sendo sincronizado pelo OneDrive/Dropbox')
					console.log('- Verificar se há múltiplas instâncias rodando')
					console.log('- Considerar fazer backup e limpar auth_info')
				}
			})

			import('../src/Utils/bad-mac-recovery').then(({ badMACRecovery }) => {
				const badMACStats = badMACRecovery.getStats()
				console.log('Bad MAC Recovery Statistics:', {
					stats: badMACStats,
					timestamp: new Date().toISOString()
				})
			})
		} catch(error) {
			console.debug('Error checking MAC statistics:', error)
		}
	}, 5 * 60 * 1000) // 5 minutos
}

// Função para limpar dados corrompidos manualmente (uso em casos extremos)
async function manualSessionCleanup(jid: string) {
	try {
		const { state } = await useMultiFileAuthState('auth_info_baileys')
		
		// Limpar sessão específica
		await state.keys.set({
			session: { [jid]: null }
		})
		
		console.log(`✅ Sessão limpa para ${jid}`)
		console.log('⚠️  Será necessário reestabelecer a sessão com este contato')
		
	} catch(error) {
		console.error('Erro ao limpar sessão:', error)
	}
}

// Configurações recomendadas para evitar erros MAC
function getRecommendedConfig() {
	return {
		// Não sincronizar pasta auth_info com cloud storage
		authPath: './auth_info_local', // Usar pasta local

		// Configurações de rede estáveis
		connectTimeoutMs: 60000,
		defaultQueryTimeoutMs: 0,
		
		// Configurações para reduzir conflitos
		syncFullHistory: false,
		
		// Configurar cache de chaves
		keysCacheSize: 1000,
		
		// Log detalhado para debug
		logger: console,
		
		// Configurações de retry
		retryRequestDelayMs: 250,
		maxMsgRetryCount: 5,
	}
}

// Executar exemplo
if(require.main === module) {
	console.log('🚀 Iniciando exemplo de recuperação MAC...')
	console.log('📊 Configurando monitoramento de estatísticas...')
	
	setupMACErrorMonitoring()
	connectToWhatsApp()
	
	console.log('\n📋 Comandos úteis:')
	console.log('- Para limpar sessão manualmente: manualSessionCleanup("jid@s.whatsapp.net")')
	console.log('- Para verificar configurações recomendadas: getRecommendedConfig()')
	console.log('\n⚠️  IMPORTANTE:')
	console.log('- Nunca sincronize a pasta auth_info com OneDrive/Dropbox/Google Drive')
	console.log('- Use apenas uma instância por número de telefone')
	console.log('- Mantenha backups regulares da pasta auth_info')
}

export {
	connectToWhatsApp,
	setupMACErrorMonitoring,
	manualSessionCleanup,
	getRecommendedConfig
}
