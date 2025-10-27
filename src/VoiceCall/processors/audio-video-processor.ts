/**
 * Audio/Video Processor
 * Handles media stream processing, encoding, decoding, and recording
 */

import type { MediaConstraints, AudioConstraints, VideoConstraints } from '../types'
import { EventEmitter } from 'events'

export interface AudioVideoProcessorEvents {
	'recording-started': () => void
	'recording-stopped': (blob: Blob) => void
	'recording-error': (error: Error) => void
	'processing-error': (error: Error) => void
}

/**
 * AudioVideoProcessor handles media stream processing and recording
 */
export class AudioVideoProcessor extends EventEmitter {
	private mediaRecorder: MediaRecorder | null = null
	private recordedChunks: Blob[] = []
	private audioContext: AudioContext | null = null
	private analyser: AnalyserNode | null = null
	private isRecording = false

	constructor() {
		super()
	}

	/**
	 * Get user media with constraints
	 */
	async getUserMedia(constraints: MediaConstraints): Promise<MediaStream> {
		try {
			// Validate and normalize constraints
			const normalizedConstraints = this.normalizeConstraints(constraints)
			const stream = await navigator.mediaDevices.getUserMedia(normalizedConstraints)
			return stream
		} catch(error) {
			this.emit('processing-error', error as Error)
			throw error
		}
	}

	/**
	 * Normalize media constraints
	 */
	private normalizeConstraints(constraints: MediaConstraints): MediaStreamConstraints {
		const result: MediaStreamConstraints = {}

		// Normalize audio constraints
		if(constraints.audio) {
			if(typeof constraints.audio === 'boolean') {
				result.audio = constraints.audio
			} else {
				result.audio = {
					echoCancellation: constraints.audio.echoCancellation ?? true,
					noiseSuppression: constraints.audio.noiseSuppression ?? true,
					autoGainControl: constraints.audio.autoGainControl ?? true,
					sampleRate: constraints.audio.sampleRate,
					channelCount: constraints.audio.channelCount,
				}
			}
		} else {
			result.audio = false
		}

		// Normalize video constraints
		if(constraints.video) {
			if(typeof constraints.video === 'boolean') {
				result.video = constraints.video
			} else {
				result.video = {
					width: constraints.video.width || { ideal: 1280 },
					height: constraints.video.height || { ideal: 720 },
					frameRate: constraints.video.frameRate || { ideal: 30 },
					facingMode: constraints.video.facingMode || 'user',
					aspectRatio: constraints.video.aspectRatio,
				}
			}
		} else {
			result.video = false
		}

		return result
	}

	/**
	 * Apply audio filters and enhancements
	 */
	applyAudioProcessing(stream: MediaStream): MediaStream {
		try {
			// Create audio context
			if(!this.audioContext) {
				this.audioContext = new AudioContext()
			}

			const source = this.audioContext.createMediaStreamSource(stream)
			const destination = this.audioContext.createMediaStreamDestination()

			// Create audio processing nodes
			const compressor = this.audioContext.createDynamicsCompressor()
			const gainNode = this.audioContext.createGain()

			// Create analyser for visualizations
			this.analyser = this.audioContext.createAnalyser()
			this.analyser.fftSize = 2048

			// Configure compressor for better voice quality
			compressor.threshold.value = -50
			compressor.knee.value = 40
			compressor.ratio.value = 12
			compressor.attack.value = 0
			compressor.release.value = 0.25

			// Configure gain
			gainNode.gain.value = 1.0

			// Connect nodes
			source
				.connect(compressor)
				.connect(gainNode)
				.connect(this.analyser)
				.connect(destination)

			return destination.stream
		} catch(error) {
			console.error('Error applying audio processing:', error)
			return stream // Return original stream if processing fails
		}
	}

	/**
	 * Get audio level (0-100)
	 */
	getAudioLevel(): number {
		if(!this.analyser) return 0

		const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
		this.analyser.getByteFrequencyData(dataArray)

		// Calculate average
		const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
		return Math.round((average / 255) * 100)
	}

	/**
	 * Get audio frequency data for visualization
	 */
	getAudioFrequencyData(): Uint8Array | null {
		if(!this.analyser) return null

		const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
		this.analyser.getByteFrequencyData(dataArray)
		return dataArray
	}

	/**
	 * Get audio time domain data for waveform
	 */
	getAudioTimeDomainData(): Uint8Array | null {
		if(!this.analyser) return null

		const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
		this.analyser.getByteTimeDomainData(dataArray)
		return dataArray
	}

	/**
	 * Start recording media stream
	 */
	startRecording(stream: MediaStream, options?: MediaRecorderOptions): void {
		try {
			if(this.isRecording) {
				throw new Error('Recording already in progress')
			}

			const defaultOptions: MediaRecorderOptions = {
				mimeType: this.getSupportedMimeType(),
				videoBitsPerSecond: 2500000, // 2.5 Mbps for video
				audioBitsPerSecond: 128000,  // 128 kbps for audio
			}

			this.mediaRecorder = new MediaRecorder(stream, { ...defaultOptions, ...options })
			this.recordedChunks = []

			this.mediaRecorder.ondataavailable = (event) => {
				if(event.data.size > 0) {
					this.recordedChunks.push(event.data)
				}
			}

			this.mediaRecorder.onstop = () => {
				const blob = new Blob(this.recordedChunks, {
					type: this.mediaRecorder?.mimeType || 'video/webm',
				})
				this.emit('recording-stopped', blob)
				this.isRecording = false
			}

			this.mediaRecorder.onerror = (event: Event) => {
				const error = new Error('MediaRecorder error')
				this.emit('recording-error', error)
			}

			this.mediaRecorder.start(1000) // Collect data every second
			this.isRecording = true
			this.emit('recording-started')
		} catch(error) {
			this.emit('recording-error', error as Error)
			throw error
		}
	}

	/**
	 * Stop recording
	 */
	stopRecording(): void {
		if(this.mediaRecorder && this.isRecording) {
			this.mediaRecorder.stop()
		}
	}

	/**
	 * Get supported MIME type for recording
	 */
	private getSupportedMimeType(): string {
		const types = [
			'video/webm;codecs=vp9,opus',
			'video/webm;codecs=vp8,opus',
			'video/webm;codecs=h264,opus',
			'video/webm',
			'audio/webm',
		]

		for(const type of types) {
			if(MediaRecorder.isTypeSupported(type)) {
				return type
			}
		}

		return 'video/webm' // Fallback
	}

	/**
	 * Check if recording is in progress
	 */
	getIsRecording(): boolean {
		return this.isRecording
	}

	/**
	 * Apply video filters and effects
	 */
	applyVideoFilters(stream: MediaStream, filters: VideoFilters): MediaStream {
		// Create a video element
		const video = document.createElement('video')
		video.srcObject = stream
		video.play()

		// Create canvas for processing
		const canvas = document.createElement('canvas')
		const ctx = canvas.getContext('2d')!

		// Set canvas size
		const videoTrack = stream.getVideoTracks()[0]
		const settings = videoTrack.getSettings()
		canvas.width = settings.width || 640
		canvas.height = settings.height || 480

		// Process frames
		const processFrame = () => {
			if(video.readyState === video.HAVE_ENOUGH_DATA) {
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

				// Apply filters
				if(filters.brightness !== undefined) {
					ctx.filter = `brightness(${filters.brightness})`
				}
				if(filters.contrast !== undefined) {
					ctx.filter += ` contrast(${filters.contrast})`
				}
				if(filters.saturation !== undefined) {
					ctx.filter += ` saturate(${filters.saturation})`
				}
				if(filters.blur !== undefined) {
					ctx.filter += ` blur(${filters.blur}px)`
				}

				// Redraw with filters
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
			}

			requestAnimationFrame(processFrame)
		}

		processFrame()

		// Return canvas stream
		return canvas.captureStream(30)
	}

	/**
	 * Create video snapshot
	 */
	captureSnapshot(stream: MediaStream): Promise<Blob> {
		return new Promise((resolve, reject) => {
			try {
				const video = document.createElement('video')
				video.srcObject = stream
				video.play()

				video.onloadeddata = () => {
					const canvas = document.createElement('canvas')
					const videoTrack = stream.getVideoTracks()[0]
					const settings = videoTrack.getSettings()

					canvas.width = settings.width || 640
					canvas.height = settings.height || 480

					const ctx = canvas.getContext('2d')!
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

					canvas.toBlob((blob) => {
						if(blob) {
							resolve(blob)
						} else {
							reject(new Error('Failed to capture snapshot'))
						}
					}, 'image/jpeg', 0.95)
				}
			} catch(error) {
				reject(error)
			}
		})
	}

	/**
	 * Enumerate available media devices
	 */
	async getAvailableDevices(): Promise<{
		audioInputs: MediaDeviceInfo[]
		audioOutputs: MediaDeviceInfo[]
		videoInputs: MediaDeviceInfo[]
	}> {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices()

			return {
				audioInputs: devices.filter(d => d.kind === 'audioinput'),
				audioOutputs: devices.filter(d => d.kind === 'audiooutput'),
				videoInputs: devices.filter(d => d.kind === 'videoinput'),
			}
		} catch(error) {
			this.emit('processing-error', error as Error)
			throw error
		}
	}

	/**
	 * Switch video input device
	 */
	async switchVideoDevice(deviceId: string, currentStream: MediaStream): Promise<MediaStream> {
		try {
			// Stop current video tracks
			currentStream.getVideoTracks().forEach(track => track.stop())

			// Get new stream with specified device
			const newStream = await navigator.mediaDevices.getUserMedia({
				video: { deviceId: { exact: deviceId } },
				audio: false,
			})

			// Replace video track in current stream
			const newVideoTrack = newStream.getVideoTracks()[0]
			const oldVideoTrack = currentStream.getVideoTracks()[0]

			if(oldVideoTrack) {
				currentStream.removeTrack(oldVideoTrack)
			}
			currentStream.addTrack(newVideoTrack)

			return currentStream
		} catch(error) {
			this.emit('processing-error', error as Error)
			throw error
		}
	}

	/**
	 * Switch audio input device
	 */
	async switchAudioDevice(deviceId: string, currentStream: MediaStream): Promise<MediaStream> {
		try {
			// Stop current audio tracks
			currentStream.getAudioTracks().forEach(track => track.stop())

			// Get new stream with specified device
			const newStream = await navigator.mediaDevices.getUserMedia({
				audio: { deviceId: { exact: deviceId } },
				video: false,
			})

			// Replace audio track in current stream
			const newAudioTrack = newStream.getAudioTracks()[0]
			const oldAudioTrack = currentStream.getAudioTracks()[0]

			if(oldAudioTrack) {
				currentStream.removeTrack(oldAudioTrack)
			}
			currentStream.addTrack(newAudioTrack)

			return currentStream
		} catch(error) {
			this.emit('processing-error', error as Error)
			throw error
		}
	}

	/**
	 * Cleanup resources
	 */
	cleanup(): void {
		if(this.isRecording) {
			this.stopRecording()
		}

		if(this.audioContext && this.audioContext.state !== 'closed') {
			this.audioContext.close()
			this.audioContext = null
		}

		this.analyser = null
		this.mediaRecorder = null
		this.recordedChunks = []
		this.removeAllListeners()
	}
}

/** Video filter options */
export interface VideoFilters {
	brightness?: number  // 0-2, default 1
	contrast?: number    // 0-2, default 1
	saturation?: number  // 0-2, default 1
	blur?: number        // 0-20, default 0
}
