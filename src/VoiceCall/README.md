# 📞 Pitu Voice/Video Call Module

Complete, self-hosted voice and video calling solution for WhatsApp using Pitu/Baileys.

## ✨ Features

- 📞 **Audio Calls** - Crystal clear voice calls
- 📹 **Video Calls** - HD video calling with adaptive quality
- 🎙️ **Audio Processing** - Echo cancellation, noise suppression
- 📊 **Quality Monitoring** - Real-time metrics and analytics
- ⏺️ **Call Recording** - Record calls for compliance/review
- 📝 **Call History** - Automatic logging and retention
- 🔐 **Self-Hosted** - No external dependencies
- 🚀 **Production Ready** - Built for scale

## 🚀 Quick Start

```typescript
import makeWASocket from '@nvngroup/pitu'
import { initVoiceCall } from '@nvngroup/pitu/VoiceCall'

// Initialize WhatsApp
const sock = makeWASocket({ auth: authState })

// Initialize VoiceCall
const voiceCall = initVoiceCall(sock)

// Handle incoming calls
voiceCall.on('call:incoming', async (callInfo) => {
  await voiceCall.answerCall(callInfo.id)
})

// Make a call
await voiceCall.makeCall('5511999999999@s.whatsapp.net', {
  video: true
})
```

## 📦 Installation

```bash
npm install @nvngroup/pitu
```

## 📚 Documentation

See [VOICE-CALL-DOCUMENTATION.md](../../VOICE-CALL-DOCUMENTATION.md) for complete documentation.

## 🏗️ Architecture

```
VoiceCall API
    ├── CallManager (Orchestration)
    │   ├── WebRTCHandler (Peer connections)
    │   ├── SignalingHandler (WhatsApp signaling)
    │   └── AudioVideoProcessor (Media processing)
    └── Pitu/Baileys Socket
```

## 🎯 Use Cases

- **Customer Support** - Audio/video support calls
- **Telehealth** - Medical consultations
- **Education** - Online tutoring
- **Business** - Sales and meetings
- **SaaS Products** - Integrated calling feature

## 🔧 Configuration

```typescript
const voiceCall = initVoiceCall(sock, {
  maxConcurrentCalls: 5,
  enableQualityMonitoring: true,
  defaultCallTimeout: 60000,
  enableRecordingByDefault: false
})
```

## 📖 Examples

### Backend (Node.js + Express)
[examples/voice-call/backend/server.ts](../../examples/voice-call/backend/server.ts)

### Frontend (React)
[examples/voice-call/frontend/CallInterface.tsx](../../examples/voice-call/frontend/CallInterface.tsx)

## 🌟 Key Features

### Audio Processing
- Echo cancellation
- Noise suppression
- Auto gain control
- Audio level visualization

### Video Processing
- HD quality (up to 1080p)
- Adaptive bitrate
- Video filters
- Snapshot capture

### Quality Monitoring
- Bitrate tracking
- Latency measurement
- Packet loss detection
- Connection quality

### Call Management
- Multiple concurrent calls
- Call history
- Auto-reconnection
- Timeout handling

## 🔐 Security

- End-to-end encryption via Signal Protocol
- No data sent to external servers
- Self-hosted infrastructure
- GDPR compliant

## 📊 Performance

- WebRTC peer-to-peer (low latency)
- STUN servers for NAT traversal
- Adaptive bitrate for varying networks
- Quality monitoring and auto-adjustment

## 🚀 Production Deployment

### Requirements
- Node.js >= 20.0.0
- HTTPS (required for WebRTC)
- STUN/TURN server (recommended)

### Scaling
- Horizontal scaling supported
- Load balancing with sticky sessions
- Redis for session sharing
- Monitoring and logging

## 🤝 Contributing

Contributions welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md)

## 📄 License

MIT License - See [LICENSE](../../LICENSE)

## 💬 Support

- Issues: [GitHub Issues](https://github.com/brunocgc/Baileys/issues)
- WhatsApp: [Contact Us](https://wa.me/552120428610)
- Website: [nvngroup.com.br](https://www.nvngroup.com.br)

---

Made with ❤️ by NVN Group
