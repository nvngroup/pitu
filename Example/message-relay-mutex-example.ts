import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '../src'
import { Boom } from '@hapi/boom'

async function example() {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')

	const sock = makeWASocket({
		auth: state,
		printQRInTerminal: true,

		messageRelayMaxConcurrent: 5,
		messageRelayMaxQueueSize: 100,
	})

	sock.ev.on('creds.update', saveCreds)

	sock.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect } = update

		if (connection === 'close') {
			const shouldReconnect: boolean = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
			console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)

			if (shouldReconnect) {
				example()
			}
		} else if (connection === 'open') {
			console.log('opened connection')
		}
	})

	async function sendSingleMessage(jid: string) {
		try {
			await sock.sendMessage(jid, { text: 'Hello World!' })
			console.log('Message sent successfully')
		} catch (error: any) {
			if (error.message.includes('queue is full')) {
				console.error('Queue is full! Too many concurrent requests.')
			} else {
				console.error('Error sending message:', error)
			}
		}
	}

	async function sendBulkMessages(jids: string[], message: string) {
		console.log(`Sending ${jids.length} messages with mutex control...`)

		const promises = jids.map(async(jid) => {
			try {
				await sock.sendMessage(jid, { text: message })
				return { jid, success: true }
   } catch (error: any) {
				console.error(`Failed to send to ${jid}:`, error.message)
				return { jid, success: false, error: error.message }
			}
		})

		const results = await Promise.allSettled(promises)

		const successful: number = results.filter(r => r.status === 'fulfilled' && r.value.success).length
  const failed: number = results.length - successful

		console.log(`Bulk send complete: ${successful} successful, ${failed} failed`)
		return results
	}

	async function sendWithRetry(jid: string, content: any, maxRetries = 3) {
  let attempt: number = 0

		while (attempt < maxRetries) {
			try {
				await sock.sendMessage(jid, content)
				console.log(`Message sent on attempt ${attempt + 1}`)
				return true
   } catch (error: any) {
				attempt++

				if (error.message.includes('queue is full')) {
					console.log(`Queue full, waiting before retry (attempt ${attempt}/${maxRetries})...`)
					await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
				} else {
					console.error(`Error on attempt ${attempt}:`, error.message)
					if (attempt >= maxRetries) {
						throw error
					}
				}
			}
		}

		return false
	}

	async function sendWithThrottling(messages: Array<{ jid: string; content: any }>, delayMs = 100) {
		for (const msg of messages) {
			try {
				await sock.sendMessage(msg.jid, msg.content)
				console.log(`Sent to ${msg.jid}`)
   } catch (error: any) {
				console.error(`Failed to send to ${msg.jid}:`, error.message)
			}

			await new Promise(resolve => setTimeout(resolve, delayMs))
		}
	}

	return {
		sock,
		sendSingleMessage,
		sendBulkMessages,
		sendWithRetry,
		sendWithThrottling
	}
}

// Executar o exemplo
if (require.main === module) {
	example().catch(console.error)
}

export default example
