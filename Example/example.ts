import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import readline from 'readline'
import makeWASocket, { AnyMessageContent, BinaryInfo, delay, DisconnectReason, encodeWAM, fetchLatestBaileysVersion, getAggregateVotesInPollMessage, isJidNewsletter, makeCacheableSignalKeyStore, waproto as proto, useMultiFileAuthState, WAMessageContent, WAMessageKey } from '../src'
//import MAIN_LOGGER from '../src/Utils/logger'
import open from 'open'
import fs from 'fs'
import P from 'pino'

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'))
logger.level = 'silent'

const usePairingCode = process.argv.includes('--use-pairing-code')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache()

const onDemandMap = new Map<string, string>()

// Read line interface
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))

// start a connection
const startSock = async () => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const sock = makeWASocket({
		version,
		logger,
		auth: {
			creds: state.creds,
			/** caching makes the store faster to send/recv messages */
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		msgRetryCounterCache,
		generateHighQualityLinkPreview: true,
		// ignore all broadcast messages -- to receive the same
		// comment the line below out
		// shouldIgnoreJid: jid => isJidBroadcast(jid),
		// implement to handle retries & poll updates
		getMessage,
	})

	// Pairing code for Web clients
	if (usePairingCode && !sock.authState.creds.registered) {
		// todo move to QR event
		const phoneNumber = await question('Please enter your phone number:\n')
		const code = await sock.requestPairingCode(phoneNumber)
		console.log(`Pairing code: ${code}`)
	}

	const sendMessageWTyping = async (msg: AnyMessageContent, jid: string) => {
		await sock.presenceSubscribe(jid)
		await delay(500)

		await sock.sendPresenceUpdate('composing', jid)
		await delay(2000)

		await sock.sendPresenceUpdate('paused', jid)

		await sock.sendMessage(jid, msg)
	}

	// the process function lets you process all events that just occurred
	// efficiently in a batch
	sock.ev.process(
		// events is a map for event name => event data
		async (events) => {
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if (events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect } = update
				if (connection === 'close') {
					// reconnect if not logged out
					if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						startSock()
					} else {
						console.log('Connection closed. You are logged out.')
					}
				}

				// WARNING: THIS WILL SEND A WAM EXAMPLE AND THIS IS A ****CAPTURED MESSAGE.****
				// DO NOT ACTUALLY ENABLE THIS UNLESS YOU MODIFIED THE FILE.JSON!!!!!
				// THE ANALYTICS IN THE FILE ARE OLD. DO NOT USE THEM.
				// YOUR APP SHOULD HAVE GLOBALS AND ANALYTICS ACCURATE TO TIME, DATE AND THE SESSION
				// THIS FILE.JSON APPROACH IS JUST AN APPROACH I USED, BE FREE TO DO THIS IN ANOTHER WAY.
				// THE FIRST EVENT CONTAINS THE CONSTANT GLOBALS, EXCEPT THE seqenceNumber(in the event) and commitTime
				// THIS INCLUDES STUFF LIKE ocVersion WHICH IS CRUCIAL FOR THE PREVENTION OF THE WARNING
				const sendWAMExample = false;
				if (connection === 'open' && sendWAMExample) {
					/// sending WAM EXAMPLE
					const {
						header: {
							wamVersion,
							eventSequenceNumber,
						},
						events,
					} = JSON.parse(await fs.promises.readFile("./boot_analytics_test.json", "utf-8"))

					const binaryInfo = new BinaryInfo({
						protocolVersion: wamVersion,
						sequence: eventSequenceNumber,
						events: events
					})

					const buffer = encodeWAM(binaryInfo);

					const result = await sock.sendWAMBuffer(buffer)
				}


				if (update.qr) {
					const website = "https://quickchart.io/qr?text=" + encodeURIComponent(update.qr)
					console.log('QR code received, open in browser:', website)
				}
			}

			// credentials updated -- save them
			if (events['creds.update']) {
				await saveCreds()
			}

			if (events['labels.association']) {
				// console.log(events['labels.association'])
			}


			if (events['labels.edit']) {
				// console.log(events['labels.edit'])
			}

			if (events.call) {
				// console.log('recv call event', events.call)
			}

			// history received
			if (events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set']
				if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
					// console.log('received on-demand history sync, messages=', messages)
				}
				// console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest}, progress: ${progress}%), type: ${syncType}`)
			}

			// received a new message
			if (events['messages.upsert']) {
				const upsert = events['messages.upsert']
				console.log('recv messages ', JSON.stringify(upsert, undefined, 2))

				if (upsert.type === 'notify') {
					for (const msg of upsert.messages) {
						if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
							const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
							if (text == "requestPlaceholder" && !upsert.requestId) {
								const messageId = await sock.requestPlaceholderResend(msg.key)
								// console.log('requested placeholder resync, id=', messageId)
							} else if (upsert.requestId) {
								// console.log('Message received from phone, id=', upsert.requestId, msg)
							}

							// go to an old chat and send this
							if (text == "onDemandHistSync") {
								const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp!)
								// console.log('requested on-demand sync, id=', messageId)
							}

							if (text == "jid") {
								try {
									const lid = sock.user;
									const phone = msg.key.remoteJid!.split('@')[0];
									const lidUser = await sock.onWhatsApp(phone);
									console.log('latest id is', lidUser, 'and my lid is', lid);
									await sock!.readMessages([msg.key]);

									if (lidUser && lidUser.length > 0) {
										await sendMessageWTyping({
											text: `Enviado pelo ${msg.key.remoteJid!}\n\nSeu lid: ${JSON.stringify(lidUser[0])}\nMeu lid: ${JSON.stringify(lid)}`
										}, msg.key.remoteJid!);
									} else {
										await sendMessageWTyping({
											text: `Erro ao obter informações do usuário. JID: ${msg.key.remoteJid!}\nMeu lid: ${JSON.stringify(lid)}`
										}, msg.key.remoteJid!);
									}
								} catch (error) {
									console.error('Erro ao processar comando "jid":', error);
									await sendMessageWTyping({
										text: `Erro ao processar comando. JID: ${msg.key.remoteJid!}`
									}, msg.key.remoteJid!);
								}
							}

							if (text == "lid") {
								try {
									const lid = sock.user;
									const phone = msg.key.remoteJid!.split('@')[0];
									const lidUser = await sock.onWhatsApp(phone);
									console.log('latest id is', lidUser, 'and my lid is', lid);
									await sock!.readMessages([msg.key]);

									// Verificar se lidUser existe e tem pelo menos um elemento
									if (lidUser && lidUser.length > 0) {
										// Usar o lid se existir e não for vazio, caso contrário usar o remoteJid original
										const userLid = lidUser[0].lid;
										const dados: string = (userLid && typeof userLid === 'string' && userLid !== '') ? userLid : msg.key.remoteJid!;
										console.log(`dados ${dados}`);

										await sendMessageWTyping({
											text: `Enviado pelo ${dados}\n\nSeu lid: ${JSON.stringify(lidUser[0])}\nMeu lid: ${JSON.stringify(lid)}`
										}, dados);
									} else {
										console.log('Erro: não foi possível obter informações do usuário');
										await sendMessageWTyping({
											text: `Erro ao obter informações do usuário. Usando JID original: ${msg.key.remoteJid!}`
										}, msg.key.remoteJid!);
									}
								} catch (error) {
									console.error('Erro ao processar comando "lid":', error);
									await sendMessageWTyping({
										text: `Erro ao processar comando. Usando JID original: ${msg.key.remoteJid!}`
									}, msg.key.remoteJid!);
								}
							}
						}
					}
				}
			}

			// messages updated like status delivered, message deleted etc.
			if (events['messages.update']) {
				/* console.log(
					JSON.stringify(events['messages.update'], undefined, 2)
				) */

				for (const { key, update } of events['messages.update']) {
					if (update.pollUpdates) {
						const pollCreation: proto.IMessage = {} // get the poll creation message somehow
						if (pollCreation) {
							/* console.log(
								'got poll update, aggregation: ',
								getAggregateVotesInPollMessage({
									message: pollCreation,
									pollUpdates: update.pollUpdates,
								})
							) */
						}
					}
				}
			}

			/*
			if(events['message-receipt.update']) {
				console.log(events['message-receipt.update'])
			}

			if(events['messages.reaction']) {
				console.log(events['messages.reaction'])
			}

			if(events['presence.update']) {
				console.log(events['presence.update'])
			}

			if(events['chats.update']) {
				console.log(events['chats.update'])
			}
			*/

			if (events['contacts.update']) {
				for (const contact of events['contacts.update']) {
					if (typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						/* console.log(
							`contact ${contact.id} has a new profile pic: ${newUrl}`,
						) */
					}
				}
			}

			if (events['chats.delete']) {
				// console.log('chats deleted ', events['chats.delete'])
			}
		}
	)

	return sock

	async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
		// Implement a way to retreive messages that were upserted from messages.upsert
		// up to you

		// only if store is present
		return proto.Message.fromObject({})
	}
}

startSock()
