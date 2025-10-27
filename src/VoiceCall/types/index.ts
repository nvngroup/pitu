/**
 * Voice Call Types for Pitu/Baileys
 * Complete type definitions for audio/video calling system
 */

import type { WACallEvent, WACallUpdateType } from '../../Types/Call'

/** Call State Types */
export type CallState =
	| 'idle'           // No active call
	| 'initiating'     // Starting outgoing call
	| 'ringing'        // Incoming call ringing or outgoing call ringing on remote
	| 'connecting'     // WebRTC connection being established
	| 'active'         // Call in progress
	| 'holding'        // Call on hold
	| 'ending'         // Call being terminated
	| 'ended'          // Call finished
	| 'failed'         // Call failed to establish
	| 'rejected'       // Call was rejected
	| 'missed'         // Incoming call was missed
	| 'timeout'        // Call timed out

/** Call Direction */
export type CallDirection = 'incoming' | 'outgoing'

/** Media Types */
export type MediaType = 'audio' | 'video' | 'audio-video'

/** Call Quality Metrics */
export interface CallQualityMetrics {
	/** Audio statistics */
	audio: {
		bitrate: number          // kbps
		packetsLost: number
		packetsReceived: number
		jitter: number           // ms
		latency: number          // ms
		codec: string
	}
	/** Video statistics (if video call) */
	video?: {
		bitrate: number          // kbps
		packetsLost: number
		packetsReceived: number
		frameRate: number        // fps
		resolution: {
			width: number
			height: number
		}
		codec: string
	}
	/** Connection quality */
	connection: {
		type: RTCIceConnectionState
		candidateType: string    // 'host' | 'srflx' | 'relay'
		protocol: string         // 'udp' | 'tcp'
		localAddress: string
		remoteAddress: string
	}
}

/** Call Participant Info */
export interface CallParticipant {
	jid: string
	name?: string
	isMe: boolean
	stream?: MediaStream
	isMuted: boolean
	isVideoEnabled: boolean
}

/** Complete Call Information */
export interface CallInfo {
	/** Unique call identifier */
	id: string

	/** Call direction */
	direction: CallDirection

	/** Current call state */
	state: CallState

	/** Remote participant JID */
	remoteJid: string

	/** Remote participant info */
	remoteParticipant: CallParticipant

	/** Local participant info */
	localParticipant: CallParticipant

	/** Group call information */
	isGroup: boolean
	groupJid?: string
	groupParticipants?: CallParticipant[]

	/** Media configuration */
	mediaType: MediaType

	/** Call timestamps */
	timestamps: {
		initiated?: Date
		ringing?: Date
		connected?: Date
		ended?: Date
	}

	/** Call duration in seconds */
	duration: number

	/** Quality metrics */
	qualityMetrics?: CallQualityMetrics

	/** Additional metadata */
	metadata: {
		isVideo: boolean
		isAudioMuted: boolean
		isVideoMuted: boolean
		isOnSpeaker: boolean
		isRecording: boolean
		errorReason?: string
		endReason?: 'user' | 'remote' | 'timeout' | 'error' | 'rejected'
	}
}

/** WebRTC Configuration */
export interface WebRTCConfig {
	/** ICE servers configuration */
	iceServers: RTCIceServer[]

	/** ICE transport policy */
	iceTransportPolicy?: RTCIceTransportPolicy

	/** Bundle policy */
	bundlePolicy?: RTCBundlePolicy

	/** RTCP mux policy */
	rtcpMuxPolicy?: RTCRtcpMuxPolicy

	/** Certificates */
	certificates?: RTCCertificate[]
}

/** Audio Constraints */
export interface AudioConstraints {
	echoCancellation?: boolean
	noiseSuppression?: boolean
	autoGainControl?: boolean
	sampleRate?: number
	channelCount?: number
}

/** Video Constraints */
export interface VideoConstraints {
	width?: number | { min?: number; max?: number; ideal?: number }
	height?: number | { min?: number; max?: number; ideal?: number }
	frameRate?: number | { min?: number; max?: number; ideal?: number }
	facingMode?: 'user' | 'environment'
	aspectRatio?: number
}

/** Media Constraints */
export interface MediaConstraints {
	audio: boolean | AudioConstraints
	video: boolean | VideoConstraints
}

/** Call Options */
export interface CallOptions {
	/** Enable video */
	video?: boolean

	/** Media constraints */
	mediaConstraints?: MediaConstraints

	/** WebRTC configuration */
	webrtcConfig?: Partial<WebRTCConfig>

	/** Auto-answer for incoming calls */
	autoAnswer?: boolean

	/** Timeout for call in ms */
	timeout?: number

	/** Recording enabled */
	enableRecording?: boolean

	/** Start with audio muted */
	startAudioMuted?: boolean

	/** Start with video muted (camera off) */
	startVideoMuted?: boolean
}

/** Call Events */
export interface CallEvents {
	/** Call state changed */
	'call:state-change': (callInfo: CallInfo, previousState: CallState) => void

	/** Incoming call received */
	'call:incoming': (callInfo: CallInfo) => void

	/** Call is ringing (outgoing) */
	'call:ringing': (callInfo: CallInfo) => void

	/** Call connected successfully */
	'call:connected': (callInfo: CallInfo) => void

	/** Call ended */
	'call:ended': (callInfo: CallInfo, reason: string) => void

	/** Call failed */
	'call:failed': (callInfo: CallInfo, error: Error) => void

	/** Call rejected */
	'call:rejected': (callInfo: CallInfo) => void

	/** Call missed */
	'call:missed': (callInfo: CallInfo) => void

	/** Remote stream added */
	'call:remote-stream': (callInfo: CallInfo, stream: MediaStream) => void

	/** Local stream added */
	'call:local-stream': (callInfo: CallInfo, stream: MediaStream) => void

	/** Call quality update */
	'call:quality-update': (callInfo: CallInfo, metrics: CallQualityMetrics) => void

	/** Participant joined (group call) */
	'call:participant-joined': (callInfo: CallInfo, participant: CallParticipant) => void

	/** Participant left (group call) */
	'call:participant-left': (callInfo: CallInfo, participant: CallParticipant) => void

	/** Remote participant muted/unmuted */
	'call:participant-audio-change': (callInfo: CallInfo, participant: CallParticipant, isMuted: boolean) => void

	/** Remote participant video on/off */
	'call:participant-video-change': (callInfo: CallInfo, participant: CallParticipant, isEnabled: boolean) => void
}

/** SDP Offer/Answer */
export interface SDPMessage {
	type: 'offer' | 'answer'
	sdp: string
	callId: string
}

/** ICE Candidate Message */
export interface ICECandidateMessage {
	candidate: RTCIceCandidateInit
	callId: string
}

/** Signaling Message Types */
export type SignalingMessage =
	| { type: 'offer'; data: SDPMessage }
	| { type: 'answer'; data: SDPMessage }
	| { type: 'ice-candidate'; data: ICECandidateMessage }
	| { type: 'call-end'; callId: string; reason: string }
	| { type: 'call-reject'; callId: string }
	| { type: 'call-accept'; callId: string }
	| { type: 'media-update'; callId: string; audio: boolean; video: boolean }

/** Call Manager Configuration */
export interface CallManagerConfig {
	/** Default WebRTC configuration */
	defaultWebRTCConfig?: WebRTCConfig

	/** Default media constraints */
	defaultMediaConstraints?: MediaConstraints

	/** Default call timeout in ms */
	defaultCallTimeout?: number

	/** Maximum concurrent calls */
	maxConcurrentCalls?: number

	/** Enable call recording by default */
	enableRecordingByDefault?: boolean

	/** Enable quality monitoring */
	enableQualityMonitoring?: boolean

	/** Quality monitoring interval in ms */
	qualityMonitoringInterval?: number

	/** Enable call logs */
	enableCallLogs?: boolean

	/** Call logs retention in days */
	callLogsRetentionDays?: number
}

/** Call Action Result */
export interface CallActionResult {
	success: boolean
	callId?: string
	error?: Error
	message?: string
}

/** Call History Entry */
export interface CallHistoryEntry {
	callId: string
	remoteJid: string
	direction: CallDirection
	mediaType: MediaType
	state: CallState
	startTime: Date
	endTime?: Date
	duration: number
	endReason?: string
	qualityMetrics?: CallQualityMetrics
}

/** Export base types from Pitu */
export type { WACallEvent, WACallUpdateType }
