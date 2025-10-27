/**
 * WebRTC Handler
 * Manages WebRTC peer connections, SDP negotiation, and ICE candidates
 */

import type {
	WebRTCConfig,
	MediaConstraints,
	CallQualityMetrics,
	SDPMessage,
	ICECandidateMessage,
} from '../types'
import { EventEmitter } from 'events'

/** Default STUN servers configuration */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' },
	{ urls: 'stun:stun2.l.google.com:19302' },
	{ urls: 'stun:stun3.l.google.com:19302' },
	{ urls: 'stun:stun4.l.google.com:19302' },
]

/** WebRTC Handler Events */
export interface WebRTCHandlerEvents {
	'local-stream': (stream: MediaStream) => void
	'remote-stream': (stream: MediaStream) => void
	'ice-candidate': (candidate: RTCIceCandidate) => void
	'connection-state-change': (state: RTCPeerConnectionState) => void
	'ice-connection-state-change': (state: RTCIceConnectionState) => void
	'signaling-state-change': (state: RTCSignalingState) => void
	'negotiation-needed': () => void
	'data-channel': (channel: RTCDataChannel) => void
	'error': (error: Error) => void
	'quality-metrics': (metrics: CallQualityMetrics) => void
}

export class WebRTCHandler extends EventEmitter {
	private peerConnection: RTCPeerConnection | null = null
	private localStream: MediaStream | null = null
	private remoteStream: MediaStream | null = null
	private dataChannel: RTCDataChannel | null = null
	private config: WebRTCConfig
	private callId: string
	private qualityMonitorInterval: NodeJS.Timeout | null = null
	private iceCandidateQueue: RTCIceCandidate[] = []
	private isRemoteDescriptionSet = false

	constructor(callId: string, config?: Partial<WebRTCConfig>) {
		super()
		this.callId = callId
		this.config = {
			iceServers: config?.iceServers || DEFAULT_ICE_SERVERS,
			iceTransportPolicy: config?.iceTransportPolicy || 'all',
			bundlePolicy: config?.bundlePolicy || 'balanced',
			rtcpMuxPolicy: config?.rtcpMuxPolicy || 'require',
		}
	}

	/**
	 * Initialize peer connection
	 */
	async initialize(): Promise<void> {
		try {
			this.peerConnection = new RTCPeerConnection(this.config)
			this.setupPeerConnectionHandlers()
			this.emit('initialized')
		} catch(error) {
			this.emit('error', error)
			throw error
		}
	}

	/**
	 * Setup peer connection event handlers
	 */
	private setupPeerConnectionHandlers(): void {
		if(!this.peerConnection) return

		// ICE candidate handler
		this.peerConnection.onicecandidate = (event) => {
			if(event.candidate) {
				this.emit('ice-candidate', event.candidate)
			}
		}

		// Track handler (remote stream)
		this.peerConnection.ontrack = (event) => {
			if(!this.remoteStream) {
				this.remoteStream = new MediaStream()
			}
			event.streams[0].getTracks().forEach(track => {
				this.remoteStream!.addTrack(track)
			})
			this.emit('remote-stream', this.remoteStream)
		}

		// Connection state change
		this.peerConnection.onconnectionstatechange = () => {
			const state = this.peerConnection!.connectionState
			this.emit('connection-state-change', state)

			if(state === 'connected') {
				this.startQualityMonitoring()
			} else if(state === 'disconnected' || state === 'failed' || state === 'closed') {
				this.stopQualityMonitoring()
			}
		}

		// ICE connection state change
		this.peerConnection.oniceconnectionstatechange = () => {
			const state = this.peerConnection!.iceConnectionState
			this.emit('ice-connection-state-change', state)
		}

		// Signaling state change
		this.peerConnection.onsignalingstatechange = () => {
			const state = this.peerConnection!.signalingState
			this.emit('signaling-state-change', state)

			// Process queued ICE candidates when remote description is set
			if(state === 'stable' || state === 'have-remote-offer') {
				this.processQueuedIceCandidates()
			}
		}

		// Negotiation needed
		this.peerConnection.onnegotiationneeded = () => {
			this.emit('negotiation-needed')
		}

		// Data channel
		this.peerConnection.ondatachannel = (event) => {
			this.dataChannel = event.channel
			this.setupDataChannel()
			this.emit('data-channel', event.channel)
		}
	}

	/**
	 * Setup data channel for call metadata
	 */
	private setupDataChannel(): void {
		if(!this.dataChannel) return

		this.dataChannel.onopen = () => {
			console.log('Data channel opened')
		}

		this.dataChannel.onclose = () => {
			console.log('Data channel closed')
		}

		this.dataChannel.onerror = (error) => {
			console.error('Data channel error:', error)
		}

		this.dataChannel.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data)
				this.handleDataChannelMessage(message)
			} catch(error) {
				console.error('Error parsing data channel message:', error)
			}
		}
	}

	/**
	 * Handle data channel messages
	 */
	private handleDataChannelMessage(message: any): void {
		// Handle custom messages (e.g., quality updates, metadata)
		console.log('Data channel message:', message)
	}

	/**
	 * Create and add local media stream
	 */
	async addLocalStream(constraints: MediaConstraints): Promise<MediaStream> {
		try {
			this.localStream = await navigator.mediaDevices.getUserMedia(constraints)

			if(!this.peerConnection) {
				throw new Error('Peer connection not initialized')
			}

			// Add tracks to peer connection
			this.localStream.getTracks().forEach(track => {
				this.peerConnection!.addTrack(track, this.localStream!)
			})

			this.emit('local-stream', this.localStream)
			return this.localStream
		} catch(error) {
			this.emit('error', error as Error)
			throw error
		}
	}

	/**
	 * Create SDP offer
	 */
	async createOffer(): Promise<SDPMessage> {
		if(!this.peerConnection) {
			throw new Error('Peer connection not initialized')
		}

		try {
			const offer = await this.peerConnection.createOffer({
				offerToReceiveAudio: true,
				offerToReceiveVideo: true,
			})

			await this.peerConnection.setLocalDescription(offer)

			return {
				type: 'offer',
				sdp: offer.sdp!,
				callId: this.callId,
			}
		} catch(error) {
			this.emit('error', error as Error)
			throw error
		}
	}

	/**
	 * Create SDP answer
	 */
	async createAnswer(): Promise<SDPMessage> {
		if(!this.peerConnection) {
			throw new Error('Peer connection not initialized')
		}

		try {
			const answer = await this.peerConnection.createAnswer()
			await this.peerConnection.setLocalDescription(answer)

			return {
				type: 'answer',
				sdp: answer.sdp!,
				callId: this.callId,
			}
		} catch(error) {
			this.emit('error', error as Error)
			throw error
		}
	}

	/**
	 * Set remote SDP description
	 */
	async setRemoteDescription(sdp: SDPMessage): Promise<void> {
		if(!this.peerConnection) {
			throw new Error('Peer connection not initialized')
		}

		try {
			await this.peerConnection.setRemoteDescription(
				new RTCSessionDescription({ type: sdp.type, sdp: sdp.sdp })
			)
			this.isRemoteDescriptionSet = true
			this.processQueuedIceCandidates()
		} catch(error) {
			this.emit('error', error as Error)
			throw error
		}
	}

	/**
	 * Add ICE candidate
	 */
	async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
		if(!this.peerConnection) {
			throw new Error('Peer connection not initialized')
		}

		try {
			const iceCandidate = new RTCIceCandidate(candidate)

			// Queue candidates if remote description not set yet
			if(!this.isRemoteDescriptionSet && this.peerConnection.remoteDescription === null) {
				this.iceCandidateQueue.push(iceCandidate)
				return
			}

			await this.peerConnection.addIceCandidate(iceCandidate)
		} catch(error) {
			this.emit('error', error as Error)
			throw error
		}
	}

	/**
	 * Process queued ICE candidates
	 */
	private async processQueuedIceCandidates(): Promise<void> {
		if(!this.isRemoteDescriptionSet || !this.peerConnection?.remoteDescription) {
			return
		}

		while(this.iceCandidateQueue.length > 0) {
			const candidate = this.iceCandidateQueue.shift()
			if(candidate) {
				try {
					await this.peerConnection.addIceCandidate(candidate)
				} catch(error) {
					console.error('Error adding queued ICE candidate:', error)
				}
			}
		}
	}

	/**
	 * Toggle audio mute
	 */
	toggleAudioMute(muted: boolean): void {
		if(!this.localStream) return

		this.localStream.getAudioTracks().forEach(track => {
			track.enabled = !muted
		})
	}

	/**
	 * Toggle video enable
	 */
	toggleVideoEnable(enabled: boolean): void {
		if(!this.localStream) return

		this.localStream.getVideoTracks().forEach(track => {
			track.enabled = enabled
		})
	}

	/**
	 * Start quality monitoring
	 */
	private startQualityMonitoring(): void {
		if(this.qualityMonitorInterval) return

		this.qualityMonitorInterval = setInterval(async() => {
			const metrics = await this.getQualityMetrics()
			if(metrics) {
				this.emit('quality-metrics', metrics)
			}
		}, 5000) // Update every 5 seconds
	}

	/**
	 * Stop quality monitoring
	 */
	private stopQualityMonitoring(): void {
		if(this.qualityMonitorInterval) {
			clearInterval(this.qualityMonitorInterval)
			this.qualityMonitorInterval = null
		}
	}

	/**
	 * Get call quality metrics
	 */
	async getQualityMetrics(): Promise<CallQualityMetrics | null> {
		if(!this.peerConnection) return null

		try {
			const stats = await this.peerConnection.getStats()
			const metrics: Partial<CallQualityMetrics> = {
				audio: {
					bitrate: 0,
					packetsLost: 0,
					packetsReceived: 0,
					jitter: 0,
					latency: 0,
					codec: '',
				},
				connection: {
					type: this.peerConnection.iceConnectionState,
					candidateType: '',
					protocol: '',
					localAddress: '',
					remoteAddress: '',
				},
			}

			stats.forEach(stat => {
				if(stat.type === 'inbound-rtp') {
					if(stat.kind === 'audio') {
						metrics.audio!.packetsReceived = stat.packetsReceived || 0
						metrics.audio!.packetsLost = stat.packetsLost || 0
						metrics.audio!.jitter = (stat.jitter || 0) * 1000 // Convert to ms
					} else if(stat.kind === 'video' && stat.frameWidth) {
						if(!metrics.video) {
							metrics.video = {
								bitrate: 0,
								packetsLost: 0,
								packetsReceived: 0,
								frameRate: 0,
								resolution: { width: 0, height: 0 },
								codec: '',
							}
						}
						metrics.video.packetsReceived = stat.packetsReceived || 0
						metrics.video.packetsLost = stat.packetsLost || 0
						metrics.video.frameRate = stat.framesPerSecond || 0
						metrics.video.resolution = {
							width: stat.frameWidth || 0,
							height: stat.frameHeight || 0,
						}
					}
				}

				if(stat.type === 'candidate-pair' && stat.state === 'succeeded') {
					metrics.connection!.candidateType = stat.candidateType || ''
					metrics.connection!.protocol = stat.protocol || ''
				}

				if(stat.type === 'codec') {
					if(stat.mimeType?.includes('audio')) {
						metrics.audio!.codec = stat.mimeType
					} else if(stat.mimeType?.includes('video') && metrics.video) {
						metrics.video.codec = stat.mimeType
					}
				}
			})

			return metrics as CallQualityMetrics
		} catch(error) {
			console.error('Error getting quality metrics:', error)
			return null
		}
	}

	/**
	 * Get local stream
	 */
	getLocalStream(): MediaStream | null {
		return this.localStream
	}

	/**
	 * Get remote stream
	 */
	getRemoteStream(): MediaStream | null {
		return this.remoteStream
	}

	/**
	 * Send data channel message
	 */
	sendDataChannelMessage(message: any): void {
		if(this.dataChannel && this.dataChannel.readyState === 'open') {
			this.dataChannel.send(JSON.stringify(message))
		}
	}

	/**
	 * Close connection and cleanup
	 */
	close(): void {
		this.stopQualityMonitoring()

		if(this.dataChannel) {
			this.dataChannel.close()
			this.dataChannel = null
		}

		if(this.localStream) {
			this.localStream.getTracks().forEach(track => track.stop())
			this.localStream = null
		}

		if(this.remoteStream) {
			this.remoteStream.getTracks().forEach(track => track.stop())
			this.remoteStream = null
		}

		if(this.peerConnection) {
			this.peerConnection.close()
			this.peerConnection = null
		}

		this.iceCandidateQueue = []
		this.isRemoteDescriptionSet = false
		this.removeAllListeners()
	}
}
