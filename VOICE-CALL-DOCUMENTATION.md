# 📞 Voice/Video Call Documentation - Pitu/Baileys

Complete documentation for voice and video calling functionality in Pitu.

## 📋 Table of Contents

1. [Introduction](#introduction)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Installation](#installation)
5. [Quick Start](#quick-start)
6. [API Reference](#api-reference)
7. [Events](#events)
8. [Configuration](#configuration)
9. [Examples](#examples)
10. [Troubleshooting](#troubleshooting)
11. [Production Deployment](#production-deployment)

---

## 🎯 Introduction

The Pitu Voice/Video Call module provides a complete, self-hosted solution for making and receiving WhatsApp calls with audio and video support. No external servers required - everything runs on your infrastructure.

### Key Benefits

- ✅ **Self-hosted**: No dependency on external services
- ✅ **Complete control**: Full privacy and data ownership
- ✅ **Scalable**: Supports multiple concurrent calls
- ✅ **Production-ready**: Built for SaaS applications
- ✅ **Type-safe**: Full TypeScript support
- ✅ **WebRTC native**: Direct peer-to-peer connections
- ✅ **Quality monitoring**: Real-time call quality metrics

---

## 🚀 Features

### Core Features
- 📞 Audio calls
- 📹 Video calls
- 👥 Group calls (upcoming)
- 🔇 Mute/unmute audio
- 📹 Enable/disable video
- 📊 Call quality monitoring
- 📝 Call history
- ⏺️ Call recording
- 📱 Multiple device support

### Advanced Features
- 🎙️ Audio processing (echo cancellation, noise suppression)
- 🎨 Video filters and effects
- 📸 Snapshot capture
- 🔄 Device switching (microphone, camera)
- 📈 Real-time quality metrics
- 💾 Automatic call logging
- ⚡ Reconnection handling

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Application Layer                       │
│         (Your Backend/Frontend Application)              │
├─────────────────────────────────────────────────────────┤
│                  VoiceCall API                           │
│      (High-level interface for call operations)          │
├─────────────────────────────────────────────────────────┤
│                 CallManager                              │
│   (Orchestrates WebRTC, Signaling, and Media)           │
├─────────────────────────────────────────────────────────┤
│  WebRTCHandler  │  SignalingHandler  │  AudioVideoProcessor
│  (Peer Conn.)   │  (WhatsApp Signal) │  (Media Processing)
├─────────────────────────────────────────────────────────┤
│              Pitu/Baileys Socket                         │
│           (WhatsApp Web Protocol)                        │
├─────────────────────────────────────────────────────────┤
│                 WhatsApp Servers                         │
└─────────────────────────────────────────────────────────┘
```

### Components

#### 1. **VoiceCall**
Main API interface. High-level methods for call operations.

#### 2. **CallManager**
Central orchestrator managing call lifecycle, state, and coordination.

#### 3. **WebRTCHandler**
Manages WebRTC peer connections, SDP negotiation, and ICE candidates.

#### 4. **SignalingHandler**
Bridges WebRTC signaling with WhatsApp's proprietary protocol.

#### 5. **AudioVideoProcessor**
Handles media stream processing, recording, and enhancements.

---

## 📦 Installation

```bash
npm install @nvngroup/pitu
# or
yarn add @nvngroup/pitu
```

### Dependencies

```json
{
  "@nvngroup/pitu": "^0.1.18",
  "socket.io": "^4.7.5",
  "socket.io-client": "^4.7.5",
  "express": "^4.18.2"
}
```

---

## ⚡ Quick Start

### Backend Setup

```typescript
import makeWASocket, { useMultiFileAuthState } from '@nvngroup/pitu'
import { initVoiceCall } from '@nvngroup/pitu/VoiceCall'

// Initialize WhatsApp socket
const { state, saveCreds } = await useMultiFileAuthState('auth_info')
const sock = makeWASocket({
  auth: state,
  printQRInTerminal: true
})

// Initialize VoiceCall
const voiceCall = initVoiceCall(sock, {
  maxConcurrentCalls: 5,
  enableQualityMonitoring: true
})

// Handle incoming calls
voiceCall.on('call:incoming', async (callInfo) => {
  console.log('Incoming call from:', callInfo.remoteJid)

  // Auto-answer (or implement your logic)
  await voiceCall.answerCall(callInfo.id, {
    video: callInfo.metadata.isVideo
  })
})

// Handle call connected
voiceCall.on('call:connected', (callInfo) => {
  console.log('Call connected:', callInfo.id)
})

// Make a call
const result = await voiceCall.makeCall('5511999999999@s.whatsapp.net', {
  video: true
})

if (result.success) {
  console.log('Call initiated:', result.callId)
}
```

### Frontend Setup (React)

```typescript
import React, { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

function CallComponent() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    const newSocket = io('http://localhost:3000')
    setSocket(newSocket)

    newSocket.on('incoming-call', (data) => {
      console.log('Incoming call:', data)
      // Show incoming call UI
    })

    return () => {
      newSocket.close()
    }
  }, [])

  const makeCall = async (to: string, video: boolean) => {
    // Get local media
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video
    })
    setLocalStream(stream)

    // Request call
    socket?.emit('make-call', { to, video }, (result) => {
      if (result.success) {
        console.log('Call started:', result.callId)
      }
    })
  }

  return (
    <div>
      <button onClick={() => makeCall('5511999999999@s.whatsapp.net', false)}>
        Audio Call
      </button>
      <button onClick={() => makeCall('5511999999999@s.whatsapp.net', true)}>
        Video Call
      </button>
    </div>
  )
}
```

---

## 📚 API Reference

### VoiceCall Class

#### `initVoiceCall(socket, config?)`

Initialize VoiceCall module.

**Parameters:**
- `socket: WASocket` - Pitu/Baileys socket instance
- `config?: CallManagerConfig` - Optional configuration

**Returns:** `VoiceCall` instance

**Example:**
```typescript
const voiceCall = initVoiceCall(sock, {
  maxConcurrentCalls: 5,
  defaultCallTimeout: 60000,
  enableQualityMonitoring: true
})
```

---

#### `makeCall(remoteJid, options?)`

Make an outgoing call.

**Parameters:**
- `remoteJid: string` - Remote user JID (e.g., '5511999999999@s.whatsapp.net')
- `options?: CallOptions` - Call options

**Returns:** `Promise<CallActionResult>`

**Example:**
```typescript
const result = await voiceCall.makeCall('5511999999999@s.whatsapp.net', {
  video: true,
  startAudioMuted: false,
  timeout: 60000
})

if (result.success) {
  console.log('Call ID:', result.callId)
}
```

---

#### `answerCall(callId, options?)`

Answer an incoming call.

**Parameters:**
- `callId: string` - Call ID
- `options?: CallOptions` - Call options

**Returns:** `Promise<CallActionResult>`

**Example:**
```typescript
voiceCall.on('call:incoming', async (callInfo) => {
  const result = await voiceCall.answerCall(callInfo.id, {
    video: callInfo.metadata.isVideo
  })
})
```

---

#### `rejectCall(callId)`

Reject an incoming call.

**Parameters:**
- `callId: string` - Call ID

**Returns:** `Promise<CallActionResult>`

**Example:**
```typescript
await voiceCall.rejectCall(callInfo.id)
```

---

#### `endCall(callId, reason?)`

End an active call.

**Parameters:**
- `callId: string` - Call ID
- `reason?: string` - Optional end reason

**Returns:** `Promise<CallActionResult>`

**Example:**
```typescript
await voiceCall.endCall(callId, 'user-ended')
```

---

#### `toggleMute(callId, muted)`

Toggle audio mute.

**Parameters:**
- `callId: string` - Call ID
- `muted: boolean` - True to mute, false to unmute

**Example:**
```typescript
voiceCall.toggleMute(callId, true) // Mute
```

---

#### `toggleVideo(callId, enabled)`

Toggle video.

**Parameters:**
- `callId: string` - Call ID
- `enabled: boolean` - True to enable, false to disable

**Example:**
```typescript
voiceCall.toggleVideo(callId, false) // Disable video
```

---

#### `getCallInfo(callId)`

Get call information.

**Parameters:**
- `callId: string` - Call ID

**Returns:** `CallInfo | null`

**Example:**
```typescript
const info = voiceCall.getCallInfo(callId)
console.log('Call state:', info?.state)
```

---

#### `getActiveCalls()`

Get all active calls.

**Returns:** `CallInfo[]`

**Example:**
```typescript
const calls = voiceCall.getActiveCalls()
console.log('Active calls:', calls.length)
```

---

#### `getCallHistory()`

Get call history.

**Returns:** `CallHistoryEntry[]`

**Example:**
```typescript
const history = voiceCall.getCallHistory()
history.forEach(entry => {
  console.log(`${entry.direction} call: ${entry.duration}s`)
})
```

---

## 📡 Events

### Call State Events

#### `call:incoming`
Emitted when receiving an incoming call.

```typescript
voiceCall.on('call:incoming', (callInfo: CallInfo) => {
  console.log('Incoming call from:', callInfo.remoteJid)
  console.log('Is video:', callInfo.metadata.isVideo)
})
```

#### `call:ringing`
Emitted when outgoing call is ringing.

```typescript
voiceCall.on('call:ringing', (callInfo: CallInfo) => {
  console.log('Ringing...')
})
```

#### `call:connected`
Emitted when call is successfully connected.

```typescript
voiceCall.on('call:connected', (callInfo: CallInfo) => {
  console.log('Call connected:', callInfo.id)
})
```

#### `call:ended`
Emitted when call ends.

```typescript
voiceCall.on('call:ended', (callInfo: CallInfo, reason: string) => {
  console.log('Call ended. Duration:', callInfo.duration, 'seconds')
  console.log('Reason:', reason)
})
```

#### `call:failed`
Emitted when call fails.

```typescript
voiceCall.on('call:failed', (callInfo: CallInfo, error: Error) => {
  console.error('Call failed:', error.message)
})
```

#### `call:rejected`
Emitted when call is rejected.

```typescript
voiceCall.on('call:rejected', (callInfo: CallInfo) => {
  console.log('Call was rejected')
})
```

### Media Events

#### `call:remote-stream`
Emitted when remote stream is received.

```typescript
voiceCall.on('call:remote-stream', (callInfo: CallInfo, stream: MediaStream) => {
  // Attach stream to video element
  const videoElement = document.getElementById('remote-video') as HTMLVideoElement
  videoElement.srcObject = stream
})
```

#### `call:local-stream`
Emitted when local stream is created.

```typescript
voiceCall.on('call:local-stream', (callInfo: CallInfo, stream: MediaStream) => {
  const videoElement = document.getElementById('local-video') as HTMLVideoElement
  videoElement.srcObject = stream
})
```

### Quality Events

#### `call:quality-update`
Emitted periodically with call quality metrics.

```typescript
voiceCall.on('call:quality-update', (callInfo: CallInfo, metrics: CallQualityMetrics) => {
  console.log('Audio bitrate:', metrics.audio.bitrate, 'kbps')
  console.log('Latency:', metrics.audio.latency, 'ms')
  if (metrics.video) {
    console.log('Video resolution:', metrics.video.resolution)
    console.log('FPS:', metrics.video.frameRate)
  }
})
```

---

## ⚙️ Configuration

### CallManagerConfig

```typescript
interface CallManagerConfig {
  // WebRTC configuration
  defaultWebRTCConfig?: {
    iceServers: RTCIceServer[]
    iceTransportPolicy?: 'all' | 'relay'
  }

  // Media constraints
  defaultMediaConstraints?: {
    audio: boolean | AudioConstraints
    video: boolean | VideoConstraints
  }

  // Call settings
  defaultCallTimeout?: number         // Default: 60000 (60s)
  maxConcurrentCalls?: number         // Default: 1

  // Features
  enableRecordingByDefault?: boolean  // Default: false
  enableQualityMonitoring?: boolean   // Default: true
  qualityMonitoringInterval?: number  // Default: 5000 (5s)

  // Logging
  enableCallLogs?: boolean            // Default: true
  callLogsRetentionDays?: number      // Default: 30
}
```

### Example Configuration

```typescript
const config: CallManagerConfig = {
  defaultWebRTCConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  },
  defaultMediaConstraints: {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    }
  },
  maxConcurrentCalls: 5,
  enableQualityMonitoring: true,
  qualityMonitoringInterval: 5000
}

const voiceCall = initVoiceCall(sock, config)
```

---

## 💡 Examples

### Complete Backend Example

See: [examples/voice-call/backend/server.ts](examples/voice-call/backend/server.ts)

### Complete Frontend Example

See: [examples/voice-call/frontend/CallInterface.tsx](examples/voice-call/frontend/CallInterface.tsx)

---

## 🔧 Troubleshooting

### Common Issues

#### 1. "Failed to get user media"
**Problem:** Browser denied camera/microphone access.

**Solution:**
- Ensure HTTPS (required for getUserMedia)
- Check browser permissions
- Test with: `navigator.mediaDevices.getUserMedia({ audio: true, video: true })`

#### 2. "ICE connection failed"
**Problem:** WebRTC connection cannot establish.

**Solution:**
- Check firewall settings
- Verify STUN server accessibility
- Consider adding TURN server for restrictive networks

#### 3. "Call timeout"
**Problem:** Call not answered within timeout period.

**Solution:**
- Increase `defaultCallTimeout` in config
- Check if remote user is online

#### 4. "Maximum concurrent calls reached"
**Problem:** Too many active calls.

**Solution:**
- Increase `maxConcurrentCalls` in config
- End inactive calls

---

## 🚀 Production Deployment

### Requirements

- Node.js >= 20.0.0
- HTTPS (required for WebRTC)
- Open ports: 80/443 (HTTP/HTTPS), 3478 (STUN)

### Recommended Setup

#### 1. Use Process Manager

```bash
# PM2
pm2 start server.js -i 4

# Docker
docker build -t voice-call-server .
docker run -p 3000:3000 voice-call-server
```

#### 2. Setup NGINX Reverse Proxy

```nginx
server {
  listen 443 ssl http2;
  server_name yourdomain.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

#### 3. Setup TURN Server (Optional but Recommended)

```bash
# Install coturn
apt-get install coturn

# Configure /etc/turnserver.conf
listening-port=3478
realm=yourdomain.com
server-name=yourdomain.com
```

Then use in config:
```typescript
iceServers: [
  { urls: 'stun:stun.yourdomain.com:3478' },
  {
    urls: 'turn:turn.yourdomain.com:3478',
    username: 'user',
    credential: 'pass'
  }
]
```

### Scaling Considerations

- **Horizontal scaling:** Use Redis for session sharing
- **Load balancing:** Sticky sessions required for WebSocket
- **Monitoring:** Track call quality, success rates, errors
- **Logging:** Centralized logging (ELK, Datadog, etc.)

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 💬 Support

- GitHub Issues: [https://github.com/brunocgc/Baileys/issues](https://github.com/brunocgc/Baileys/issues)
- WhatsApp: [Contact Us](https://wa.me/552120428610)

---

Made with ❤️ by NVN Group
