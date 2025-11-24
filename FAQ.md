# ❓ Pitu - Perguntas Frequentes (FAQ)

## 🎯 Índice Rápido

- [📱 Conexão e Autenticação](#-conexão-e-autenticação)
- [💬 Mensagens e Mídia](#-mensagens-e-mídia)
- [🔧 Configuração e Performance](#-configuração-e-performance)
- [🐛 Problemas Comuns](#-problemas-comuns)
- [🏢 Uso Comercial e Limites](#-uso-comercial-e-limites)
- [🛠️ Desenvolvimento](#️-desenvolvimento)

---

## 📱 Conexão e Autenticação

### ❓ Como funciona a conexão com o WhatsApp?

O Pitu se conecta diretamente ao WhatsApp Web via WebSocket, simulando um navegador. Você precisa "pareá-lo" com seu WhatsApp mobile escaneando um QR Code ou usando código de pareamento.

### ❓ QR Code vs Código de Pareamento - qual usar?

| QR Code | Código de Pareamento |
|---------|---------------------|
| ✅ Sempre funciona | ❌ Só funciona uma vez por número |
| ✅ Mais estável | ✅ Não precisa escanear |
| ❌ Precisa escanear manualmente | ❌ Menos confiável |

**Recomendação**: Use QR Code para produção.

### ❓ Posso usar o mesmo número em vários bots?

❌ **Não!** Um número WhatsApp só pode estar ativo em um bot por vez. Se tentar usar em vários:

- Os bots irão se desconectar mutuamente
- Pode resultar em ban temporário
- Funcionalidades podem parar de funcionar

### ❓ Preciso manter o WhatsApp mobile online?

✅ **Sim**, mas com exceções:

- WhatsApp mobile deve estar conectado à internet
- Não precisa estar com o app aberto
- Se ficar offline por muito tempo (>14 dias), o bot pode desconectar

### ❓ Como salvar a sessão para não precisar escanear sempre?

```typescript
import { useMultiFileAuthState } from '@nvngroup/pitu'

// Salva automaticamente em uma pasta
const { state, saveCreds } = await useMultiFileAuthState('minha-sessao')

const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds) // IMPORTANTE: sempre adicionar isso!
```

---

## 💬 Mensagens e Mídia

### ❓ Como detectar se uma mensagem é para mim?

```typescript
sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
        // Ignorar mensagens que EU enviei
        if (msg.key.fromMe) continue

        // Ignorar mensagens vazias
        if (!msg.message) continue

        // Processar apenas mensagens recebidas
        console.log('Nova mensagem para processar!')
    }
})
```

### ❓ Como extrair texto de diferentes tipos de mensagem?

```typescript
function getMessageText(message: any): string {
    return message.conversation || // Mensagem de texto simples
           message.extendedTextMessage?.text || // Texto com formatação/link
           message.imageMessage?.caption || // Legenda de imagem
           message.videoMessage?.caption || // Legenda de vídeo
           message.listResponseMessage?.singleSelectReply?.selectedRowId || // Resposta de lista
           ''
}
```

### ❓ Como enviar mensagens com formatação?

```typescript
await sock.sendMessage(jid, {
    text: '*Negrito* _Itálico_ ~Riscado~ ```Código``` \n\n' +
          '• Lista item 1\n' +
          '• Lista item 2\n\n' +
          'Link: https://github.com/brunocgc/Pitu'
})
```

### ❓ Como enviar áudio que funciona em todos os dispositivos?

Para máxima compatibilidade, converta áudio para OGG Opus:

```bash
# Instalar FFmpeg primeiro
ffmpeg -i input.mp3 -c:a libopus -ac 1 -avoid_negative_ts make_zero output.ogg
```

```typescript
await sock.sendMessage(jid, {
    audio: fs.readFileSync('output.ogg'),
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true // Para nota de voz
})
```

### ❓ Como baixar mídia recebida?

```typescript
import { downloadMediaMessage } from '@nvngroup/pitu'

const buffer = await downloadMediaMessage(
    message,
    'buffer', // ou 'stream'
    {},
    {
        logger: console,
        reuploadRequest: sock.updateMediaMessage
    }
)

fs.writeFileSync('media_baixada.jpg', buffer)
```

### ❓ Qual o limite de tamanho para mídia?

| Tipo | Limite |
|------|--------|
| Imagem | 16 MB |
| Vídeo | 16 MB |
| Áudio | 16 MB |
| Documento | 100 MB |
| Sticker | 500 KB |

---

## 🔧 Configuração e Performance

### ❓ Como melhorar a performance para grupos?

```typescript
import NodeCache from 'node-cache'

// 1. Cache de metadados de grupo
const groupCache = new NodeCache({ stdTTL: 300 })

const sock = makeWASocket({
    cachedGroupMetadata: async (jid) => groupCache.get(jid)
})

// 2. Atualizar cache quando necessário
sock.ev.on('groups.update', async ([event]) => {
    const metadata = await sock.groupMetadata(event.id)
    groupCache.set(event.id, metadata)
})
```

### ❓ Como implementar rate limiting?

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
            await new Promise(resolve => setTimeout(resolve, 1000)) // 1 seg entre mensagens
        }

        this.processing = false
    }
}

const messageQueue = new MessageQueue()

// Usar assim:
messageQueue.add(() => sock.sendMessage(jid, { text: 'Olá!' }))
```

---

## 🐛 Problemas Comuns

### ❓ "Connection Closed" - por que acontece?

**Causas comuns**:

- Envio de muitas mensagens muito rápido
- WhatsApp mobile ficou offline
- Mudança de IP frequente
- Uso simultâneo do número

**Soluções**:

```typescript
sock.ev.on('connection.update', (update) => {
    if (update.connection === 'close') {
        const reason = update.lastDisconnect?.error?.output?.statusCode

        if (reason === DisconnectReason.loggedOut) {
            console.log('❌ Deslogado - escaneie QR novamente')
            // Deletar pasta de auth
        } else {
            console.log('🔄 Reconectando...')
            // Recriar conexão
        }
    }
})
```

### ❓ Bot não responde a certas mensagens?

**Verificações**:

```typescript
sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
        console.log('Mensagem recebida:', {
            de: msg.key.remoteJid,
            minhaMsg: msg.key.fromMe,
            tipo: Object.keys(msg.message || {}),
            conteudo: msg.message
        })

        // Suas verificações aqui...
    }
})
```

### ❓ "Module not found" ao importar?

**Para TypeScript**:

```typescript
import makeWASocket from '@nvngroup/pitu'
```

**Para JavaScript (CommonJS)**:

```javascript
const { default: makeWASocket } = require('@nvngroup/pitu')
```

**Para JavaScript (ES Modules)**:

```javascript
import makeWASocket from '@nvngroup/pitu'
```

### ❓ Erro ao enviar mídia?

**Verificações comuns**:

```typescript
// 1. Arquivo existe?
if (!fs.existsSync('./imagem.jpg')) {
    throw new Error('Arquivo não encontrado')
}

// 2. Tamanho adequado?
const stats = fs.statSync('./imagem.jpg')
if (stats.size > 16 * 1024 * 1024) {
    throw new Error('Arquivo muito grande (máx 16MB)')
}

// 3. Formato suportado?
const supportedImages = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
const ext = path.extname('./imagem.jpg').toLowerCase()
if (!supportedImages.includes(ext)) {
    throw new Error('Formato não suportado')
}
```

---

## 🏢 Uso Comercial e Limites

### ❓ Posso usar Pitu comercialmente?

✅ **Sim**, mas com responsabilidade:

- ✅ Bots de atendimento legítimos
- ✅ Notificações relevantes
- ✅ Automação de processos internos
- ❌ Spam ou mensagens não solicitadas
- ❌ Violação dos Termos do WhatsApp

### ❓ Quais são os limites do WhatsApp?

**Limites de velocidade**:

- Máximo 1 mensagem por segundo
- Máximo 1000 mensagens por dia (número novo)
- Números antigos têm limites maiores

**Limites de contatos**:

- Máximo 5 grupos novos por dia
- Máximo 256 participantes por grupo (dependendo da conta)

### ❓ Como evitar ser banido?

✅ **Boas práticas**:

- Respeite limites de velocidade
- Só envie mensagens relevantes
- Implemente opt-out (descadastro)
- Use números dedicados para bots
- Monitore métricas de entrega

❌ **Evite**:

- Spam ou mensagens em massa
- Envio para números aleatórios
- Conteúdo impróprio
- Violação de direitos autorais

### ❓ Como implementar opt-out?

```typescript
const optedOutUsers = new Set()

// Carregar lista de opt-out
function loadOptOutList() {
    try {
        const data = fs.readFileSync('./opted-out.json', 'utf8')
        const users = JSON.parse(data)
        users.forEach(user => optedOutUsers.add(user))
    } catch (error) {
        // Arquivo não existe ainda
    }
}

// Salvar lista de opt-out
function saveOptOutList() {
    fs.writeFileSync('./opted-out.json', JSON.stringify([...optedOutUsers]))
}

// Verificar antes de enviar
async function sendMessage(jid: string, content: any) {
    if (optedOutUsers.has(jid)) {
        console.log(`Usuário ${jid} optou por não receber mensagens`)
        return
    }

    await sock.sendMessage(jid, content)
}

// Processar comando de opt-out
if (text.toLowerCase() === 'parar' || text.toLowerCase() === 'stop') {
    optedOutUsers.add(jid)
    saveOptOutList()
    await sock.sendMessage(jid, {
        text: '✅ Você foi removido da nossa lista. Não receberá mais mensagens automáticas.\n\n' +
              'Para voltar a receber, digite "iniciar".'
    })
}
```

---

## 🛠️ Desenvolvimento

### ❓ Como debugar problemas?

```typescript
import pino from 'pino'

// Logger detalhado
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

// Escutar todos os eventos
sock.ev.on('connection.update', console.log)
sock.ev.on('creds.update', () => console.log('Credenciais atualizadas'))
sock.ev.on('messaging-history.set', ({ messages, isLatest }) => {
    console.log(`Histórico: ${messages.length} mensagens (${isLatest ? 'completo' : 'parcial'})`)
})
```

### ❓ Como estruturar um projeto grande?

```
projeto/
├── src/
│   ├── bot.ts              # Arquivo principal
│   ├── handlers/           # Manipuladores de eventos
│   │   ├── messages.ts
│   │   ├── connection.ts
│   │   └── groups.ts
│   ├── commands/           # Comandos do bot
│   │   ├── help.ts
│   │   ├── admin.ts
│   │   └── user.ts
│   ├── services/           # Serviços externos
│   │   ├── database.ts
│   │   ├── api.ts
│   │   └── cache.ts
│   ├── utils/              # Utilitários
│   │   ├── logger.ts
│   │   ├── validators.ts
│   │   └── helpers.ts
│   └── types/              # Tipos TypeScript
│       └── index.ts
├── auth/                   # Dados de autenticação (git ignore)
├── media/                  # Mídias temporárias
├── config/                 # Configurações
│   ├── development.json
│   └── production.json
└── package.json
```

### ❓ Como fazer testes?

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
            { text: expect.stringContaining('Olá') }
        )
    })
})
```

### ❓ Como deploy em produção?

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

## 🆘 Ainda Precisa de Ajuda?

### 📚 Recursos Adicionais

- 📖 [Documentação Completa](./DOCUMENTATION.md)
- 🎯 [Exemplos Práticos](./EXAMPLES.md)
- ⚡ [Guia de Início Rápido](./QUICK-START.md)
- 📋 [README Original](./README.md)

### 🤝 Comunidade

- 🐙 **GitHub**: [github.com/brunocgc/Pitu](https://github.com/brunocgc/Pitu)
- 🌐 **Site**: [nvngroup.com.br](https://www.nvngroup.com.br)

### 🐛 Reportar Bugs

1. Verifique se o problema já foi reportado
2. Forneça código para reproduzir o erro
3. Inclua logs de erro completos
4. Especifique versão do Node.js e Pitu

---
