# 🎯 Pitu - Exemplos Práticos

Este documento contém exemplos práticos e casos de uso reais para o Pitu.

## 📱 Bot de Atendimento Avançado

```typescript
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    downloadMediaMessage
} from '@nvngroup/pitu'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import fs from 'fs'

interface UserSession {
    stage: 'menu' | 'aguardando_nome' | 'aguardando_email' | 'finalizado'
    data: {
        nome?: string
        email?: string
        telefone?: string
    }
}

class AtendimentoBot {
    private sock: any
    private store: any
    private userSessions: Map<string, UserSession> = new Map()

    constructor() {
        this.initializeBot()
    }

    private async initializeBot() {
        // Configurar autenticação
        const { state, saveCreds } = await useMultiFileAuthState('auth_atendimento')

        // Criar socket
        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'info' }),
            browser: ['AtendimentoBot', 'Chrome', '3.0'],
            markOnlineOnConnect: false
        })

        // Conectar store
        this.store.bind(this.sock.ev)

        // Event handlers
        this.sock.ev.on('creds.update', saveCreds)
        this.sock.ev.on('connection.update', this.handleConnection.bind(this))
        this.sock.ev.on('messages.upsert', this.handleMessages.bind(this))

        console.log('🤖 Bot de atendimento iniciado!')
    }

    private handleConnection(update: any) {
        const { connection, lastDisconnect } = update

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut

            if (shouldReconnect) {
                console.log('🔄 Reconectando...')
                this.initializeBot()
            } else {
                console.log('🚪 Desconectado permanentemente')
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado com sucesso!')
        }
    }

    private async handleMessages({ messages }: any) {
        for (const msg of messages) {
            if (msg.key.fromMe || !msg.message) continue

            const jid = msg.key.remoteJid!
            const text = this.extractTextFromMessage(msg.message)

            await this.processUserMessage(jid, text, msg)
        }
    }

    private extractTextFromMessage(message: any): string {
        return message.conversation ||
               message.extendedTextMessage?.text ||
               message.listResponseMessage?.singleSelectReply?.selectedRowId ||
               ''
    }

    private async processUserMessage(jid: string, text: string, msg: any) {
        const session = this.userSessions.get(jid) || { stage: 'menu', data: {} }

        try {
            switch (session.stage) {
                case 'menu':
                    await this.handleMenuStage(jid, text)
                    break
                case 'aguardando_nome':
                    await this.handleNomeStage(jid, text, session)
                    break
                case 'aguardando_email':
                    await this.handleEmailStage(jid, text, session)
                    break
                default:
                    await this.sendMainMenu(jid)
            }
        } catch (error) {
            console.error('Erro ao processar mensagem:', error)
            await this.sock.sendMessage(jid, {
                text: '❌ Ocorreu um erro. Tente novamente ou digite "menu" para voltar ao início.'
            })
        }
    }

    private async handleMenuStage(jid: string, text: string) {
        const command = text.toLowerCase().trim()

        switch (command) {
            case 'oi':
            case 'olá':
            case 'hello':
            case 'menu':
                await this.sendMainMenu(jid)
                break

            case '1':
            case 'cadastro':
                await this.startCadastro(jid)
                break

            case '2':
            case 'suporte':
                await this.sendSuporteInfo(jid)
                break

            case '3':
            case 'horario':
                await this.sendHorarioInfo(jid)
                break

            case '4':
            case 'contato':
                await this.sendContatoInfo(jid)
                break

            default:
                await this.sendMainMenu(jid, '🤔 Não entendi. Vamos começar pelo menu principal:')
        }
    }

    private async sendMainMenu(jid: string, prefixMessage?: string) {
        const message = `${prefixMessage || '👋 Olá! Bem-vindo ao nosso atendimento!'}\n\n` +
                      '🎯 *Como posso ajudar você hoje?*\n\n' +
                      '1️⃣ Fazer cadastro\n' +
                      '2️⃣ Suporte técnico\n' +
                      '3️⃣ Horário de funcionamento\n' +
                      '4️⃣ Informações de contato\n\n' +
                      '📝 Digite o *número* da opção ou a *palavra-chave*'

        await this.sock.sendMessage(jid, { text: message })

        // Alternativa com lista interativa
        await this.sock.sendMessage(jid, {
            listMessage: {
                title: 'Menu de Atendimento',
                text: 'Escolha uma das opções abaixo:',
                footerText: 'Atendimento automatizado • NVN Group',
                buttonText: 'Ver Opções',
                sections: [{
                    title: 'Serviços Disponíveis',
                    rows: [
                        {
                            title: '📝 Fazer Cadastro',
                            rowId: 'cadastro',
                            description: 'Cadastre-se em nosso sistema'
                        },
                        {
                            title: '🛠️ Suporte Técnico',
                            rowId: 'suporte',
                            description: 'Ajuda com problemas técnicos'
                        },
                        {
                            title: '🕐 Horário de Funcionamento',
                            rowId: 'horario',
                            description: 'Veja nossos horários de atendimento'
                        },
                        {
                            title: '📞 Informações de Contato',
                            rowId: 'contato',
                            description: 'Nossos canais de comunicação'
                        }
                    ]
                }]
            }
        })
    }

    private async startCadastro(jid: string) {
        const session: UserSession = { stage: 'aguardando_nome', data: {} }
        this.userSessions.set(jid, session)

        await this.sock.sendMessage(jid, {
            text: '📝 *Vamos fazer seu cadastro!*\n\n' +
                  'Para começar, me informe seu *nome completo*:\n\n' +
                  '💡 _Você pode cancelar a qualquer momento digitando "cancelar"_'
        })
    }

    private async handleNomeStage(jid: string, text: string, session: UserSession) {
        if (text.toLowerCase() === 'cancelar') {
            this.userSessions.delete(jid)
            await this.sendMainMenu(jid, '❌ Cadastro cancelado.')
            return
        }

        if (text.trim().length < 2) {
            await this.sock.sendMessage(jid, {
                text: '❌ Nome muito curto. Por favor, digite seu nome completo:'
            })
            return
        }

        session.data.nome = text.trim()
        session.stage = 'aguardando_email'
        this.userSessions.set(jid, session)

        await this.sock.sendMessage(jid, {
            text: `✅ Olá, *${session.data.nome}*!\n\n` +
                  'Agora preciso do seu *e-mail*:\n\n' +
                  '📧 Digite um e-mail válido para contato'
        })
    }

    private async handleEmailStage(jid: string, text: string, session: UserSession) {
        if (text.toLowerCase() === 'cancelar') {
            this.userSessions.delete(jid)
            await this.sendMainMenu(jid, '❌ Cadastro cancelado.')
            return
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(text.trim())) {
            await this.sock.sendMessage(jid, {
                text: '❌ E-mail inválido. Por favor, digite um e-mail válido:\n\n' +
                      '📧 Exemplo: seuemail@dominio.com'
            })
            return
        }

        session.data.email = text.trim()
        session.data.telefone = jid.split('@')[0]
        session.stage = 'finalizado'

        // Salvar dados (aqui você salvaria no seu banco de dados)
        await this.salvarCadastro(session.data)

        // Enviar confirmação
        await this.sock.sendMessage(jid, {
            text: '🎉 *Cadastro realizado com sucesso!*\n\n' +
                  `👤 *Nome:* ${session.data.nome}\n` +
                  `📧 *E-mail:* ${session.data.email}\n` +
                  `📱 *Telefone:* ${session.data.telefone}\n\n` +
                  '✅ Você receberá nossas novidades e atualizações!\n\n' +
                  '_Digite "menu" para voltar ao menu principal_'
        })

        this.userSessions.delete(jid)
    }

    private async salvarCadastro(data: any) {
        // Aqui você salvaria os dados no seu banco de dados
        console.log('💾 Salvando cadastro:', data)

        // Exemplo: salvar em arquivo JSON (para demonstração)
        const cadastros = this.loadCadastros()
        cadastros.push({
            ...data,
            dataHora: new Date().toISOString(),
            id: Date.now()
        })

        fs.writeFileSync('./cadastros.json', JSON.stringify(cadastros, null, 2))
    }

    private loadCadastros(): any[] {
        try {
            if (fs.existsSync('./cadastros.json')) {
                return JSON.parse(fs.readFileSync('./cadastros.json', 'utf8'))
            }
        } catch (error) {
            console.error('Erro ao carregar cadastros:', error)
        }
        return []
    }

    private async sendSuporteInfo(jid: string) {
        await this.sock.sendMessage(jid, {
            text: '🛠️ *Suporte Técnico*\n\n' +
                  '📋 Para um atendimento mais eficiente, nos informe:\n\n' +
                  '• Descrição detalhada do problema\n' +
                  '• Capturas de tela (se aplicável)\n' +
                  '• Modelo do dispositivo\n' +
                  '• Sistema operacional\n\n' +
                  '⏰ *Tempo médio de resposta:* 2-4 horas\n\n' +
                  '📞 *Suporte urgente:* (11) 99999-9999\n' +
                  '📧 *E-mail:* suporte@nvngroup.com.br\n\n' +
                  '_Digite "menu" para voltar ao menu principal_'
        })
    }

    private async sendHorarioInfo(jid: string) {
        await this.sock.sendMessage(jid, {
            text: '🕐 *Horário de Funcionamento*\n\n' +
                  '📅 **Segunda a Sexta-feira**\n' +
                  '⏰ 08:00 às 18:00\n\n' +
                  '📅 **Sábados**\n' +
                  '⏰ 08:00 às 12:00\n\n' +
                  '📅 **Domingos e Feriados**\n' +
                  '⏰ Fechado\n\n' +
                  '🤖 *Este atendimento automatizado funciona 24/7*\n\n' +
                  '⚡ *Respostas humanas apenas no horário comercial*\n\n' +
                  '_Digite "menu" para voltar ao menu principal_'
        })
    }

    private async sendContatoInfo(jid: string) {
        // Enviar informações de contato
        await this.sock.sendMessage(jid, {
            text: '📞 *Informações de Contato*\n\n' +
                  '🏢 **NVN Group**\n\n' +
                  '📱 *WhatsApp:* (11) 99999-9999\n' +
                  '📧 *E-mail:* contato@nvngroup.com.br\n' +
                  '🌐 *Site:* www.nvngroup.com.br\n\n' +
                  '📍 *Endereço:*\n' +
                  'Rua Exemplo, 123\n' +
                  'Centro - São Paulo/SP\n' +
                  'CEP: 01000-000\n\n' +
                  '_Digite "menu" para voltar ao menu principal_'
        })

        // Enviar localização
        await this.sock.sendMessage(jid, {
            location: {
                degreesLatitude: -23.5505,
                degreesLongitude: -46.6333,
                name: 'NVN Group',
                address: 'Rua Exemplo, 123 - Centro, São Paulo/SP'
            }
        })

        // Enviar cartão de contato
        const vcard = 'BEGIN:VCARD\n' +
                     'VERSION:3.0\n' +
                     'FN:NVN Group - Atendimento\n' +
                     'ORG:NVN Group;\n' +
                     'TEL;type=CELL;type=VOICE;waid=5511999999999:+55 11 99999-9999\n' +
                     'EMAIL:contato@nvngroup.com.br\n' +
                     'URL:https://www.nvngroup.com.br\n' +
                     'END:VCARD'

        await this.sock.sendMessage(jid, {
            contacts: {
                displayName: 'NVN Group',
                contacts: [{ vcard }]
            }
        })
    }
}

// Iniciar o bot
new AtendimentoBot()
```

## 📊 Sistema de Analytics e Relatórios

```typescript
import fs from 'fs'

interface MessageAnalytics {
    userId: string
    timestamp: Date
    messageType: string
    responseTime?: number
    satisfied?: boolean
}

class AnalyticsBot {
    private analytics: MessageAnalytics[] = []

    constructor(private sock: any) {
        this.loadAnalytics()
        this.setupEventHandlers()

        // Gerar relatório diário
        setInterval(() => {
            this.generateDailyReport()
        }, 24 * 60 * 60 * 1000) // 24 horas
    }

    private setupEventHandlers() {
        this.sock.ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                if (msg.key.fromMe || !msg.message) continue

                this.trackMessage({
                    userId: msg.key.remoteJid!,
                    timestamp: new Date(msg.messageTimestamp! * 1000),
                    messageType: Object.keys(msg.message)[0]
                })
            }
        })
    }

    private trackMessage(data: Omit<MessageAnalytics, 'responseTime' | 'satisfied'>) {
        this.analytics.push(data as MessageAnalytics)
        this.saveAnalytics()
    }

    private loadAnalytics() {
        try {
            if (fs.existsSync('./analytics.json')) {
                const data = JSON.parse(fs.readFileSync('./analytics.json', 'utf8'))
                this.analytics = data.map((item: any) => ({
                    ...item,
                    timestamp: new Date(item.timestamp)
                }))
            }
        } catch (error) {
            console.error('Erro ao carregar analytics:', error)
        }
    }

    private saveAnalytics() {
        fs.writeFileSync('./analytics.json', JSON.stringify(this.analytics, null, 2))
    }

    private generateDailyReport() {
        const today = new Date()
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

        const todayMessages = this.analytics.filter(msg =>
            msg.timestamp >= yesterday && msg.timestamp < today
        )

        const report = {
            date: today.toISOString().split('T')[0],
            totalMessages: todayMessages.length,
            uniqueUsers: new Set(todayMessages.map(msg => msg.userId)).size,
            messageTypes: this.groupByMessageType(todayMessages),
            hourlyDistribution: this.getHourlyDistribution(todayMessages)
        }

        // Salvar relatório
        fs.writeFileSync(
            `./reports/report-${report.date}.json`,
            JSON.stringify(report, null, 2)
        )

        console.log('📊 Relatório diário gerado:', report)
    }

    private groupByMessageType(messages: MessageAnalytics[]) {
        const types: { [key: string]: number } = {}
        messages.forEach(msg => {
            types[msg.messageType] = (types[msg.messageType] || 0) + 1
        })
        return types
    }

    private getHourlyDistribution(messages: MessageAnalytics[]) {
        const hours: { [key: number]: number } = {}
        messages.forEach(msg => {
            const hour = msg.timestamp.getHours()
            hours[hour] = (hours[hour] || 0) + 1
        })
        return hours
    }

    // Comando para ver estatísticas
    async handleStatsCommand(jid: string) {
        const last7Days = this.analytics.filter(msg =>
            msg.timestamp >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        )

        const stats = {
            totalMessages: last7Days.length,
            uniqueUsers: new Set(last7Days.map(msg => msg.userId)).size,
            avgMessagesPerDay: Math.round(last7Days.length / 7)
        }

        await this.sock.sendMessage(jid, {
            text: `📊 *Estatísticas dos últimos 7 dias*\n\n` +
                  `💬 Total de mensagens: ${stats.totalMessages}\n` +
                  `👥 Usuários únicos: ${stats.uniqueUsers}\n` +
                  `📈 Média por dia: ${stats.avgMessagesPerDay} mensagens`
        })
    }
}
```

## 🎮 Bot de Quiz Interativo

```typescript
interface QuizQuestion {
    question: string
    options: string[]
    correct: number
    explanation?: string
}

class QuizBot {
    private questions: QuizQuestion[] = [
        {
            question: "Qual é a capital do Brasil?",
            options: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador"],
            correct: 2,
            explanation: "Brasília é a capital federal do Brasil desde 1960."
        },
        {
            question: "Quanto é 2 + 2?",
            options: ["3", "4", "5", "6"],
            correct: 1,
            explanation: "2 + 2 = 4. Matemática básica!"
        }
        // Adicione mais perguntas aqui
    ]

    private userQuizzes: Map<string, {
        currentQuestion: number
        score: number
        answers: number[]
    }> = new Map()

    constructor(private sock: any) {
        this.setupEventHandlers()
    }

    private setupEventHandlers() {
        this.sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const msg of messages) {
                if (msg.key.fromMe || !msg.message) continue

                const text = msg.message.conversation ||
                           msg.message.extendedTextMessage?.text || ''
                const jid = msg.key.remoteJid!

                if (text.toLowerCase() === '/quiz') {
                    await this.startQuiz(jid)
                } else if (this.userQuizzes.has(jid)) {
                    await this.handleQuizAnswer(jid, text)
                }
            }
        })
    }

    private async startQuiz(jid: string) {
        this.userQuizzes.set(jid, {
            currentQuestion: 0,
            score: 0,
            answers: []
        })

        await this.sock.sendMessage(jid, {
            text: "🎮 *Quiz Iniciado!*\n\n" +
                  `📊 Total de perguntas: ${this.questions.length}\n` +
                  "🎯 Responda com o número da opção (1, 2, 3, 4)\n\n" +
                  "Vamos começar! 🚀"
        })

        await this.sendQuestion(jid)
    }

    private async sendQuestion(jid: string) {
        const userQuiz = this.userQuizzes.get(jid)!
        const question = this.questions[userQuiz.currentQuestion]

        const optionsText = question.options
            .map((option, index) => `${index + 1}️⃣ ${option}`)
            .join('\n')

        await this.sock.sendMessage(jid, {
            text: `❓ *Pergunta ${userQuiz.currentQuestion + 1}/${this.questions.length}*\n\n` +
                  `${question.question}\n\n` +
                  `${optionsText}\n\n` +
                  "💡 Digite o número da sua resposta:"
        })
    }

    private async handleQuizAnswer(jid: string, answer: string) {
        const userQuiz = this.userQuizzes.get(jid)!
        const question = this.questions[userQuiz.currentQuestion]
        const answerNum = parseInt(answer.trim()) - 1

        if (isNaN(answerNum) || answerNum < 0 || answerNum >= question.options.length) {
            await this.sock.sendMessage(jid, {
                text: "❌ Resposta inválida! Digite um número de 1 a 4."
            })
            return
        }

        userQuiz.answers.push(answerNum)

        let responseText = ""
        if (answerNum === question.correct) {
            userQuiz.score++
            responseText = "✅ *Correto!*"
        } else {
            responseText = `❌ *Incorreto!*\n\n🎯 Resposta correta: ${question.options[question.correct]}`
        }

        if (question.explanation) {
            responseText += `\n\n💡 *Explicação:* ${question.explanation}`
        }

        await this.sock.sendMessage(jid, { text: responseText })

        // Próxima pergunta ou finalizar
        userQuiz.currentQuestion++

        if (userQuiz.currentQuestion < this.questions.length) {
            setTimeout(() => this.sendQuestion(jid), 2000)
        } else {
            await this.finishQuiz(jid)
        }
    }

    private async finishQuiz(jid: string) {
        const userQuiz = this.userQuizzes.get(jid)!
        const percentage = Math.round((userQuiz.score / this.questions.length) * 100)

        let performanceEmoji = ""
        let performanceText = ""

        if (percentage >= 80) {
            performanceEmoji = "🏆"
            performanceText = "Excelente!"
        } else if (percentage >= 60) {
            performanceEmoji = "🥈"
            performanceText = "Bom trabalho!"
        } else if (percentage >= 40) {
            performanceEmoji = "🥉"
            performanceText = "Pode melhorar!"
        } else {
            performanceEmoji = "📚"
            performanceText = "Precisa estudar mais!"
        }

        await this.sock.sendMessage(jid, {
            text: `🎉 *Quiz Finalizado!*\n\n` +
                  `${performanceEmoji} ${performanceText}\n\n` +
                  `📊 *Seu resultado:*\n` +
                  `✅ Acertos: ${userQuiz.score}/${this.questions.length}\n` +
                  `📈 Porcentagem: ${percentage}%\n\n` +
                  `Digite /quiz para jogar novamente! 🔄`
        })

        this.userQuizzes.delete(jid)
    }
}
```

## 🔔 Sistema de Lembretes

```typescript
interface Reminder {
    id: string
    userId: string
    message: string
    datetime: Date
    sent: boolean
}

class ReminderBot {
    private reminders: Reminder[] = []

    constructor(private sock: any) {
        this.loadReminders()
        this.setupEventHandlers()
        this.startReminderChecker()
    }

    private setupEventHandlers() {
        this.sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const msg of messages) {
                if (msg.key.fromMe || !msg.message) continue

                const text = msg.message.conversation ||
                           msg.message.extendedTextMessage?.text || ''
                const jid = msg.key.remoteJid!

                if (text.startsWith('/lembrar ')) {
                    await this.handleReminderCommand(jid, text)
                } else if (text === '/lembretes') {
                    await this.listReminders(jid)
                }
            }
        })
    }

    private async handleReminderCommand(jid: string, text: string) {
        // Formato: /lembrar 15/12/2023 14:30 Reunião importante
        const parts = text.split(' ')

        if (parts.length < 4) {
            await this.sock.sendMessage(jid, {
                text: "❌ Formato incorreto!\n\n" +
                      "✅ *Formato correto:*\n" +
                      "`/lembrar DD/MM/AAAA HH:MM Mensagem`\n\n" +
                      "📝 *Exemplo:*\n" +
                      "`/lembrar 25/12/2023 09:00 Feliz Natal!`"
            })
            return
        }

        const dateStr = parts[1]
        const timeStr = parts[2]
        const message = parts.slice(3).join(' ')

        try {
            const [day, month, year] = dateStr.split('/').map(Number)
            const [hours, minutes] = timeStr.split(':').map(Number)

            const datetime = new Date(year, month - 1, day, hours, minutes)

            if (datetime < new Date()) {
                await this.sock.sendMessage(jid, {
                    text: "❌ A data deve ser no futuro!"
                })
                return
            }

            const reminder: Reminder = {
                id: Date.now().toString(),
                userId: jid,
                message,
                datetime,
                sent: false
            }

            this.reminders.push(reminder)
            this.saveReminders()

            await this.sock.sendMessage(jid, {
                text: `✅ *Lembrete criado!*\n\n` +
                      `📅 *Data:* ${datetime.toLocaleDateString('pt-BR')}\n` +
                      `🕐 *Hora:* ${datetime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}\n` +
                      `💬 *Mensagem:* ${message}\n\n` +
                      `🆔 *ID:* ${reminder.id}`
            })

        } catch (error) {
            await this.sock.sendMessage(jid, {
                text: "❌ Data ou hora inválida!\n\n" +
                      "📅 Use o formato: DD/MM/AAAA HH:MM"
            })
        }
    }

    private async listReminders(jid: string) {
        const userReminders = this.reminders
            .filter(r => r.userId === jid && !r.sent)
            .sort((a, b) => a.datetime.getTime() - b.datetime.getTime())

        if (userReminders.length === 0) {
            await this.sock.sendMessage(jid, {
                text: "📭 Você não tem lembretes pendentes.\n\n" +
                      "💡 Use `/lembrar DD/MM/AAAA HH:MM Mensagem` para criar um!"
            })
            return
        }

        let listText = "📋 *Seus lembretes pendentes:*\n\n"

        userReminders.forEach((reminder, index) => {
            const dateStr = reminder.datetime.toLocaleDateString('pt-BR')
            const timeStr = reminder.datetime.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
            })

            listText += `${index + 1}️⃣ *${reminder.message}*\n` +
                       `📅 ${dateStr} às ${timeStr}\n` +
                       `🆔 ID: ${reminder.id}\n\n`
        })

        await this.sock.sendMessage(jid, { text: listText })
    }

    private startReminderChecker() {
        setInterval(() => {
            this.checkReminders()
        }, 60000) // Verificar a cada minuto
    }

    private async checkReminders() {
        const now = new Date()

        for (const reminder of this.reminders) {
            if (!reminder.sent && reminder.datetime <= now) {
                try {
                    await this.sock.sendMessage(reminder.userId, {
                        text: `⏰ *LEMBRETE!*\n\n` +
                              `💬 ${reminder.message}\n\n` +
                              `🕐 Programado para: ${reminder.datetime.toLocaleString('pt-BR')}`
                    })

                    reminder.sent = true
                    console.log(`📨 Lembrete enviado para ${reminder.userId}`)
                } catch (error) {
                    console.error('Erro ao enviar lembrete:', error)
                }
            }
        }

        // Remover lembretes antigos (mais de 7 dias)
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        this.reminders = this.reminders.filter(r =>
            !r.sent || r.datetime > sevenDaysAgo
        )

        this.saveReminders()
    }

    private loadReminders() {
        try {
            if (fs.existsSync('./reminders.json')) {
                const data = JSON.parse(fs.readFileSync('./reminders.json', 'utf8'))
                this.reminders = data.map((r: any) => ({
                    ...r,
                    datetime: new Date(r.datetime)
                }))
            }
        } catch (error) {
            console.error('Erro ao carregar lembretes:', error)
        }
    }

    private saveReminders() {
        fs.writeFileSync('./reminders.json', JSON.stringify(this.reminders, null, 2))
    }
}
```

## 🎯 Como Usar os Exemplos

### 1. Preparação do Ambiente

```bash
# Instalar dependências
npm install @nvngroup/pitu @hapi/boom pino node-cache

# Criar estrutura de pastas
mkdir bot-atendimento
cd bot-atendimento
mkdir downloads reports auth_info
```

### 2. Arquivo Principal (index.ts)

```typescript
import { AtendimentoBot } from './atendimento-bot'
import { AnalyticsBot } from './analytics-bot'
import { QuizBot } from './quiz-bot'
import { ReminderBot } from './reminder-bot'

async function main() {
    console.log('🚀 Iniciando sistema de bots...')

    // Escolha qual bot usar ou combine vários
    new AtendimentoBot()

    console.log('✅ Bots iniciados com sucesso!')
}

main().catch(console.error)
```

### 3. Executar

```bash
npx ts-node index.ts
```

### 4. Personalização

- **Modifique as mensagens** para sua marca
- **Adicione novos comandos** conforme necessidade
- **Integre com APIs** externas (CRM, banco de dados)
- **Implemente autenticação** para comandos administrativos

---

**💡 Dica**: Combine diferentes funcionalidades para criar um bot completo e profissional!
