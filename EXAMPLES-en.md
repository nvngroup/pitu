# 🎯 Pitu - Practical Examples

This document contains practical examples and real-world use cases for Pitu.

## 📱 Advanced Customer Service Bot

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
    stage: 'menu' | 'waiting_name' | 'waiting_email' | 'finished'
    data: {
        name?: string
        email?: string
        phone?: string
    }
}

class CustomerServiceBot {
    private sock: any
    private store: any
    private userSessions: Map<string, UserSession> = new Map()

    constructor() {
        this.initializeBot()
    }

    private async initializeBot() {
        // Configure authentication
        const { state, saveCreds } = await useMultiFileAuthState('auth_customer_service')

        // Create socket
        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'info' }),
            browser: ['CustomerServiceBot', 'Chrome', '3.0'],
            markOnlineOnConnect: false
        })

        // Connect store
        this.store.bind(this.sock.ev)

        // Event handlers
        this.sock.ev.on('creds.update', saveCreds)
        this.sock.ev.on('connection.update', this.handleConnection.bind(this))
        this.sock.ev.on('messages.upsert', this.handleMessages.bind(this))

        console.log('🤖 Customer service bot started!')
    }

    private handleConnection(update: any) {
        const { connection, lastDisconnect } = update

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut

            if (shouldReconnect) {
                console.log('🔄 Reconnecting...')
                this.initializeBot()
            } else {
                console.log('🚪 Permanently disconnected')
            }
        } else if (connection === 'open') {
            console.log('✅ Connected successfully!')
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
                case 'waiting_name':
                    await this.handleNameStage(jid, text, session)
                    break
                case 'waiting_email':
                    await this.handleEmailStage(jid, text, session)
                    break
                default:
                    await this.sendMainMenu(jid)
            }
        } catch (error) {
            console.error('Error processing message:', error)
            await this.sock.sendMessage(jid, {
                text: '❌ An error occurred. Please try again or type "menu" to return to the main menu.'
            })
        }
    }

    private async handleMenuStage(jid: string, text: string) {
        const command = text.toLowerCase().trim()

        switch (command) {
            case 'hi':
            case 'hello':
            case 'hey':
            case 'menu':
                await this.sendMainMenu(jid)
                break

            case '1':
            case 'register':
            case 'signup':
                await this.startRegistration(jid)
                break

            case '2':
            case 'support':
                await this.sendSupportInfo(jid)
                break

            case '3':
            case 'hours':
            case 'schedule':
                await this.sendHoursInfo(jid)
                break

            case '4':
            case 'contact':
                await this.sendContactInfo(jid)
                break

            default:
                await this.sendMainMenu(jid, '🤔 I didn\'t understand. Let\'s start with the main menu:')
        }
    }

    private async sendMainMenu(jid: string, prefixMessage?: string) {
        const message = `${prefixMessage || '👋 Hello! Welcome to our customer service!'}\n\n` +
                      '🎯 *How can I help you today?*\n\n' +
                      '1️⃣ Register/Sign up\n' +
                      '2️⃣ Technical support\n' +
                      '3️⃣ Business hours\n' +
                      '4️⃣ Contact information\n\n' +
                      '📝 Type the *number* of the option or the *keyword*'

        await this.sock.sendMessage(jid, { text: message })

        // Alternative with interactive list
        await this.sock.sendMessage(jid, {
            listMessage: {
                title: 'Customer Service Menu',
                text: 'Choose one of the options below:',
                footerText: 'Automated customer service • NVN Group',
                buttonText: 'View Options',
                sections: [{
                    title: 'Available Services',
                    rows: [
                        {
                            title: '📝 Register/Sign Up',
                            rowId: 'register',
                            description: 'Register in our system'
                        },
                        {
                            title: '🛠️ Technical Support',
                            rowId: 'support',
                            description: 'Help with technical issues'
                        },
                        {
                            title: '🕐 Business Hours',
                            rowId: 'hours',
                            description: 'See our service hours'
                        },
                        {
                            title: '📞 Contact Information',
                            rowId: 'contact',
                            description: 'Our communication channels'
                        }
                    ]
                }]
            }
        })
    }

    private async startRegistration(jid: string) {
        const session: UserSession = { stage: 'waiting_name', data: {} }
        this.userSessions.set(jid, session)

        await this.sock.sendMessage(jid, {
            text: '📝 *Let\'s register you!*\n\n' +
                  'To start, please tell me your *full name*:\n\n' +
                  '💡 _You can cancel at any time by typing "cancel"_'
        })
    }

    private async handleNameStage(jid: string, text: string, session: UserSession) {
        if (text.toLowerCase() === 'cancel') {
            this.userSessions.delete(jid)
            await this.sendMainMenu(jid, '❌ Registration canceled.')
            return
        }

        if (text.trim().length < 2) {
            await this.sock.sendMessage(jid, {
                text: '❌ Name too short. Please enter your full name:'
            })
            return
        }

        session.data.name = text.trim()
        session.stage = 'waiting_email'
        this.userSessions.set(jid, session)

        await this.sock.sendMessage(jid, {
            text: `✅ Hello, *${session.data.name}*!\n\n` +
                  'Now I need your *email*:\n\n' +
                  '📧 Enter a valid email for contact'
        })
    }

    private async handleEmailStage(jid: string, text: string, session: UserSession) {
        if (text.toLowerCase() === 'cancel') {
            this.userSessions.delete(jid)
            await this.sendMainMenu(jid, '❌ Registration canceled.')
            return
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(text.trim())) {
            await this.sock.sendMessage(jid, {
                text: '❌ Invalid email. Please enter a valid email:\n\n' +
                      '📧 Example: youremail@domain.com'
            })
            return
        }

        session.data.email = text.trim()
        session.data.phone = jid.split('@')[0]
        session.stage = 'finished'

        // Save data (here you would save to your database)
        await this.saveRegistration(session.data)

        // Send confirmation
        await this.sock.sendMessage(jid, {
            text: '🎉 *Registration completed successfully!*\n\n' +
                  `👤 *Name:* ${session.data.name}\n` +
                  `📧 *Email:* ${session.data.email}\n` +
                  `📱 *Phone:* ${session.data.phone}\n\n` +
                  '✅ You will receive our news and updates!\n\n' +
                  '_Type "menu" to return to the main menu_'
        })

        this.userSessions.delete(jid)
    }

    private async saveRegistration(data: any) {
        // Here you would save the data to your database
        console.log('💾 Saving registration:', data)

        // Example: save to JSON file (for demonstration)
        const registrations = this.loadRegistrations()
        registrations.push({
            ...data,
            dateTime: new Date().toISOString(),
            id: Date.now()
        })

        fs.writeFileSync('./registrations.json', JSON.stringify(registrations, null, 2))
    }

    private loadRegistrations(): any[] {
        try {
            if (fs.existsSync('./registrations.json')) {
                return JSON.parse(fs.readFileSync('./registrations.json', 'utf8'))
            }
        } catch (error) {
            console.error('Error loading registrations:', error)
        }
        return []
    }

    private async sendSupportInfo(jid: string) {
        await this.sock.sendMessage(jid, {
            text: '🛠️ *Technical Support*\n\n' +
                  '📋 For more efficient service, please provide:\n\n' +
                  '• Detailed problem description\n' +
                  '• Screenshots (if applicable)\n' +
                  '• Device model\n' +
                  '• Operating system\n\n' +
                  '⏰ *Average response time:* 2-4 hours\n\n' +
                  '📞 *Urgent support:* (11) 99999-9999\n' +
                  '📧 *Email:* support@nvngroup.com.br\n\n' +
                  '_Type "menu" to return to the main menu_'
        })
    }

    private async sendHoursInfo(jid: string) {
        await this.sock.sendMessage(jid, {
            text: '🕐 *Business Hours*\n\n' +
                  '📅 **Monday to Friday**\n' +
                  '⏰ 08:00 AM to 06:00 PM\n\n' +
                  '📅 **Saturdays**\n' +
                  '⏰ 08:00 AM to 12:00 PM\n\n' +
                  '📅 **Sundays and Holidays**\n' +
                  '⏰ Closed\n\n' +
                  '🤖 *This automated service works 24/7*\n\n' +
                  '⚡ *Human responses only during business hours*\n\n' +
                  '_Type "menu" to return to the main menu_'
        })
    }

    private async sendContactInfo(jid: string) {
        // Send contact information
        await this.sock.sendMessage(jid, {
            text: '📞 *Contact Information*\n\n' +
                  '🏢 **NVN Group**\n\n' +
                  '📱 *WhatsApp:* (11) 99999-9999\n' +
                  '📧 *Email:* contact@nvngroup.com.br\n' +
                  '🌐 *Website:* www.nvngroup.com.br\n\n' +
                  '📍 *Address:*\n' +
                  'Example Street, 123\n' +
                  'Downtown - São Paulo/SP\n' +
                  'ZIP: 01000-000\n\n' +
                  '_Type "menu" to return to the main menu_'
        })

        // Send location
        await this.sock.sendMessage(jid, {
            location: {
                degreesLatitude: -23.5505,
                degreesLongitude: -46.6333,
                name: 'NVN Group',
                address: 'Example Street, 123 - Downtown, São Paulo/SP'
            }
        })

        // Send contact card
        const vcard = 'BEGIN:VCARD\n' +
                     'VERSION:3.0\n' +
                     'FN:NVN Group - Customer Service\n' +
                     'ORG:NVN Group;\n' +
                     'TEL;type=CELL;type=VOICE;waid=5511999999999:+55 11 99999-9999\n' +
                     'EMAIL:contact@nvngroup.com.br\n' +
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

// Start the bot
new CustomerServiceBot()
```

## 📊 Analytics and Reports System

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

        // Generate daily report
        setInterval(() => {
            this.generateDailyReport()
        }, 24 * 60 * 60 * 1000) // 24 hours
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
            console.error('Error loading analytics:', error)
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

        // Save report
        fs.writeFileSync(
            `./reports/report-${report.date}.json`,
            JSON.stringify(report, null, 2)
        )

        console.log('📊 Daily report generated:', report)
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

    // Command to view statistics
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
            text: `📊 *Statistics for the last 7 days*\n\n` +
                  `💬 Total messages: ${stats.totalMessages}\n` +
                  `👥 Unique users: ${stats.uniqueUsers}\n` +
                  `📈 Daily average: ${stats.avgMessagesPerDay} messages`
        })
    }
}
```

## 🎮 Interactive Quiz Bot

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
            question: "What is the capital of Brazil?",
            options: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador"],
            correct: 2,
            explanation: "Brasília has been the federal capital of Brazil since 1960."
        },
        {
            question: "What is 2 + 2?",
            options: ["3", "4", "5", "6"],
            correct: 1,
            explanation: "2 + 2 = 4. Basic math!"
        }
        // Add more questions here
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
            text: "🎮 *Quiz Started!*\n\n" +
                  `📊 Total questions: ${this.questions.length}\n` +
                  "🎯 Answer with the option number (1, 2, 3, 4)\n\n" +
                  "Let's begin! 🚀"
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
            text: `❓ *Question ${userQuiz.currentQuestion + 1}/${this.questions.length}*\n\n` +
                  `${question.question}\n\n` +
                  `${optionsText}\n\n` +
                  "💡 Type the number of your answer:"
        })
    }

    private async handleQuizAnswer(jid: string, answer: string) {
        const userQuiz = this.userQuizzes.get(jid)!
        const question = this.questions[userQuiz.currentQuestion]
        const answerNum = parseInt(answer.trim()) - 1

        if (isNaN(answerNum) || answerNum < 0 || answerNum >= question.options.length) {
            await this.sock.sendMessage(jid, {
                text: "❌ Invalid answer! Type a number from 1 to 4."
            })
            return
        }

        userQuiz.answers.push(answerNum)

        let responseText = ""
        if (answerNum === question.correct) {
            userQuiz.score++
            responseText = "✅ *Correct!*"
        } else {
            responseText = `❌ *Incorrect!*\n\n🎯 Correct answer: ${question.options[question.correct]}`
        }

        if (question.explanation) {
            responseText += `\n\n💡 *Explanation:* ${question.explanation}`
        }

        await this.sock.sendMessage(jid, { text: responseText })

        // Next question or finish
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
            performanceText = "Excellent!"
        } else if (percentage >= 60) {
            performanceEmoji = "🥈"
            performanceText = "Good job!"
        } else if (percentage >= 40) {
            performanceEmoji = "🥉"
            performanceText = "Can improve!"
        } else {
            performanceEmoji = "📚"
            performanceText = "Need to study more!"
        }

        await this.sock.sendMessage(jid, {
            text: `🎉 *Quiz Finished!*\n\n` +
                  `${performanceEmoji} ${performanceText}\n\n` +
                  `📊 *Your result:*\n` +
                  `✅ Correct answers: ${userQuiz.score}/${this.questions.length}\n` +
                  `📈 Percentage: ${percentage}%\n\n` +
                  `Type /quiz to play again! 🔄`
        })

        this.userQuizzes.delete(jid)
    }
}
```

## 🔔 Reminder System

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

                if (text.startsWith('/remind ')) {
                    await this.handleReminderCommand(jid, text)
                } else if (text === '/reminders') {
                    await this.listReminders(jid)
                }
            }
        })
    }

    private async handleReminderCommand(jid: string, text: string) {
        // Format: /remind 12/15/2023 14:30 Important meeting
        const parts = text.split(' ')

        if (parts.length < 4) {
            await this.sock.sendMessage(jid, {
                text: "❌ Incorrect format!\n\n" +
                      "✅ *Correct format:*\n" +
                      "`/remind MM/DD/YYYY HH:MM Message`\n\n" +
                      "📝 *Example:*\n" +
                      "`/remind 12/25/2023 09:00 Merry Christmas!`"
            })
            return
        }

        const dateStr = parts[1]
        const timeStr = parts[2]
        const message = parts.slice(3).join(' ')

        try {
            const [month, day, year] = dateStr.split('/').map(Number)
            const [hours, minutes] = timeStr.split(':').map(Number)

            const datetime = new Date(year, month - 1, day, hours, minutes)

            if (datetime < new Date()) {
                await this.sock.sendMessage(jid, {
                    text: "❌ The date must be in the future!"
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
                text: `✅ *Reminder created!*\n\n` +
                      `📅 *Date:* ${datetime.toLocaleDateString('en-US')}\n` +
                      `🕐 *Time:* ${datetime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}\n` +
                      `💬 *Message:* ${message}\n\n` +
                      `🆔 *ID:* ${reminder.id}`
            })

        } catch (error) {
            await this.sock.sendMessage(jid, {
                text: "❌ Invalid date or time!\n\n" +
                      "📅 Use the format: MM/DD/YYYY HH:MM"
            })
        }
    }

    private async listReminders(jid: string) {
        const userReminders = this.reminders
            .filter(r => r.userId === jid && !r.sent)
            .sort((a, b) => a.datetime.getTime() - b.datetime.getTime())

        if (userReminders.length === 0) {
            await this.sock.sendMessage(jid, {
                text: "📭 You have no pending reminders.\n\n" +
                      "💡 Use `/remind MM/DD/YYYY HH:MM Message` to create one!"
            })
            return
        }

        let listText = "📋 *Your pending reminders:*\n\n"

        userReminders.forEach((reminder, index) => {
            const dateStr = reminder.datetime.toLocaleDateString('en-US')
            const timeStr = reminder.datetime.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            })

            listText += `${index + 1}️⃣ *${reminder.message}*\n` +
                       `📅 ${dateStr} at ${timeStr}\n` +
                       `🆔 ID: ${reminder.id}\n\n`
        })

        await this.sock.sendMessage(jid, { text: listText })
    }

    private startReminderChecker() {
        setInterval(() => {
            this.checkReminders()
        }, 60000) // Check every minute
    }

    private async checkReminders() {
        const now = new Date()

        for (const reminder of this.reminders) {
            if (!reminder.sent && reminder.datetime <= now) {
                try {
                    await this.sock.sendMessage(reminder.userId, {
                        text: `⏰ *REMINDER!*\n\n` +
                              `💬 ${reminder.message}\n\n` +
                              `🕐 Scheduled for: ${reminder.datetime.toLocaleString('en-US')}`
                    })

                    reminder.sent = true
                    console.log(`📨 Reminder sent to ${reminder.userId}`)
                } catch (error) {
                    console.error('Error sending reminder:', error)
                }
            }
        }

        // Remove old reminders (older than 7 days)
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
            console.error('Error loading reminders:', error)
        }
    }

    private saveReminders() {
        fs.writeFileSync('./reminders.json', JSON.stringify(this.reminders, null, 2))
    }
}
```

## 🎯 How to Use the Examples

### 1. Environment Setup

```bash
# Install dependencies
npm install @nvngroup/pitu @hapi/boom pino node-cache

# Create folder structure
mkdir customer-service-bot
cd customer-service-bot
mkdir downloads reports auth_customer_service
```

### 2. Main File (index.ts)

```typescript
import { CustomerServiceBot } from './customer-service-bot'
import { AnalyticsBot } from './analytics-bot'
import { QuizBot } from './quiz-bot'
import { ReminderBot } from './reminder-bot'

async function main() {
    console.log('🚀 Starting bot system...')

    // Choose which bot to use or combine multiple
    new CustomerServiceBot()

    console.log('✅ Bots started successfully!')
}

main().catch(console.error)
```

### 3. Run

```bash
npx ts-node index.ts
```

### 4. Customization

- **Modify messages** for your brand
- **Add new commands** as needed
- **Integrate with external APIs** (CRM, database)
- **Implement authentication** for administrative commands

---

**💡 Tip**: Combine different functionalities to create a complete and professional bot!
