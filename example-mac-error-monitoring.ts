// Exemplo de uso da solução Bad MAC com monitoramento
// Para usar este exemplo, ajuste os imports conforme sua configuração

import { macErrorManager } from './src/Utils/mac-error-handler'

/**
 * Exemplo de monitoramento de erros MAC
 */
function startMACMonitoring() {
    // Monitoramento de erros MAC
    setInterval(() => {
        const stats = macErrorManager.getErrorStats()

        if (stats.recentErrors > 0) {
            console.log('📊 Estatísticas de erros MAC:')
            console.log(`   Total de JIDs afetados: ${stats.totalJIDs}`)
            console.log(`   Erros recentes (último minuto): ${stats.recentErrors}`)
            console.log(`   Total de erros: ${stats.totalErrors}`)
        }
    }, 60000) // A cada minuto

    console.log('✨ Monitoramento de erros MAC iniciado')
}

// Função utilitária para obter relatório detalhado
function getMACErrorReport() {
    const globalStats = macErrorManager.getErrorStats()

    console.log('\n📋 RELATÓRIO DE ERROS MAC')
    console.log('=' .repeat(50))
    console.log(`Total de JIDs afetados: ${globalStats.totalJIDs}`)
    console.log(`Total de erros: ${globalStats.totalErrors}`)
    console.log(`Erros recentes: ${globalStats.recentErrors}`)

    console.log('\n🔍 Para obter detalhes de um JID específico, use:')
    console.log('macErrorManager.getErrorStats("numero@s.whatsapp.net")')
}

// Exemplo de função para limpeza periódica
function setupPeriodicCleanup() {
    // Limpeza durante horários de baixo uso (ex: 3h da manhã)
    setInterval(() => {
        const now = new Date()
        if (now.getHours() === 3 && now.getMinutes() === 0) {
            console.log('🧹 Executando limpeza de manutenção dos erros MAC')

            const statsBefore = macErrorManager.getErrorStats()
            // Força limpeza via método público se necessário
            console.log(`📊 Estatísticas antes da limpeza: ${statsBefore.totalErrors} erros`)
        }
    }, 60000) // Verifica a cada minuto
}

// Exemplo de integração com alertas
function setupAlerts() {
    let lastAlertTime = 0
    const alertCooldown = 300000 // 5 minutos

    setInterval(() => {
        const stats = macErrorManager.getErrorStats()

        // Alerta se muitos erros recentes
        if (stats.recentErrors > 10 && Date.now() - lastAlertTime > alertCooldown) {
            console.log('🚨 ALERTA: Alto número de erros MAC recentes!')
            console.log(`   Erros recentes: ${stats.recentErrors}`)
            console.log(`   Total de JIDs afetados: ${stats.totalJIDs}`)

            lastAlertTime = Date.now()
        }
    }, 30000) // Verifica a cada 30 segundos
}

// Exemplo de teste da funcionalidade
function testMACErrorHandling() {
    console.log('🧪 Testando funcionalidade de erros MAC...')

    // Simular erro MAC
    const testJID = '5521987908324@s.whatsapp.net'
    const testError = new Error('Bad MAC')

    console.log('1. Verificando se é erro MAC:', macErrorManager.isMACError(testError))

    // Registrar erro
    macErrorManager.recordMACError(testJID, testError)

    console.log('2. Pode tentar recuperar:', macErrorManager.shouldAttemptRecovery(testJID))
    console.log('3. Recomendações:', macErrorManager.getRecoveryRecommendations(testJID))

    // Estatísticas
    const stats = macErrorManager.getErrorStats(testJID)
    console.log('4. Estatísticas do JID:', stats)

    // Limpar para teste
    macErrorManager.clearErrorHistory(testJID)
    console.log('5. Histórico limpo')
}

// Inicialização
function main() {
    startMACMonitoring()
    setupPeriodicCleanup()
    setupAlerts()

    // Executar teste após 5 segundos
    setTimeout(testMACErrorHandling, 5000)

    console.log('💬 Use as funções exportadas para monitoramento')
    console.log('🧪 Testando funcionalidade após 5 segundos...')

    return {
        getMACErrorReport,
        testMACErrorHandling,
        setupPeriodicCleanup,
        setupAlerts
    }
}

export { getMACErrorReport, setupPeriodicCleanup, setupAlerts, testMACErrorHandling }

// Executar se for arquivo principal
if (require.main === module) {
    main()
}
