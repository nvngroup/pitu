/**
 * Backend Server Example with Voice/Video Call Support
 * Node.js backend using Express + Socket.IO for real-time communication
 */

import express from 'express'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@nvngroup/pitu'
import { initVoiceCall } from '@nvngroup/pitu/VoiceCall'
import type { CallInfo } from '@nvngroup/pitu/VoiceCall'
import { Boom } from '@hapi/boom'
import pino from 'pino'

// Express setup
const app = express()
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
	cors: {
		origin: '*', // In production, set specific origins
		methods: ['GET', 'POST'],
	},
})

// Middleware
app.use(express.json())
app.use(express.static('public'))

// Global state
let waSocket: any
let voiceCall: any
const activeSessions = new Map<string, any>() // socketId -> session data

/**
 * Initialize WhatsApp connection
 */
async function initializeWhatsApp() {
	const { state, saveCreds } = await useMultiFileAuthState('auth_info')

	waSocket = makeWASocket({
		auth: state,
		printQRInTerminal: true,
		logger: pino({ level: 'silent' }),
		browser: ['VoiceCall Server', 'Chrome', '1.0.0'],
		markOnlineOnConnect: false,
	})

	// Initialize VoiceCall
	voiceCall = initVoiceCall(waSocket, {
		maxConcurrentCalls: 5,
		enableQualityMonitoring: true,
		enableCallLogs: true,
	})

	// WhatsApp connection events
	waSocket.ev.on('creds.update', saveCreds)

	waSocket.ev.on('connection.update', (update: any) => {
		const { connection, lastDisconnect, qr } = update

		if(qr) {
			// Send QR code to frontend
			io.emit('qr', qr)
			console.log('📱 QR Code generated, scan with WhatsApp')
		}

		if(connection === 'open') {
			console.log('✅ WhatsApp connected successfully')
			io.emit('whatsapp-status', { connected: true })
		}

		if(connection === 'close') {
			const shouldReconnect =
				(lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut

			if(shouldReconnect) {
				console.log('🔄 Reconnecting...')
				initializeWhatsApp()
			} else {
				console.log('🚪 Logged out')
				io.emit('whatsapp-status', { connected: false })
			}
		}
	})

	// Voice call events
	setupVoiceCallEvents()
}

/**
 * Setup voice call event handlers
 */
function setupVoiceCallEvents() {
	// Incoming call
	voiceCall.on('call:incoming', (callInfo: CallInfo) => {
		console.log(`📞 Incoming ${callInfo.metadata.isVideo ? 'video' : 'audio'} call from:`, callInfo.remoteJid)

		// Notify all connected clients
		io.emit('incoming-call', {
			callId: callInfo.id,
			from: callInfo.remoteJid,
			isVideo: callInfo.metadata.isVideo,
			timestamp: new Date(),
		})
	})

	// Call connected
	voiceCall.on('call:connected', (callInfo: CallInfo) => {
		console.log('✅ Call connected:', callInfo.id)
		io.emit('call-connected', {
			callId: callInfo.id,
			remoteJid: callInfo.remoteJid,
		})
	})

	// Call ended
	voiceCall.on('call:ended', (callInfo: CallInfo, reason: string) => {
		console.log('📴 Call ended:', callInfo.id, 'Reason:', reason)
		io.emit('call-ended', {
			callId: callInfo.id,
			reason,
			duration: callInfo.duration,
		})
	})

	// Call quality update
	voiceCall.on('call:quality-update', (callInfo: CallInfo, metrics: any) => {
		io.emit('call-quality', {
			callId: callInfo.id,
			metrics,
		})
	})

	// Remote stream
	voiceCall.on('call:remote-stream', (callInfo: CallInfo, stream: MediaStream) => {
		console.log('🎥 Remote stream received for call:', callInfo.id)
		// Stream will be handled on frontend via WebRTC
	})
}

/**
 * Socket.IO connection handler
 */
io.on('connection', (socket) => {
	console.log('🔌 Client connected:', socket.id)

	// Initialize session
	activeSessions.set(socket.id, {
		id: socket.id,
		connectedAt: new Date(),
		activeCallId: null,
	})

	// Make call
	socket.on('make-call', async (data: { to: string; video: boolean }, callback) => {
		try {
			console.log(`📞 Making ${data.video ? 'video' : 'audio'} call to:`, data.to)

			const result = await voiceCall.makeCall(data.to, {
				video: data.video,
				mediaConstraints: {
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
					video: data.video ? {
						width: { ideal: 1280 },
						height: { ideal: 720 },
						frameRate: { ideal: 30 },
					} : false,
				},
			})

			if(result.success) {
				const session = activeSessions.get(socket.id)
				if(session) {
					session.activeCallId = result.callId
				}
			}

			callback(result)
		} catch(error: any) {
			callback({ success: false, error: error.message })
		}
	})

	// Answer call
	socket.on('answer-call', async (data: { callId: string }, callback) => {
		try {
			console.log('📞 Answering call:', data.callId)

			const callInfo = voiceCall.getCallInfo(data.callId)
			if(!callInfo) {
				callback({ success: false, error: 'Call not found' })
				return
			}

			const result = await voiceCall.answerCall(data.callId, {
				video: callInfo.metadata.isVideo,
			})

			if(result.success) {
				const session = activeSessions.get(socket.id)
				if(session) {
					session.activeCallId = data.callId
				}
			}

			callback(result)
		} catch(error: any) {
			callback({ success: false, error: error.message })
		}
	})

	// Reject call
	socket.on('reject-call', async (data: { callId: string }, callback) => {
		try {
			console.log('❌ Rejecting call:', data.callId)
			const result = await voiceCall.rejectCall(data.callId)
			callback(result)
		} catch(error: any) {
			callback({ success: false, error: error.message })
		}
	})

	// End call
	socket.on('end-call', async (data: { callId: string }, callback) => {
		try {
			console.log('📴 Ending call:', data.callId)
			const result = await voiceCall.endCall(data.callId)

			const session = activeSessions.get(socket.id)
			if(session) {
				session.activeCallId = null
			}

			callback(result)
		} catch(error: any) {
			callback({ success: false, error: error.message })
		}
	})

	// Toggle mute
	socket.on('toggle-mute', (data: { callId: string; muted: boolean }) => {
		voiceCall.toggleMute(data.callId, data.muted)
	})

	// Toggle video
	socket.on('toggle-video', (data: { callId: string; enabled: boolean }) => {
		voiceCall.toggleVideo(data.callId, data.enabled)
	})

	// Get active calls
	socket.on('get-active-calls', (callback) => {
		const calls = voiceCall.getActiveCalls()
		callback(calls)
	})

	// Get call history
	socket.on('get-call-history', (callback) => {
		const history = voiceCall.getCallHistory()
		callback(history)
	})

	// WebRTC signaling
	socket.on('webrtc-signal', (data: { callId: string; signal: any }) => {
		// Forward WebRTC signaling between peers
		socket.broadcast.emit('webrtc-signal', data)
	})

	// Disconnect
	socket.on('disconnect', () => {
		console.log('🔌 Client disconnected:', socket.id)

		const session = activeSessions.get(socket.id)
		if(session?.activeCallId) {
			// End active call on disconnect
			voiceCall.endCall(session.activeCallId, 'client-disconnected')
		}

		activeSessions.delete(socket.id)
	})
})

/**
 * REST API endpoints
 */

// Health check
app.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		whatsapp: waSocket ? 'connected' : 'disconnected',
		activeCalls: voiceCall ? voiceCall.getActiveCalls().length : 0,
		activeSessions: activeSessions.size,
	})
})

// Get active calls
app.get('/api/calls/active', (req, res) => {
	if(!voiceCall) {
		return res.status(503).json({ error: 'VoiceCall not initialized' })
	}
	res.json(voiceCall.getActiveCalls())
})

// Get call history
app.get('/api/calls/history', (req, res) => {
	if(!voiceCall) {
		return res.status(503).json({ error: 'VoiceCall not initialized' })
	}
	res.json(voiceCall.getCallHistory())
})

// Make call via REST
app.post('/api/calls/make', async (req, res) => {
	if(!voiceCall) {
		return res.status(503).json({ error: 'VoiceCall not initialized' })
	}

	const { to, video } = req.body

	if(!to) {
		return res.status(400).json({ error: 'Missing "to" parameter' })
	}

	try {
		const result = await voiceCall.makeCall(to, { video: video ?? false })
		res.json(result)
	} catch(error: any) {
		res.status(500).json({ error: error.message })
	}
})

// End call via REST
app.post('/api/calls/:callId/end', async (req, res) => {
	if(!voiceCall) {
		return res.status(503).json({ error: 'VoiceCall not initialized' })
	}

	const { callId } = req.params

	try {
		const result = await voiceCall.endCall(callId)
		res.json(result)
	} catch(error: any) {
		res.status(500).json({ error: error.message })
	}
})

/**
 * Start server
 */
const PORT = process.env.PORT || 3000

async function start() {
	try {
		await initializeWhatsApp()

		httpServer.listen(PORT, () => {
			console.log('🚀 Server started on port', PORT)
			console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`)
			console.log(`🌐 HTTP endpoint: http://localhost:${PORT}`)
		})
	} catch(error) {
		console.error('❌ Failed to start server:', error)
		process.exit(1)
	}
}

start()

// Graceful shutdown
process.on('SIGINT', () => {
	console.log('\n👋 Shutting down gracefully...')
	if(voiceCall) {
		voiceCall.destroy()
	}
	httpServer.close(() => {
		console.log('✅ Server closed')
		process.exit(0)
	})
})
