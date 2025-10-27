/**
 * React Component for Voice/Video Call Interface
 * Complete UI for making, receiving, and managing calls
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

// Types
interface CallInfo {
	callId: string
	from?: string
	to?: string
	isVideo: boolean
	state: 'idle' | 'ringing' | 'active' | 'ended'
	isMuted: boolean
	isVideoEnabled: boolean
	duration: number
}

interface CallInterfaceProps {
	serverUrl: string
}

/**
 * CallInterface Component
 */
export const CallInterface: React.FC<CallInterfaceProps> = ({ serverUrl }) => {
	// Socket connection
	const [socket, setSocket] = useState<Socket | null>(null)
	const [connected, setConnected] = useState(false)

	// Call state
	const [currentCall, setCurrentCall] = useState<CallInfo | null>(null)
	const [incomingCall, setIncomingCall] = useState<any | null>(null)

	// Media streams
	const [localStream, setLocalStream] = useState<MediaStream | null>(null)
	const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

	// UI state
	const [callTarget, setCallTarget] = useState('')
	const [callQuality, setCallQuality] = useState<any>(null)

	// Video refs
	const localVideoRef = useRef<HTMLVideoElement>(null)
	const remoteVideoRef = useRef<HTMLVideoElement>(null)

	// Call duration timer
	const durationTimerRef = useRef<NodeJS.Timeout | null>(null)

	/**
	 * Initialize Socket.IO connection
	 */
	useEffect(() => {
		const newSocket = io(serverUrl)
		setSocket(newSocket)

		newSocket.on('connect', () => {
			console.log('✅ Connected to server')
			setConnected(true)
		})

		newSocket.on('disconnect', () => {
			console.log('❌ Disconnected from server')
			setConnected(false)
		})

		// WhatsApp status
		newSocket.on('whatsapp-status', (data: { connected: boolean }) => {
			console.log('WhatsApp status:', data.connected ? 'connected' : 'disconnected')
		})

		// Incoming call
		newSocket.on('incoming-call', (data: any) => {
			console.log('📞 Incoming call:', data)
			setIncomingCall(data)
		})

		// Call connected
		newSocket.on('call-connected', (data: any) => {
			console.log('✅ Call connected:', data)
			if(currentCall?.callId === data.callId) {
				setCurrentCall(prev => prev ? { ...prev, state: 'active' } : null)
				startDurationTimer()
			}
		})

		// Call ended
		newSocket.on('call-ended', (data: any) => {
			console.log('📴 Call ended:', data)
			handleCallEnd()
		})

		// Call quality
		newSocket.on('call-quality', (data: any) => {
			setCallQuality(data.metrics)
		})

		return () => {
			newSocket.close()
		}
	}, [serverUrl])

	/**
	 * Start duration timer
	 */
	const startDurationTimer = useCallback(() => {
		if(durationTimerRef.current) {
			clearInterval(durationTimerRef.current)
		}

		durationTimerRef.current = setInterval(() => {
			setCurrentCall(prev => {
				if(!prev) return null
				return { ...prev, duration: prev.duration + 1 }
			})
		}, 1000)
	}, [])

	/**
	 * Stop duration timer
	 */
	const stopDurationTimer = useCallback(() => {
		if(durationTimerRef.current) {
			clearInterval(durationTimerRef.current)
			durationTimerRef.current = null
		}
	}, [])

	/**
	 * Get user media
	 */
	const getUserMedia = async (video: boolean): Promise<MediaStream> => {
		const constraints: MediaStreamConstraints = {
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
			video: video ? {
				width: { ideal: 1280 },
				height: { ideal: 720 },
				frameRate: { ideal: 30 },
				facingMode: 'user',
			} : false,
		}

		const stream = await navigator.mediaDevices.getUserMedia(constraints)
		return stream
	}

	/**
	 * Make call
	 */
	const makeCall = async (isVideo: boolean) => {
		if(!socket || !callTarget) return

		try {
			// Get local media
			const stream = await getUserMedia(isVideo)
			setLocalStream(stream)

			// Display local video
			if(localVideoRef.current && isVideo) {
				localVideoRef.current.srcObject = stream
			}

			// Request call via socket
			socket.emit('make-call', { to: callTarget, video: isVideo }, (result: any) => {
				if(result.success) {
					console.log('📞 Call initiated:', result.callId)
					setCurrentCall({
						callId: result.callId,
						to: callTarget,
						isVideo,
						state: 'ringing',
						isMuted: false,
						isVideoEnabled: isVideo,
						duration: 0,
					})
					setCallTarget('')
				} else {
					console.error('Failed to make call:', result.error)
					alert('Failed to make call: ' + result.error)
					// Stop local stream
					stream.getTracks().forEach(track => track.stop())
					setLocalStream(null)
				}
			})
		} catch(error: any) {
			console.error('Error making call:', error)
			alert('Error accessing camera/microphone: ' + error.message)
		}
	}

	/**
	 * Answer call
	 */
	const answerCall = async () => {
		if(!socket || !incomingCall) return

		try {
			// Get local media
			const stream = await getUserMedia(incomingCall.isVideo)
			setLocalStream(stream)

			// Display local video
			if(localVideoRef.current && incomingCall.isVideo) {
				localVideoRef.current.srcObject = stream
			}

			// Answer via socket
			socket.emit('answer-call', { callId: incomingCall.callId }, (result: any) => {
				if(result.success) {
					console.log('✅ Call answered')
					setCurrentCall({
						callId: incomingCall.callId,
						from: incomingCall.from,
						isVideo: incomingCall.isVideo,
						state: 'active',
						isMuted: false,
						isVideoEnabled: incomingCall.isVideo,
						duration: 0,
					})
					setIncomingCall(null)
					startDurationTimer()
				} else {
					console.error('Failed to answer call:', result.error)
					alert('Failed to answer call: ' + result.error)
					// Stop local stream
					stream.getTracks().forEach(track => track.stop())
					setLocalStream(null)
				}
			})
		} catch(error: any) {
			console.error('Error answering call:', error)
			alert('Error accessing camera/microphone: ' + error.message)
		}
	}

	/**
	 * Reject call
	 */
	const rejectCall = () => {
		if(!socket || !incomingCall) return

		socket.emit('reject-call', { callId: incomingCall.callId }, (result: any) => {
			if(result.success) {
				console.log('❌ Call rejected')
				setIncomingCall(null)
			}
		})
	}

	/**
	 * End call
	 */
	const endCall = () => {
		if(!socket || !currentCall) return

		socket.emit('end-call', { callId: currentCall.callId }, (result: any) => {
			if(result.success) {
				console.log('📴 Call ended')
				handleCallEnd()
			}
		})
	}

	/**
	 * Handle call end cleanup
	 */
	const handleCallEnd = () => {
		stopDurationTimer()

		// Stop local stream
		if(localStream) {
			localStream.getTracks().forEach(track => track.stop())
			setLocalStream(null)
		}

		// Stop remote stream
		if(remoteStream) {
			remoteStream.getTracks().forEach(track => track.stop())
			setRemoteStream(null)
		}

		// Clear video elements
		if(localVideoRef.current) {
			localVideoRef.current.srcObject = null
		}
		if(remoteVideoRef.current) {
			remoteVideoRef.current.srcObject = null
		}

		setCurrentCall(null)
		setIncomingCall(null)
		setCallQuality(null)
	}

	/**
	 * Toggle mute
	 */
	const toggleMute = () => {
		if(!socket || !currentCall || !localStream) return

		const newMuted = !currentCall.isMuted
		localStream.getAudioTracks().forEach(track => {
			track.enabled = !newMuted
		})

		socket.emit('toggle-mute', { callId: currentCall.callId, muted: newMuted })
		setCurrentCall(prev => prev ? { ...prev, isMuted: newMuted } : null)
	}

	/**
	 * Toggle video
	 */
	const toggleVideo = () => {
		if(!socket || !currentCall || !localStream) return

		const newEnabled = !currentCall.isVideoEnabled
		localStream.getVideoTracks().forEach(track => {
			track.enabled = newEnabled
		})

		socket.emit('toggle-video', { callId: currentCall.callId, enabled: newEnabled })
		setCurrentCall(prev => prev ? { ...prev, isVideoEnabled: newEnabled } : null)
	}

	/**
	 * Format duration
	 */
	const formatDuration = (seconds: number): string => {
		const mins = Math.floor(seconds / 60)
		const secs = seconds % 60
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
	}

	/**
	 * Render
	 */
	return (
		<div className="call-interface">
			<h1>WhatsApp Voice/Video Call</h1>

			{/* Connection status */}
			<div className="status">
				<span className={`indicator ${connected ? 'connected' : 'disconnected'}`} />
				{connected ? 'Connected' : 'Disconnected'}
			</div>

			{/* No active call - show call input */}
			{!currentCall && !incomingCall && (
				<div className="call-input">
					<input
						type="text"
						value={callTarget}
						onChange={(e) => setCallTarget(e.target.value)}
						placeholder="Enter phone number (e.g., 5511999999999@s.whatsapp.net)"
					/>
					<div className="button-group">
						<button onClick={() => makeCall(false)} disabled={!connected || !callTarget}>
							📞 Audio Call
						</button>
						<button onClick={() => makeCall(true)} disabled={!connected || !callTarget}>
							📹 Video Call
						</button>
					</div>
				</div>
			)}

			{/* Incoming call */}
			{incomingCall && (
				<div className="incoming-call">
					<h2>📞 Incoming {incomingCall.isVideo ? 'Video' : 'Audio'} Call</h2>
					<p>From: {incomingCall.from}</p>
					<div className="button-group">
						<button onClick={answerCall} className="answer">
							✅ Answer
						</button>
						<button onClick={rejectCall} className="reject">
							❌ Reject
						</button>
					</div>
				</div>
			)}

			{/* Active call */}
			{currentCall && (
				<div className="active-call">
					<h2>
						{currentCall.state === 'ringing' && '📞 Ringing...'}
						{currentCall.state === 'active' && '🔴 In Call'}
					</h2>
					<p>{currentCall.from || currentCall.to}</p>
					<p>{formatDuration(currentCall.duration)}</p>

					{/* Video containers */}
					<div className="video-container">
						{currentCall.isVideo && (
							<>
								<video
									ref={remoteVideoRef}
									className="remote-video"
									autoPlay
									playsInline
								/>
								<video
									ref={localVideoRef}
									className="local-video"
									autoPlay
									playsInline
									muted
								/>
							</>
						)}
					</div>

					{/* Call quality */}
					{callQuality && (
						<div className="call-quality">
							<p>Audio: {callQuality.audio?.bitrate} kbps</p>
							<p>Latency: {callQuality.audio?.latency} ms</p>
							{callQuality.video && (
								<p>Video: {callQuality.video?.bitrate} kbps @ {callQuality.video?.frameRate} fps</p>
							)}
						</div>
					)}

					{/* Call controls */}
					<div className="call-controls">
						<button
							onClick={toggleMute}
							className={currentCall.isMuted ? 'active' : ''}
						>
							{currentCall.isMuted ? '🔇' : '🔊'} {currentCall.isMuted ? 'Unmute' : 'Mute'}
						</button>

						{currentCall.isVideo && (
							<button
								onClick={toggleVideo}
								className={!currentCall.isVideoEnabled ? 'active' : ''}
							>
								{currentCall.isVideoEnabled ? '📹' : '📷'} {currentCall.isVideoEnabled ? 'Stop Video' : 'Start Video'}
							</button>
						)}

						<button onClick={endCall} className="end-call">
							📴 End Call
						</button>
					</div>
				</div>
			)}

			{/* Styles */}
			<style jsx>{`
				.call-interface {
					max-width: 800px;
					margin: 0 auto;
					padding: 20px;
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
				}

				h1 {
					text-align: center;
					color: #25D366;
				}

				.status {
					display: flex;
					align-items: center;
					justify-content: center;
					margin-bottom: 20px;
					font-size: 14px;
					color: #666;
				}

				.indicator {
					width: 10px;
					height: 10px;
					border-radius: 50%;
					margin-right: 8px;
				}

				.indicator.connected {
					background: #25D366;
				}

				.indicator.disconnected {
					background: #ccc;
				}

				.call-input {
					text-align: center;
				}

				input {
					width: 100%;
					padding: 12px;
					font-size: 16px;
					border: 2px solid #ddd;
					border-radius: 8px;
					margin-bottom: 12px;
				}

				.button-group {
					display: flex;
					gap: 12px;
					justify-content: center;
				}

				button {
					padding: 12px 24px;
					font-size: 16px;
					border: none;
					border-radius: 8px;
					cursor: pointer;
					background: #25D366;
					color: white;
					transition: background 0.2s;
				}

				button:hover:not(:disabled) {
					background: #20BA5A;
				}

				button:disabled {
					background: #ccc;
					cursor: not-allowed;
				}

				button.reject {
					background: #dc3545;
				}

				button.reject:hover {
					background: #c82333;
				}

				button.answer {
					background: #28a745;
				}

				button.answer:hover {
					background: #218838;
				}

				button.end-call {
					background: #dc3545;
				}

				button.end-call:hover {
					background: #c82333;
				}

				button.active {
					background: #ffc107;
					color: #000;
				}

				.incoming-call, .active-call {
					text-align: center;
					padding: 20px;
					background: #f8f9fa;
					border-radius: 12px;
				}

				.video-container {
					position: relative;
					width: 100%;
					height: 500px;
					background: #000;
					border-radius: 8px;
					margin: 20px 0;
				}

				.remote-video {
					width: 100%;
					height: 100%;
					object-fit: cover;
					border-radius: 8px;
				}

				.local-video {
					position: absolute;
					bottom: 20px;
					right: 20px;
					width: 200px;
					height: 150px;
					object-fit: cover;
					border-radius: 8px;
					border: 2px solid white;
				}

				.call-quality {
					font-size: 12px;
					color: #666;
					margin: 10px 0;
				}

				.call-controls {
					display: flex;
					gap: 12px;
					justify-content: center;
					margin-top: 20px;
				}
			`}</style>
		</div>
	)
}

export default CallInterface
