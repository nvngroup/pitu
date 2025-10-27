/**
 * Voice Call Module for Pitu/Baileys
 * Complete voice and video calling solution
 *
 * @module VoiceCall
 * @author Pitu Team
 * @license MIT
 */

import type { WASocket } from '../Types'
import type {
	CallInfo,
	CallOptions,
	CallManagerConfig,
	CallActionResult,
	CallHistoryEntry,
	CallEvents,
} from './types'
import { CallManager } from './managers/call-manager'
import { EventEmitter } from 'events'

/**
 * VoiceCall - Main interface for voice/video calling
 */
export class VoiceCall extends EventEmitter {
	private callManager: CallManager

	constructor(socket: WASocket, config?: CallManagerConfig) {
		super()
		this.callManager = new CallManager(socket, config)
		this.setupEventForwarding()
	}

	/**
	 * Forward CallManager events to VoiceCall instance
	 */
	private setupEventForwarding(): void {
		// Forward all call events
		const events: (keyof CallEvents)[] = [
			'call:state-change',
			'call:incoming',
			'call:ringing',
			'call:connected',
			'call:ended',
			'call:failed',
			'call:rejected',
			'call:missed',
			'call:remote-stream',
			'call:local-stream',
			'call:quality-update',
			'call:participant-joined',
			'call:participant-left',
			'call:participant-audio-change',
			'call:participant-video-change',
		]

		events.forEach(event => {
			this.callManager.on(event, (...args: any[]) => {
				this.emit(event, ...args)
			})
		})
	}

	/**
	 * Make an outgoing call
	 *
	 * @param remoteJid - Remote user JID (e.g., '5511999999999@s.whatsapp.net')
	 * @param options - Call options
	 * @returns Promise with call action result
	 *
	 * @example
	 * ```typescript
	 * const result = await voiceCall.makeCall('5511999999999@s.whatsapp.net', {
	 *   video: true,
	 *   startAudioMuted: false
	 * })
	 *
	 * if (result.success) {
	 *   console.log('Call started:', result.callId)
	 * }
	 * ```
	 */
	async makeCall(remoteJid: string, options?: CallOptions): Promise<CallActionResult> {
		return this.callManager.makeCall(remoteJid, options)
	}

	/**
	 * Answer an incoming call
	 *
	 * @param callId - Call ID
	 * @param options - Call options
	 * @returns Promise with call action result
	 *
	 * @example
	 * ```typescript
	 * voiceCall.on('call:incoming', async (callInfo) => {
	 *   const result = await voiceCall.answerCall(callInfo.id, {
	 *     video: callInfo.metadata.isVideo
	 *   })
	 * })
	 * ```
	 */
	async answerCall(callId: string, options?: CallOptions): Promise<CallActionResult> {
		return this.callManager.answerCall(callId, options)
	}

	/**
	 * Reject an incoming call
	 *
	 * @param callId - Call ID
	 * @returns Promise with call action result
	 *
	 * @example
	 * ```typescript
	 * voiceCall.on('call:incoming', async (callInfo) => {
	 *   await voiceCall.rejectCall(callInfo.id)
	 * })
	 * ```
	 */
	async rejectCall(callId: string): Promise<CallActionResult> {
		return this.callManager.rejectCall(callId)
	}

	/**
	 * End an active call
	 *
	 * @param callId - Call ID
	 * @param reason - End reason (optional)
	 * @returns Promise with call action result
	 *
	 * @example
	 * ```typescript
	 * await voiceCall.endCall(callId, 'user-requested')
	 * ```
	 */
	async endCall(callId: string, reason?: string): Promise<CallActionResult> {
		return this.callManager.endCall(callId, reason)
	}

	/**
	 * Toggle audio mute in an active call
	 *
	 * @param callId - Call ID
	 * @param muted - True to mute, false to unmute
	 *
	 * @example
	 * ```typescript
	 * voiceCall.toggleMute(callId, true) // Mute
	 * voiceCall.toggleMute(callId, false) // Unmute
	 * ```
	 */
	toggleMute(callId: string, muted: boolean): void {
		this.callManager.toggleMute(callId, muted)
	}

	/**
	 * Toggle video in an active call
	 *
	 * @param callId - Call ID
	 * @param enabled - True to enable video, false to disable
	 *
	 * @example
	 * ```typescript
	 * voiceCall.toggleVideo(callId, true) // Enable video
	 * voiceCall.toggleVideo(callId, false) // Disable video
	 * ```
	 */
	toggleVideo(callId: string, enabled: boolean): void {
		this.callManager.toggleVideo(callId, enabled)
	}

	/**
	 * Start recording an active call
	 *
	 * @param callId - Call ID
	 *
	 * @example
	 * ```typescript
	 * voiceCall.startRecording(callId)
	 * ```
	 */
	startRecording(callId: string): void {
		this.callManager.startRecording(callId)
	}

	/**
	 * Stop recording an active call
	 *
	 * @param callId - Call ID
	 *
	 * @example
	 * ```typescript
	 * voiceCall.stopRecording(callId)
	 * ```
	 */
	stopRecording(callId: string): void {
		this.callManager.stopRecording(callId)
	}

	/**
	 * Get information about a specific call
	 *
	 * @param callId - Call ID
	 * @returns Call information or null if not found
	 *
	 * @example
	 * ```typescript
	 * const callInfo = voiceCall.getCallInfo(callId)
	 * if (callInfo) {
	 *   console.log('Call state:', callInfo.state)
	 *   console.log('Duration:', callInfo.duration, 'seconds')
	 * }
	 * ```
	 */
	getCallInfo(callId: string): CallInfo | null {
		return this.callManager.getCallInfo(callId)
	}

	/**
	 * Get all active calls
	 *
	 * @returns Array of active call information
	 *
	 * @example
	 * ```typescript
	 * const activeCalls = voiceCall.getActiveCalls()
	 * console.log('Active calls:', activeCalls.length)
	 * ```
	 */
	getActiveCalls(): CallInfo[] {
		return this.callManager.getActiveCalls()
	}

	/**
	 * Get call history
	 *
	 * @returns Array of call history entries
	 *
	 * @example
	 * ```typescript
	 * const history = voiceCall.getCallHistory()
	 * history.forEach(entry => {
	 *   console.log(`${entry.direction} call to ${entry.remoteJid}`)
	 *   console.log(`Duration: ${entry.duration}s`)
	 * })
	 * ```
	 */
	getCallHistory(): CallHistoryEntry[] {
		return this.callManager.getCallHistory()
	}

	/**
	 * Destroy and cleanup all resources
	 *
	 * @example
	 * ```typescript
	 * voiceCall.destroy()
	 * ```
	 */
	destroy(): void {
		this.callManager.destroy()
		this.removeAllListeners()
	}
}

/**
 * Initialize VoiceCall for a WhatsApp socket
 *
 * @param socket - WASocket instance
 * @param config - Optional configuration
 * @returns VoiceCall instance
 *
 * @example
 * ```typescript
 * import makeWASocket from '@nvngroup/pitu'
 * import { initVoiceCall } from '@nvngroup/pitu/VoiceCall'
 *
 * const sock = makeWASocket({
 *   auth: authState,
 *   printQRInTerminal: true
 * })
 *
 * const voiceCall = initVoiceCall(sock, {
 *   maxConcurrentCalls: 3,
 *   enableQualityMonitoring: true
 * })
 *
 * // Listen for incoming calls
 * voiceCall.on('call:incoming', async (callInfo) => {
 *   console.log('Incoming call from:', callInfo.remoteJid)
 *   await voiceCall.answerCall(callInfo.id)
 * })
 *
 * // Make a call
 * const result = await voiceCall.makeCall('5511999999999@s.whatsapp.net', {
 *   video: true
 * })
 * ```
 */
export function initVoiceCall(socket: WASocket, config?: CallManagerConfig): VoiceCall {
	return new VoiceCall(socket, config)
}

/**
 * Extend WASocket with VoiceCall capabilities
 *
 * @param socket - WASocket instance
 * @param config - Optional configuration
 * @returns Extended socket with voiceCall property
 *
 * @example
 * ```typescript
 * import makeWASocket from '@nvngroup/pitu'
 * import { extendSocketWithVoiceCall } from '@nvngroup/pitu/VoiceCall'
 *
 * const sock = makeWASocket({ auth: authState })
 * const extendedSock = extendSocketWithVoiceCall(sock)
 *
 * // Now you can use sock.voiceCall
 * extendedSock.voiceCall.on('call:incoming', async (callInfo) => {
 *   await extendedSock.voiceCall.answerCall(callInfo.id)
 * })
 * ```
 */
export function extendSocketWithVoiceCall(
	socket: WASocket,
	config?: CallManagerConfig
): WASocket & { voiceCall: VoiceCall } {
	const voiceCall = new VoiceCall(socket, config)
	return Object.assign(socket, { voiceCall })
}

// Export types
export type {
	CallInfo,
	CallState,
	CallDirection,
	MediaType,
	CallQualityMetrics,
	CallParticipant,
	CallOptions,
	CallManagerConfig,
	CallActionResult,
	CallHistoryEntry,
	CallEvents,
	MediaConstraints,
	AudioConstraints,
	VideoConstraints,
	WebRTCConfig,
} from './types'

// Export classes
export { CallManager } from './managers/call-manager'
export { WebRTCHandler } from './handlers/webrtc-handler'
export { SignalingHandler } from './handlers/signaling-handler'
export { AudioVideoProcessor } from './processors/audio-video-processor'
