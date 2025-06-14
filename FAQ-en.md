# ❓ Baileys - Frequently Asked Questions (FAQ)

## 🎯 Quick Index

- [📱 Connection and Authentication](#-connection-and-authentication)
- [💬 Messages and Media](#-messages-and-media)
- [🔧 Configuration and Performance](#-configuration-and-performance)
- [🐛 Common Issues](#-common-issues)
- [🏢 Commercial Use and Limits](#-commercial-use-and-limits)
- [🛠️ Development](#️-development)

---

## 📱 Connection and Authentication

### ❓ How does the connection with WhatsApp work?

Baileys connects directly to WhatsApp Web via WebSocket, simulating a browser. You need to "pair" it with your mobile WhatsApp by scanning a QR Code or using a pairing code.

### ❓ QR Code vs Pairing Code - which one to use?

| QR Code | Pairing Code |
|---------|-------------|
| ✅ Always works | ❌ Only works once per number |
| ✅ More stable | ✅ No need to scan |
| ❌ Needs manual scanning | ❌ Less reliable |

**Recommendation**: Use QR Code for production.

### ❓ Can I use the same number on multiple bots?

❌ **No!** A WhatsApp number can only be active on one bot at a time. If you try to use it on multiple:
- Bots will disconnect each other
- May result in temporary ban
- Features may stop working

### ❓ Do I need to keep mobile WhatsApp online?

✅ **Yes**, but with exceptions:
- Mobile WhatsApp must be connected to the internet
- Doesn't need the app to be open
- If offline for too long (>14 days), the bot may disconnect

### ❓ How to save session to avoid scanning every time?

```typescript
import { useMultiFileAuthState } from '@brunocgc/baileys'

// Automatically saves to a folder
const { state, saveCreds } = await useMultiFileAuthState('my-session')

const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds) // IMPORTANT: always add this!
```

---

## 💬 Messages and Media

### ❓ How to detect if a message is for me?

```typescript
sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
        // Ignore messages that I sent
        if (msg.key.fromMe) continue

        // Ignore empty messages
        if (!msg.message) continue

        // Process only received messages
        console.log('New message to process!')
    }
})
```

### ❓ How to extract text from different message types?

```typescript
function getMessageText(message: any): string {
    return message.conversation || // Simple text message
           message.extendedTextMessage?.text || // Text with formatting/link
           message.imageMessage?.caption || // Image caption
           message.videoMessage?.caption || // Video caption
           message.listResponseMessage?.singleSelectReply?.selectedRowId || // List response
           ''
}
```

### ❓ How to send messages with formatting?

```typescript
await sock.sendMessage(jid, {
    text: '*Bold* _Italic_ ~Strikethrough~ ```Code``` \n\n' +
          '• List item 1\n' +
          '• List item 2\n\n' +
          'Link: https://github.com/brunocgc/Baileys'
})
```

### ❓ How to send audio that works on all devices?

For maximum compatibility, convert audio to OGG Opus:

```bash
# Install FFmpeg first
ffmpeg -i input.mp3 -c:a libopus -ac 1 -avoid_negative_ts make_zero output.ogg
```

```typescript
await sock.sendMessage(jid, {
    audio: fs.readFileSync('output.ogg'),
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true // For voice note
})
```

### ❓ How to download received media?

```typescript
import { downloadMediaMessage } from '@brunocgc/baileys'

const buffer = await downloadMediaMessage(
    message,
    'buffer', // or 'stream'
    {},
    {
        logger: console,
        reuploadRequest: sock.updateMediaMessage
    }
)

fs.writeFileSync('downloaded_media.jpg', buffer)
```

### ❓ What are the media size limits?

| Type | Limit |
|------|--------|
| Image | 16 MB |
| Video | 16 MB |
| Audio | 16 MB |
| Document | 100 MB |
| Sticker | 500 KB |

---

## 🔧 Configuration and Performance

### ❓ How to improve performance for groups?

```typescript
import NodeCache from 'node-cache'

// 1. Group metadata cache
const groupCache = new NodeCache({ stdTTL: 300 })

const sock = makeWASocket({
    cachedGroupMetadata: async (jid) => groupCache.get(jid)
})

// 2. Update cache when needed
sock.ev.on('groups.update', async ([event]) => {
    const metadata = await sock.groupMetadata(event.id)
    groupCache.set(event.id, metadata)
})
```

### ❓ How to implement rate limiting?

```typescript
class MessageQueue {
    private queue: Array<() => Promise<void>> = []
    private processing = false

    async add(task: () => Promise<void>) {
        this.queue.push(task)
        this.process()
    }

    private async process() {
        if (this.processing) return
        this.processing = true

        while (this.queue.length > 0) {
            const task = this.queue.shift()!
            await task()
            await new Promise(resolve => setTimeout(resolve, 1000)) // 1 sec between messages
        }

        this.processing = false
    }
}

const messageQueue = new MessageQueue()

// Use like this:
messageQueue.add(() => sock.sendMessage(jid, { text: 'Hello!' }))
```

### ❓ How to persist messages and conversations?

```typescript
import { makeInMemoryStore } from '@brunocgc/baileys'

// Create store
const store = makeInMemoryStore({})

// Connect to socket
store.bind(sock.ev)

// Save periodically
setInterval(() => {
    fs.writeFileSync('./store.json', JSON.stringify(store.toJSON()))
}, 30000)

// Load on startup
if (fs.existsSync('./store.json')) {
    store.fromJSON(JSON.parse(fs.readFileSync('./store.json', 'utf8')))
}
```

---

## 🐛 Common Issues

### ❓ "Connection Closed" - why does it happen?

**Common causes**:
- Sending too many messages too quickly
- Mobile WhatsApp went offline
- Frequent IP changes
- Simultaneous use of the number

**Solutions**:
```typescript
sock.ev.on('connection.update', (update) => {
    if (update.connection === 'close') {
        const reason = update.lastDisconnect?.error?.output?.statusCode

        if (reason === DisconnectReason.loggedOut) {
            console.log('❌ Logged out - scan QR again')
            // Delete auth folder
        } else {
            console.log('🔄 Reconnecting...')
            // Recreate connection
        }
    }
})
```

### ❓ Bot doesn't respond to certain messages?

**Checks**:
```typescript
sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
        console.log('Message received:', {
            from: msg.key.remoteJid,
            myMessage: msg.key.fromMe,
            type: Object.keys(msg.message || {}),
            content: msg.message
        })

        // Your checks here...
    }
})
```

### ❓ "Module not found" when importing?

**For TypeScript**:
```typescript
import makeWASocket from '@brunocgc/baileys'
```

**For JavaScript (CommonJS)**:
```javascript
const { default: makeWASocket } = require('@brunocgc/baileys')
```

**For JavaScript (ES Modules)**:
```javascript
import makeWASocket from '@brunocgc/baileys'
```

### ❓ Error when sending media?

**Common checks**:
```typescript
// 1. File exists?
if (!fs.existsSync('./image.jpg')) {
    throw new Error('File not found')
}

// 2. Appropriate size?
const stats = fs.statSync('./image.jpg')
if (stats.size > 16 * 1024 * 1024) {
    throw new Error('File too large (max 16MB)')
}

// 3. Supported format?
const supportedImages = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
const ext = path.extname('./image.jpg').toLowerCase()
if (!supportedImages.includes(ext)) {
    throw new Error('Unsupported format')
}
```

---

## 🏢 Commercial Use and Limits

### ❓ Can I use Baileys commercially?

✅ **Yes**, but responsibly:
- ✅ Legitimate customer service bots
- ✅ Relevant notifications
- ✅ Internal process automation
- ❌ Spam or unsolicited messages
- ❌ Violation of WhatsApp Terms

### ❓ What are WhatsApp's limits?

**Speed limits**:
- Maximum 1 message per second
- Maximum 1000 messages per day (new number)
- Older numbers have higher limits

**Contact limits**:
- Maximum 5 new groups per day
- Maximum 256 participants per group (depending on account)

### ❓ How to avoid being banned?

✅ **Best practices**:
- Respect speed limits
- Only send relevant messages
- Implement opt-out (unsubscribe)
- Use dedicated numbers for bots
- Monitor delivery metrics

❌ **Avoid**:
- Spam or bulk messages
- Sending to random numbers
- Inappropriate content
- Copyright violations

### ❓ How to implement opt-out?

```typescript
const optedOutUsers = new Set()

// Load opt-out list
function loadOptOutList() {
    try {
        const data = fs.readFileSync('./opted-out.json', 'utf8')
        const users = JSON.parse(data)
        users.forEach(user => optedOutUsers.add(user))
    } catch (error) {
        // File doesn't exist yet
    }
}

// Save opt-out list
function saveOptOutList() {
    fs.writeFileSync('./opted-out.json', JSON.stringify([...optedOutUsers]))
}

// Check before sending
async function sendMessage(jid: string, content: any) {
    if (optedOutUsers.has(jid)) {
        console.log(`User ${jid} opted out of receiving messages`)
        return
    }

    await sock.sendMessage(jid, content)
}

// Process opt-out command
if (text.toLowerCase() === 'stop' || text.toLowerCase() === 'unsubscribe') {
    optedOutUsers.add(jid)
    saveOptOutList()
    await sock.sendMessage(jid, {
        text: '✅ You have been removed from our list. You will no longer receive automated messages.\n\n' +
              'To receive messages again, type "start".'
    })
}
```

---

## 🛠️ Development

### ❓ How to debug issues?

```typescript
import pino from 'pino'

// Detailed logger
const logger = pino({
    level: 'debug',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true }
    }
})

const sock = makeWASocket({
    logger,
    printQRInTerminal: true
})

// Listen to all events
sock.ev.on('connection.update', console.log)
sock.ev.on('creds.update', () => console.log('Credentials updated'))
sock.ev.on('messaging-history.set', ({ messages, isLatest }) => {
    console.log(`History: ${messages.length} messages (${isLatest ? 'complete' : 'partial'})`)
})
```

### ❓ How to structure a large project?

```
project/
├── src/
│   ├── bot.ts              # Main file
│   ├── handlers/           # Event handlers
│   │   ├── messages.ts
│   │   ├── connection.ts
│   │   └── groups.ts
│   ├── commands/           # Bot commands
│   │   ├── help.ts
│   │   ├── admin.ts
│   │   └── user.ts
│   ├── services/           # External services
│   │   ├── database.ts
│   │   ├── api.ts
│   │   └── cache.ts
│   ├── utils/              # Utilities
│   │   ├── logger.ts
│   │   ├── validators.ts
│   │   └── helpers.ts
│   └── types/              # TypeScript types
│       └── index.ts
├── auth/                   # Authentication data (git ignore)
├── media/                  # Temporary media
├── config/                 # Configurations
│   ├── development.json
│   └── production.json
└── package.json
```

### ❓ How to write tests?

```typescript
// __tests__/bot.test.ts
import { createMockSocket } from '../src/utils/test-helpers'

describe('Bot', () => {
    let mockSocket: any

    beforeEach(() => {
        mockSocket = createMockSocket()
    })

    test('should respond to hello message', async () => {
        const message = {
            key: { fromMe: false, remoteJid: 'test@s.whatsapp.net' },
            message: { conversation: 'hello' }
        }

        await handleMessage(mockSocket, message)

        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            'test@s.whatsapp.net',
            { text: expect.stringContaining('Hello') }
        )
    })
})
```

### ❓ How to deploy to production?

**Docker**:
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["npm", "start"]
```

**Docker Compose**:
```yaml
version: '3.8'
services:
  bot:
    build: .
    volumes:
      - ./auth:/app/auth
      - ./media:/app/media
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

---

## 🆘 Still Need Help?

### 📚 Additional Resources

- 📖 [Complete Documentation](./DOCUMENTATION-en.md)
- 🎯 [Practical Examples](./EXAMPLES-en.md)
- ⚡ [Quick Start Guide](./QUICK-START-en.md)
- 📋 [Original README](./README-en.md)

### 🤝 Community

- 🐙 **GitHub**: [github.com/brunocgc/Baileys](https://github.com/brunocgc/Baileys)
- 🌐 **Website**: [nvngroup.com.br](https://www.nvngroup.com.br)

### 🐛 Report Bugs

1. Check if the issue has already been reported
2. Provide code to reproduce the error
3. Include complete error logs
4. Specify Node.js and Baileys versions
