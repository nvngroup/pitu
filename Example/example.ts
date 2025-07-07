import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import readline from 'readline'
import { randomBytes } from 'crypto'
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

							if (text == "!jid") {
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

							if (text == "!lid") {
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

							// === COMANDOS DE TESTE PARA TODOS OS TIPOS DE MENSAGEM ===

							// TEXTO SIMPLES
							if (text === "!text") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									text: "Esta é uma mensagem de texto simples!"
								}, msg.key.remoteJid!);
							}

							// TEXTO COM FORMATAÇÃO
							if (text === "!format") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									text: "*Texto em negrito*\n_Texto em itálico_\n~Texto riscado~\n```Texto monoespaçado```\n> Citação"
								}, msg.key.remoteJid!);
							}

							// TEXTO COM MENÇÕES
							if (text === "!mention") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									text: `Olá @${msg.key.remoteJid!.split('@')[0]}! Como você está?`,
									mentions: [msg.key.remoteJid!]
								}, msg.key.remoteJid!);
							}

							// IMAGEM
							if (text === "!image") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									image: { url: 'https://picsum.photos/400/300' },
									caption: 'Esta é uma imagem de exemplo!'
								}, msg.key.remoteJid!);
							}

							// VÍDEO
							if (text === "!video") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									video: { url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4' },
									caption: 'Este é um vídeo de exemplo!'
								}, msg.key.remoteJid!);
							}

							// ÁUDIO
							if (text === "!audio") {
								await sock.readMessages([msg.key]);
								try {
									await sendMessageWTyping({
										audio: fs.readFileSync('./Media/sonata.mp3'),
										mimetype: 'audio/mp4'
									}, msg.key.remoteJid!);
								} catch (error) {
									await sendMessageWTyping({
										text: 'Erro: Arquivo de áudio não encontrado. Certifique-se de que ./Media/sonata.mp3 existe.'
									}, msg.key.remoteJid!);
								}
							}

							// ÁUDIO COMO NOTA DE VOZ
							if (text === "!voice") {
								await sock.readMessages([msg.key]);
								try {
									await sendMessageWTyping({
										audio: fs.readFileSync('./Media/sonata.mp3'),
										mimetype: 'audio/mp4',
										ptt: true
									}, msg.key.remoteJid!);
								} catch (error) {
									await sendMessageWTyping({
										text: 'Erro: Arquivo de áudio não encontrado. Certifique-se de que ./Media/sonata.mp3 existe.'
									}, msg.key.remoteJid!);
								}
							}

							// DOCUMENTO
							if (text === "!document") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									document: Buffer.from("Conteúdo do documento de exemplo"),
									fileName: 'exemplo.txt',
									mimetype: 'text/plain',
									caption: 'Este é um documento de exemplo!'
								}, msg.key.remoteJid!);
							}

							// STICKER
							if (text === "!sticker") {
								await sock.readMessages([msg.key]);
								try {
									await sendMessageWTyping({
										sticker: fs.readFileSync('./Media/octopus.webp')
									}, msg.key.remoteJid!);
								} catch (error) {
									await sendMessageWTyping({
										text: 'Erro: Arquivo de sticker não encontrado. Certifique-se de que ./Media/octopus.webp existe.'
									}, msg.key.remoteJid!);
								}
							}

							// LOCALIZAÇÃO
							if (text === "!location") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									location: {
										degreesLatitude: -23.550520,
										degreesLongitude: -46.633308,
										name: "São Paulo, SP",
										address: "São Paulo, Estado de São Paulo, Brasil"
									}
								}, msg.key.remoteJid!);
							}

							// CONTATO
							if (text === "!contact") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									contacts: {
										displayName: "Contato de Exemplo",
										contacts: [{
											displayName: "João Silva",
											vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Silva;João;;;\nFN:João Silva\nTEL;TYPE=CELL:+5511999999999\nEND:VCARD`
										}]
									}
								}, msg.key.remoteJid!);
							}

							// REAÇÃO
							if (text === "!react") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									react: {
										text: "👍",
										key: msg.key
									}
								}, msg.key.remoteJid!);
							}

							// POLL (ENQUETE)
							if (text === "!poll") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									poll: {
										name: "Qual sua cor favorita?",
										values: ["🔴 Vermelho", "🔵 Azul", "🟢 Verde", "🟡 Amarelo"],
										selectableCount: 1
									}
								}, msg.key.remoteJid!);
							}

							// BOTÕES
							if (text === "!buttons") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									text: "Escolha uma opção:",
									buttons: [
										{ buttonId: 'option1', buttonText: { displayText: 'Opção 1' }, type: 1 },
										{ buttonId: 'option2', buttonText: { displayText: 'Opção 2' }, type: 1 },
										{ buttonId: 'option3', buttonText: { displayText: 'Opção 3' }, type: 1 }
									]
								}, msg.key.remoteJid!);
							}

							// LISTA
							if (text === "!list") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									text: "Esta é uma lista de opções",
									sections: [
										{
											title: "Seção 1",
											rows: [
												{ title: "Opção 1", rowId: "option1", description: "Descrição da opção 1" },
												{ title: "Opção 2", rowId: "option2", description: "Descrição da opção 2" }
											]
										},
										{
											title: "Seção 2",
											rows: [
												{ title: "Opção 3", rowId: "option3", description: "Descrição da opção 3" },
												{ title: "Opção 4", rowId: "option4", description: "Descrição da opção 4" }
											]
										}
									],
									buttonText: "Selecionar",
									title: "Lista de Exemplo"
								}, msg.key.remoteJid!);
							}

							// TEMPLATE MESSAGE - Fixed for mobile compatibility
							if (text === "!template") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									text: "Esta é uma mensagem com template buttons",
									templateButtons: [
										{ index: 1, urlButton: { displayText: 'Abrir URL', url: 'https://github.com/WhiskeySockets/Baileys' } },
										{ index: 2, callButton: { displayText: 'Ligar', phoneNumber: '+5511999999999' } },
										{ index: 3, quickReplyButton: { displayText: 'Resposta Rápida', id: 'quick_reply' } }
									],
									footer: "Rodapé da mensagem",
									contextInfo: {
										externalAdReply: {
											title: "Template Message",
											body: "Baileys WhatsApp API",
											showAdAttribution: true
										}
									}
								}, msg.key.remoteJid!);
							}

							// MENSAGEM INTERATIVA
							if (text === "!interactive") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									interactiveMessage: {
										body: { text: "Esta é uma mensagem interativa" },
										footer: { text: "Rodapé interativo" },
										header: { title: "Título Interativo", hasMediaAttachment: false },
										nativeFlowMessage: {
											buttons: [
												{
													name: "quick_reply",
													buttonParamsJson: JSON.stringify({
														display_text: "Resposta Rápida",
														id: "quick_reply_1"
													})
												}
											]
										}
									}
								}, msg.key.remoteJid!);
							}

							// LIVE LOCATION
							if (text === "!livelocation") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									liveLocation: {
										degreesLatitude: -23.550520,
										degreesLongitude: -46.633308,
										accuracyInMeters: 100,
										speedInMps: 0,
										degreesClockwiseFromMagneticNorth: 0,
										caption: "Localização ao vivo de exemplo",
										sequenceNumber: Date.now(),
										timeOffset: 0,
										jpegThumbnail: null
									}
								}, msg.key.remoteJid!);
							}

							// EDITAR MENSAGEM
							if (text === "!edit") {
								await sock.readMessages([msg.key]);
								// Primeiro envia uma mensagem
								const sentMsg = await sock.sendMessage(msg.key.remoteJid!, {
									text: "Esta mensagem será editada em 3 segundos..."
								});
								// Aguarda 3 segundos e edita
								setTimeout(async () => {
									if (sentMsg?.key) {
										await sock.sendMessage(msg.key.remoteJid!, {
											text: "Mensagem editada! ✏️",
											edit: sentMsg.key
										});
									}
								}, 3000);
							}

							// DELETAR MENSAGEM
							if (text === "!delete") {
								await sock.readMessages([msg.key]);
								// Primeiro envia uma mensagem
								const sentMsg = await sock.sendMessage(msg.key.remoteJid!, {
									text: "Esta mensagem será deletada em 3 segundos..."
								});
								// Aguarda 3 segundos e deleta
								setTimeout(async () => {
									if (sentMsg?.key) {
										await sock.sendMessage(msg.key.remoteJid!, {
											delete: sentMsg.key
										});
									}
								}, 3000);
							}

							// VIEW ONCE (VISUALIZAÇÃO ÚNICA)
							if (text === "!viewonce") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									image: { url: 'https://picsum.photos/400/300' },
									caption: 'Esta imagem só pode ser vista uma vez!',
									viewOnce: true
								}, msg.key.remoteJid!);
							}

							// FORWARD (ENCAMINHAR)
							if (text === "!forward") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									forward: msg
								}, msg.key.remoteJid!);
							}

							// MENSAGENS EPHEMERAL (TEMPORÁRIAS)
							if (text === "!ephemeral") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									disappearingMessagesInChat: 86400 // 24 horas
								}, msg.key.remoteJid!);
								await sendMessageWTyping({
									text: "Esta mensagem desaparecerá em 24 horas!"
								}, msg.key.remoteJid!);
							}

							// === COMANDOS AVANÇADOS ===

							// GRUPO - CONVITE
							if (text === "!groupinvite") {
								await sock.readMessages([msg.key]);
								if (msg.key.remoteJid!.endsWith('@g.us')) {
									try {
										const code = await sock.groupInviteCode(msg.key.remoteJid!);
										await sendMessageWTyping({
											groupInvite: {
												inviteCode: code!,
												inviteExpiration: Date.now() + 86400000, // 24 horas
												text: "Convite para o grupo",
												jid: msg.key.remoteJid!,
												subject: "Grupo de Exemplo"
											}
										}, msg.key.remoteJid!);
									} catch (error) {
										await sendMessageWTyping({
											text: "Erro: Não foi possível gerar convite do grupo ou não tenho permissão."
										}, msg.key.remoteJid!);
									}
								} else {
									await sendMessageWTyping({
										text: "Este comando só funciona em grupos!"
									}, msg.key.remoteJid!);
								}
							}

							// STATUS BROADCAST
							if (text === "!status") {
								await sock.readMessages([msg.key]);
								try {
									await sock.sendMessage('status@broadcast', {
										text: "Esta é uma mensagem de status! 📢"
									});
									await sendMessageWTyping({
										text: "Status enviado com sucesso! ✅"
									}, msg.key.remoteJid!);
								} catch (error) {
									await sendMessageWTyping({
										text: "Erro ao enviar status. Verifique as permissões."
									}, msg.key.remoteJid!);
								}
							}

							// NEWSLETTER (Se suportado)
							if (text === "!newsletter") {
								await sock.readMessages([msg.key]);
								try {
									if (isJidNewsletter(msg.key.remoteJid!)) {
										await sendMessageWTyping({
											text: "Esta é uma mensagem para newsletter! 📰"
										}, msg.key.remoteJid!);
									} else {
										await sendMessageWTyping({
											text: "Este comando só funciona em newsletters!"
										}, msg.key.remoteJid!);
									}
								} catch (error) {
									await sendMessageWTyping({
										text: "Newsletters podem não estar disponíveis nesta conta."
									}, msg.key.remoteJid!);
								}
							}

							// COMPARTILHAR NÚMERO DE TELEFONE
							if (text === "!sharenumber") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									sharePhoneNumber: true
								}, msg.key.remoteJid!);
							}

							// SOLICITAR NÚMERO DE TELEFONE
							if (text === "!requestnumber") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									requestPhoneNumber: true
								}, msg.key.remoteJid!);
							}

							// DEVICE SENT MESSAGE
							if (text === "!device") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									deviceSentMessage: {
										destinationJid: msg.key.remoteJid!,
										message: {
											conversation: "Mensagem enviada via device!"
										}
									}
								}, msg.key.remoteJid!);
							}

							// PIN MESSAGE (FIXAR MENSAGEM)
							if (text === "!pin") {
								await sock.readMessages([msg.key]);
								const sentMsg = await sock.sendMessage(msg.key.remoteJid!, {
									text: "Esta mensagem será fixada!"
								});
								if (sentMsg?.key) {
									setTimeout(async () => {
										await sock.sendMessage(msg.key.remoteJid!, {
											pin: sentMsg.key,
											type: proto.PinInChat.Type.PIN_FOR_ALL,
											time: 86400 // 24 horas
										});
									}, 2000);
								}
							}

							// KEEP IN CHAT (MANTER NO CHAT)
							if (text === "!keep") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									keepInChat: {
										key: msg.key,
										keepType: proto.KeepType.KEEP_FOR_ALL
									}
								}, msg.key.remoteJid!);
							}

							// TESTE DE TODOS OS TIPOS DE BOTÃO
							if (text === "!allbuttons") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									text: "Teste completo de botões:",
									templateButtons: [
										{
											index: 1,
											urlButton: {
												displayText: '🌐 Visitar GitHub',
												url: 'https://github.com/WhiskeySockets/Baileys'
											}
										},
										{
											index: 2,
											callButton: {
												displayText: '📞 Ligar',
												phoneNumber: '+5511999999999'
											}
										},
										{
											index: 3,
											quickReplyButton: {
												displayText: '⚡ Resposta Rápida',
												id: 'quick_reply_test'
											}
										}
									],
									footer: "Teste de todos os tipos de botão disponíveis"
								}, msg.key.remoteJid!);
							}

							// POLL AVANÇADO
							if (text === "!polladvanced") {
								await sock.readMessages([msg.key]);
								await sendMessageWTyping({
									poll: {
										name: "📊 Enquete Avançada - Múltipla Escolha",
										values: [
											"🔥 Opção 1 - Muito interessante",
											"⭐ Opção 2 - Interessante",
											"👍 Opção 3 - Regular",
											"👎 Opção 4 - Não gostei",
											"❌ Opção 5 - Terrível"
										],
										selectableCount: 2, // Permite selecionar até 2 opções
										messageSecret: randomBytes(32) // Criptografia da enquete
									}
								}, msg.key.remoteJid!);
							}

							if (text === "!resyncapp") {
								// "critical_block" | "critical_unblock_low" | "regular_high" | "regular_low" | "regular"
								// resyncAppState
								await sock.readMessages([msg.key]);
								try {
									await sock.resyncAppState(["critical_block", "critical_unblock_low", "regular_high", "regular_low", "regular"], true);
								} catch (error) {
									console.error('Error resyncing app state:', error);
								}
							}

							// HELP - LISTA TODOS OS COMANDOS
							if (text === "!help" || text === "!comandos") {
								await sock.readMessages([msg.key]);
								const helpText = `
🤖 *COMANDOS DISPONÍVEIS* 🤖

📝 *TEXTO:*
!text - Texto simples
!format - Texto formatado
!mention - Texto com menção

📷 *MÍDIA:*
!image - Enviar imagem
!video - Enviar vídeo
!audio - Enviar áudio
!voice - Nota de voz
!document - Documento
!sticker - Sticker
!viewonce - Imagem visualização única

📍 *LOCALIZAÇÃO:*
!location - Localização
!livelocation - Localização ao vivo

👤 *CONTATO:*
!contact - Compartilhar contato

💬 *INTERAÇÃO:*
!react - Reagir mensagem
!poll - Criar enquete
!polladvanced - Enquete avançada
!buttons - Botões
!list - Lista de opções
!template - Template buttons
!interactive - Mensagem interativa
!allbuttons - Todos tipos de botão

✏️ *AÇÕES:*
!edit - Editar mensagem
!delete - Deletar mensagem
!forward - Encaminhar mensagem
!ephemeral - Mensagem temporária
!pin - Fixar mensagem
!keep - Manter no chat

🔧 *SISTEMA:*
!jid - Mostrar JID
!lid - Mostrar LID
!device - Device message
!sharenumber - Compartilhar número
!requestnumber - Solicitar número

👥 *GRUPO/STATUS:*
!groupinvite - Convite do grupo
!status - Enviar status
!newsletter - Mensagem newsletter

📋 *AJUDA:*
!help - Esta ajuda
!comandos - Lista de comandos
`;
								await sendMessageWTyping({
									text: helpText
								}, msg.key.remoteJid!);
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

			if (events['contacts.upsert']) {
				// console.log('contacts upserted ', events['contacts.upsert'])
				for (const contact of events['contacts.upsert']) {
					console.log('contact upserted', contact)
				}
			}

			if (events['contacts.update']) {
				for (const contact of events['contacts.update']) {
					console.log('contact updated', contact)
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
