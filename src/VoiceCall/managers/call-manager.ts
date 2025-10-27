/**
 * Call Manager
 * Central manager for voice/video calls
 * Orchestrates WebRTC, signaling, and media processing
 */

import type { WASocket } from '../../Types'
import type { WACallEvent } from '../../Types/Call'
import type {
	CallInfo,
	CallState,
	CallDirection,
	CallOptions,
	CallManagerConfig,
	CallActionResult,
	CallHistoryEntry,
	CallQualityMetrics,
	MediaType,
	CallParticipant,
} from '../types'
import { EventEmitter } from 'events'
import { WebRTCHandler } from '../handlers/webrtc-handler'
import { SignalingHandler } from '../handlers/signaling-handler'
import { AudioVideoProcessor } from '../processors/audio-video-processor'

/**
 * CallManager handles all call lifecycle operations
 */
export class CallManager extends EventEmitter {
	private socket: WASocket
	private config: Required<CallManagerConfig>
	private signalingHandler: SignalingHandler
	private audioVideoProcessor: AudioVideoProcessor
	private activeCalls: Map<string, ActiveCall> = new Map()
	private callHistory: CallHistoryEntry[] = []
	private qualityMonitorIntervals: Map<string, NodeJS.Timeout> = new Map()

	constructor(socket: WASocket, config?: CallManagerConfig) {
		super()
		this.socket = socket
		this.config = this.normalizeConfig(config)

		// Initialize handlers
		this.signalingHandler = new SignalingHandler(socket)
		this.audioVideoProcessor = new AudioVideoProcessor()

		// Setup event listeners
		this.setupEventListeners()
	}

	/**
	 * Normalize configuration with defaults
	 */
	private normalizeConfig(config?: CallManagerConfig): Required<CallManagerConfig> {
		return {
			defaultWebRTCConfig: config?.defaultWebRTCConfig || {
				iceServers: [
					{ urls: 'stun:stun.l.google.com:19302' },
					{ urls: 'stun:stun1.l.google.com:19302' },
				],
			},
			defaultMediaConstraints: config?.defaultMediaConstraints || {
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
				video: {
					width: { ideal: 1280 },
					height: { ideal: 720 },
					frameRate: { ideal: 30 },
				},
			},
			defaultCallTimeout: config?.defaultCallTimeout || 60000, // 60 seconds
			maxConcurrentCalls: config?.maxConcurrentCalls || 1,
			enableRecordingByDefault: config?.enableRecordingByDefault || false,
			enableQualityMonitoring: config?.enableQualityMonitoring ?? true,
			qualityMonitoringInterval: config?.qualityMonitoringInterval || 5000,
			enableCallLogs: config?.enableCallLogs ?? true,
			callLogsRetentionDays: config?.callLogsRetentionDays || 30,
		}
	}

	/**
	 * Setup event listeners for signaling
	 */
	private setupEventListeners(): void {
		// Handle incoming calls
		this.signalingHandler.on('incoming-call', (event: WACallEvent) => {
			this.handleIncomingCall(event)
		})

		// Handle call status updates
		this.signalingHandler.on('call-status-update', (event: WACallEvent) => {
			this.handleCallStatusUpdate(event)
		})

		// Handle signaling messages
		this.signalingHandler.on('signaling-message', async(message) => {
			await this.handleSignalingMessage(message)
		})

		// Handle errors
		this.signalingHandler.on('error', (error) => {
			this.emit('error', error)
		})
	}

	/**
	 * Make an outgoing call
	 */
	async makeCall(remoteJid: string, options?: CallOptions): Promise<CallActionResult> {
		try {
			// Check concurrent call limit
			if(this.activeCalls.size >= this.config.maxConcurrentCalls) {
				throw new Error('Maximum concurrent calls reached')
			}

			const isVideo = options?.video ?? false
			const mediaType: MediaType = isVideo ? 'audio-video' : 'audio'

			// Create media constraints
			const mediaConstraints = options?.mediaConstraints || {
				audio: this.config.defaultMediaConstraints.audio,
				video: isVideo ? this.config.defaultMediaConstraints.video : false,
			}

			// Get local media stream
			const localStream = await this.audioVideoProcessor.getUserMedia(mediaConstraints)

			// Apply audio processing
			const processedStream = this.audioVideoProcessor.applyAudioProcessing(localStream)

			// Send call offer via WhatsApp
			const { id: callId } = await this.signalingHandler.sendCallOffer(remoteJid, isVideo)

			// Create WebRTC handler
			const webrtc = new WebRTCHandler(
				callId,
				options?.webrtcConfig || this.config.defaultWebRTCConfig
			)
			await webrtc.initialize()

			// Add local stream to WebRTC
			await webrtc.addLocalStream(mediaConstraints)

			// Setup WebRTC event handlers
			this.setupWebRTCHandlers(callId, webrtc)

			// Create call info
			const callInfo: CallInfo = {
				id: callId,
				direction: 'outgoing',
				state: 'initiating',
				remoteJid,
				remoteParticipant: {
					jid: remoteJid,
					isMe: false,
					isMuted: false,
					isVideoEnabled: isVideo,
				},
				localParticipant: {
					jid: this.socket.authState.creds.me!.id,
					isMe: true,
					stream: processedStream,
					isMuted: options?.startAudioMuted ?? false,
					isVideoEnabled: isVideo && !(options?.startVideoMuted ?? false),
				},
				isGroup: remoteJid.endsWith('@g.us'),
				mediaType,
				timestamps: {
					initiated: new Date(),
				},
				duration: 0,
				metadata: {
					isVideo,
					isAudioMuted: options?.startAudioMuted ?? false,
					isVideoMuted: options?.startVideoMuted ?? false,
					isOnSpeaker: false,
					isRecording: false,
				},
			}

			// Store active call
			this.activeCalls.set(callId, {
				info: callInfo,
				webrtc,
				timeout: this.createCallTimeout(callId, options?.timeout),
			})

			// Update state to ringing
			this.updateCallState(callId, 'ringing')

			// Emit event
			this.emit('call:ringing', callInfo)

			// Create SDP offer
			const sdpOffer = await webrtc.createOffer()
			await this.signalingHandler.sendSignalingData(callId, remoteJid, sdpOffer)

			return {
				success: true,
				callId,
				message: 'Call initiated successfully',
			}
		} catch(error) {
			return {
				success: false,
				error: error as Error,
				message: (error as Error).message,
			}
		}
	}

	/**
	 * Answer an incoming call
	 */
	async answerCall(callId: string, options?: CallOptions): Promise<CallActionResult> {
		try {
			const activeCall = this.activeCalls.get(callId)
			if(!activeCall) {
				throw new Error('Call not found')
			}

			const { info } = activeCall
			const isVideo = info.metadata.isVideo

			// Create media constraints
			const mediaConstraints = options?.mediaConstraints || {
				audio: this.config.defaultMediaConstraints.audio,
				video: isVideo ? this.config.defaultMediaConstraints.video : false,
			}

			// Get local media stream
			const localStream = await this.audioVideoProcessor.getUserMedia(mediaConstraints)

			// Apply audio processing
			const processedStream = this.audioVideoProcessor.applyAudioProcessing(localStream)

			// Create WebRTC handler if not exists
			if(!activeCall.webrtc) {
				const webrtc = new WebRTCHandler(
					callId,
					options?.webrtcConfig || this.config.defaultWebRTCConfig
				)
				await webrtc.initialize()
				activeCall.webrtc = webrtc

				// Setup WebRTC event handlers
				this.setupWebRTCHandlers(callId, webrtc)
			}

			// Add local stream
			await activeCall.webrtc.addLocalStream(mediaConstraints)

			// Update call info
			info.localParticipant.stream = processedStream
			info.localParticipant.isMuted = options?.startAudioMuted ?? false
			info.localParticipant.isVideoEnabled = isVideo && !(options?.startVideoMuted ?? false)
			info.timestamps.connected = new Date()

			// Create SDP answer
			const sdpAnswer = await activeCall.webrtc.createAnswer()

			// Accept call via WhatsApp
			await this.signalingHandler.acceptCall(callId, info.remoteJid, sdpAnswer)

			// Update state
			this.updateCallState(callId, 'connecting')

			// Start recording if enabled
			if(options?.enableRecording || this.config.enableRecordingByDefault) {
				this.startRecording(callId)
			}

			return {
				success: true,
				callId,
				message: 'Call answered successfully',
			}
		} catch(error) {
			return {
				success: false,
				error: error as Error,
				message: (error as Error).message,
			}
		}
	}

	/**
	 * Reject an incoming call
	 */
	async rejectCall(callId: string): Promise<CallActionResult> {
		try {
			const activeCall = this.activeCalls.get(callId)
			if(!activeCall) {
				throw new Error('Call not found')
			}

			const { info } = activeCall

			// Reject via WhatsApp
			await this.signalingHandler.rejectCall(callId, info.remoteJid)

			// Update state
			this.updateCallState(callId, 'rejected')

			// Cleanup
			await this.endCall(callId, 'rejected')

			return {
				success: true,
				callId,
				message: 'Call rejected successfully',
			}
		} catch(error) {
			return {
				success: false,
				error: error as Error,
				message: (error as Error).message,
			}
		}
	}

	/**
	 * End an active call
	 */
	async endCall(callId: string, reason?: string): Promise<CallActionResult> {
		try {
			const activeCall = this.activeCalls.get(callId)
			if(!activeCall) {
				throw new Error('Call not found')
			}

			const { info, webrtc, timeout } = activeCall

			// Clear timeout
			if(timeout) {
				clearTimeout(timeout)
			}

			// Stop quality monitoring
			this.stopQualityMonitoring(callId)

			// Update state
			this.updateCallState(callId, 'ending')

			// Terminate via WhatsApp
			if(this.signalingHandler.isCallActive(callId)) {
				await this.signalingHandler.terminateCall(callId, info.remoteJid)
			}

			// Close WebRTC connection
			if(webrtc) {
				webrtc.close()
			}

			// Stop recording if active
			if(info.metadata.isRecording) {
				this.stopRecording(callId)
			}

			// Update final state
			info.state = 'ended'
			info.timestamps.ended = new Date()
			info.duration = this.calculateDuration(info)
			info.metadata.endReason = (reason as any) || 'user'

			// Add to history
			if(this.config.enableCallLogs) {
				this.addToHistory(info)
			}

			// Emit event
			this.emit('call:ended', info, reason || 'user')

			// Remove from active calls
			this.activeCalls.delete(callId)

			return {
				success: true,
				callId,
				message: 'Call ended successfully',
			}
		} catch(error) {
			return {
				success: false,
				error: error as Error,
				message: (error as Error).message,
			}
		}
	}

	/**
	 * Toggle audio mute
	 */
	toggleMute(callId: string, muted: boolean): void {
		const activeCall = this.activeCalls.get(callId)
		if(!activeCall) return

		if(activeCall.webrtc) {
			activeCall.webrtc.toggleAudioMute(muted)
		}

		activeCall.info.localParticipant.isMuted = muted
		activeCall.info.metadata.isAudioMuted = muted
	}

	/**
	 * Toggle video enable
	 */
	toggleVideo(callId: string, enabled: boolean): void {
		const activeCall = this.activeCalls.get(callId)
		if(!activeCall) return

		if(activeCall.webrtc) {
			activeCall.webrtc.toggleVideoEnable(enabled)
		}

		activeCall.info.localParticipant.isVideoEnabled = enabled
		activeCall.info.metadata.isVideoMuted = !enabled
	}

	/**
	 * Start call recording
	 */
	startRecording(callId: string): void {
		const activeCall = this.activeCalls.get(callId)
		if(!activeCall || !activeCall.info.localParticipant.stream) return

		this.audioVideoProcessor.startRecording(activeCall.info.localParticipant.stream)
		activeCall.info.metadata.isRecording = true
	}

	/**
	 * Stop call recording
	 */
	stopRecording(callId: string): void {
		const activeCall = this.activeCalls.get(callId)
		if(!activeCall) return

		this.audioVideoProcessor.stopRecording()
		activeCall.info.metadata.isRecording = false
	}

	/**
	 * Get call info
	 */
	getCallInfo(callId: string): CallInfo | null {
		return this.activeCalls.get(callId)?.info || null
	}

	/**
	 * Get all active calls
	 */
	getActiveCalls(): CallInfo[] {
		return Array.from(this.activeCalls.values()).map(call => call.info)
	}

	/**
	 * Get call history
	 */
	getCallHistory(): CallHistoryEntry[] {
		return this.callHistory
	}

	/**
	 * Handle incoming call
	 */
	private async handleIncomingCall(event: WACallEvent): Promise<void> {
		const { id: callId, from: remoteJid, isVideo, isGroup, groupJid } = event

		// Check concurrent call limit
		if(this.activeCalls.size >= this.config.maxConcurrentCalls) {
			// Auto-reject if limit reached
			await this.signalingHandler.rejectCall(callId, remoteJid)
			return
		}

		const mediaType: MediaType = isVideo ? 'audio-video' : 'audio'

		// Create call info
		const callInfo: CallInfo = {
			id: callId,
			direction: 'incoming',
			state: 'ringing',
			remoteJid,
			remoteParticipant: {
				jid: remoteJid,
				isMe: false,
				isMuted: false,
				isVideoEnabled: isVideo ?? false,
			},
			localParticipant: {
				jid: this.socket.authState.creds.me!.id,
				isMe: true,
				isMuted: false,
				isVideoEnabled: false,
			},
			isGroup: isGroup ?? false,
			groupJid,
			mediaType,
			timestamps: {
				ringing: new Date(),
			},
			duration: 0,
			metadata: {
				isVideo: isVideo ?? false,
				isAudioMuted: false,
				isVideoMuted: false,
				isOnSpeaker: false,
				isRecording: false,
			},
		}

		// Store active call (without WebRTC yet, will be created on answer)
		this.activeCalls.set(callId, {
			info: callInfo,
			webrtc: null,
			timeout: this.createCallTimeout(callId),
		})

		// Emit incoming call event
		this.emit('call:incoming', callInfo)
	}

	/**
	 * Handle call status updates
	 */
	private handleCallStatusUpdate(event: WACallEvent): void {
		const { id: callId, status } = event
		const activeCall = this.activeCalls.get(callId)

		if(!activeCall) return

		// Map WhatsApp status to our CallState
		const stateMap: Record<string, CallState> = {
			offer: 'ringing',
			ringing: 'ringing',
			accept: 'connecting',
			reject: 'rejected',
			terminate: 'ended',
			timeout: 'timeout',
		}

		const newState = stateMap[status]
		if(newState) {
			this.updateCallState(callId, newState)
		}
	}

	/**
	 * Handle signaling messages for WebRTC
	 */
	private async handleSignalingMessage(message: any): Promise<void> {
		// Process SDP offers, answers, and ICE candidates
		// This integrates with the WebRTCHandler
		if(message.type === 'offer' || message.type === 'answer') {
			const { callId } = message.data
			const activeCall = this.activeCalls.get(callId)

			if(activeCall?.webrtc) {
				await activeCall.webrtc.setRemoteDescription(message.data)
			}
		} else if(message.type === 'ice-candidate') {
			const { callId, candidate } = message.data
			const activeCall = this.activeCalls.get(callId)

			if(activeCall?.webrtc) {
				await activeCall.webrtc.addIceCandidate(candidate)
			}
		}
	}

	/**
	 * Setup WebRTC handler events
	 */
	private setupWebRTCHandlers(callId: string, webrtc: WebRTCHandler): void {
		// Remote stream received
		webrtc.on('remote-stream', (stream) => {
			const activeCall = this.activeCalls.get(callId)
			if(activeCall) {
				activeCall.info.remoteParticipant.stream = stream
				this.emit('call:remote-stream', activeCall.info, stream)
			}
		})

		// Connection state changed
		webrtc.on('connection-state-change', (state) => {
			const activeCall = this.activeCalls.get(callId)
			if(!activeCall) return

			if(state === 'connected') {
				this.updateCallState(callId, 'active')
				if(this.config.enableQualityMonitoring) {
					this.startQualityMonitoring(callId)
				}
			} else if(state === 'disconnected' || state === 'failed') {
				this.updateCallState(callId, 'ended')
				this.endCall(callId, 'error')
			}
		})

		// ICE candidate generated
		webrtc.on('ice-candidate', async(candidate) => {
			const activeCall = this.activeCalls.get(callId)
			if(activeCall) {
				await this.signalingHandler.sendSignalingData(
					callId,
					activeCall.info.remoteJid,
					{ candidate, callId }
				)
			}
		})

		// Quality metrics
		webrtc.on('quality-metrics', (metrics) => {
			const activeCall = this.activeCalls.get(callId)
			if(activeCall) {
				activeCall.info.qualityMetrics = metrics
				this.emit('call:quality-update', activeCall.info, metrics)
			}
		})

		// Errors
		webrtc.on('error', (error) => {
			this.emit('call:failed', this.activeCalls.get(callId)?.info, error)
		})
	}

	/**
	 * Update call state
	 */
	private updateCallState(callId: string, newState: CallState): void {
		const activeCall = this.activeCalls.get(callId)
		if(!activeCall) return

		const previousState = activeCall.info.state
		activeCall.info.state = newState

		this.emit('call:state-change', activeCall.info, previousState)

		// Emit specific state events
		if(newState === 'active') {
			this.emit('call:connected', activeCall.info)
		} else if(newState === 'ended') {
			this.emit('call:ended', activeCall.info, 'state-change')
		} else if(newState === 'failed') {
			this.emit('call:failed', activeCall.info, new Error('Call failed'))
		} else if(newState === 'rejected') {
			this.emit('call:rejected', activeCall.info)
		} else if(newState === 'missed') {
			this.emit('call:missed', activeCall.info)
		}
	}

	/**
	 * Create call timeout
	 */
	private createCallTimeout(callId: string, timeout?: number): NodeJS.Timeout {
		return setTimeout(() => {
			const activeCall = this.activeCalls.get(callId)
			if(activeCall && activeCall.info.state !== 'active') {
				this.updateCallState(callId, 'timeout')
				this.endCall(callId, 'timeout')
			}
		}, timeout || this.config.defaultCallTimeout)
	}

	/**
	 * Start quality monitoring
	 */
	private startQualityMonitoring(callId: string): void {
		const interval = setInterval(async() => {
			const activeCall = this.activeCalls.get(callId)
			if(!activeCall?.webrtc) {
				clearInterval(interval)
				return
			}

			const metrics = await activeCall.webrtc.getQualityMetrics()
			if(metrics) {
				activeCall.info.qualityMetrics = metrics
				this.emit('call:quality-update', activeCall.info, metrics)
			}
		}, this.config.qualityMonitoringInterval)

		this.qualityMonitorIntervals.set(callId, interval)
	}

	/**
	 * Stop quality monitoring
	 */
	private stopQualityMonitoring(callId: string): void {
		const interval = this.qualityMonitorIntervals.get(callId)
		if(interval) {
			clearInterval(interval)
			this.qualityMonitorIntervals.delete(callId)
		}
	}

	/**
	 * Calculate call duration
	 */
	private calculateDuration(callInfo: CallInfo): number {
		if(!callInfo.timestamps.connected || !callInfo.timestamps.ended) {
			return 0
		}
		return Math.floor(
			(callInfo.timestamps.ended.getTime() - callInfo.timestamps.connected.getTime()) / 1000
		)
	}

	/**
	 * Add call to history
	 */
	private addToHistory(callInfo: CallInfo): void {
		const entry: CallHistoryEntry = {
			callId: callInfo.id,
			remoteJid: callInfo.remoteJid,
			direction: callInfo.direction,
			mediaType: callInfo.mediaType,
			state: callInfo.state,
			startTime: callInfo.timestamps.initiated || callInfo.timestamps.ringing!,
			endTime: callInfo.timestamps.ended,
			duration: callInfo.duration,
			endReason: callInfo.metadata.endReason,
			qualityMetrics: callInfo.qualityMetrics,
		}

		this.callHistory.unshift(entry)

		// Keep only recent history based on retention days
		const cutoffDate = new Date()
		cutoffDate.setDate(cutoffDate.getDate() - this.config.callLogsRetentionDays)

		this.callHistory = this.callHistory.filter(
			h => h.startTime >= cutoffDate
		)
	}

	/**
	 * Cleanup and destroy
	 */
	destroy(): void {
		// End all active calls
		for(const callId of this.activeCalls.keys()) {
			this.endCall(callId, 'destroyed')
		}

		// Stop all quality monitoring
		for(const interval of this.qualityMonitorIntervals.values()) {
			clearInterval(interval)
		}
		this.qualityMonitorIntervals.clear()

		// Cleanup handlers
		this.signalingHandler.destroy()
		this.audioVideoProcessor.cleanup()

		// Clear data
		this.activeCalls.clear()
		this.callHistory = []

		this.removeAllListeners()
	}
}

/** Internal active call structure */
interface ActiveCall {
	info: CallInfo
	webrtc: WebRTCHandler | null
	timeout?: NodeJS.Timeout
}
