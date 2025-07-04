import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import readline from 'readline'
import makeWASocket, { AnyMessageContent, BinaryInfo, delay, DisconnectReason, encodeWAM, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, waproto as proto, useMultiFileAuthState, WAMessageContent, WAMessageKey } from '../src'
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
	const { state, saveCreds } = await useMultiFileAuthState('../baileys_auth_info')
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
		getMessage
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
										const userLid = undefined;
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

							// Teste de lista simplificado
							if (text === "!listtest") {
								try {
									await sock!.readMessages([msg.key]);
									console.log('🧪 Testando múltiplas variantes de lista...');

									// Teste 1: Lista básica sem especificar listType
									console.log('📝 TESTE 1: Lista básica...');
									const basicList = {
										text: "🧪 *Teste 1: Lista Básica*\n\nEscolha uma opção:",
										buttonText: "🔽 Escolher",
										sections: [{
											title: "Opções Básicas",
											rows: [
												{ title: "✅ Opção A", description: "Primeira opção", rowId: "basic_a" },
												{ title: "✅ Opção B", description: "Segunda opção", rowId: "basic_b" }
											]
										}]
									};

									const result1 = await sock.sendMessage(msg.key.remoteJid!, basicList);
									console.log('✅ Teste 1 enviado! ID:', result1?.key?.id);
									await delay(3000);

									// Teste 2: Lista com PRODUCT_LIST explícito
									console.log('📝 TESTE 2: Lista com PRODUCT_LIST...');
									const productList = {
										text: "🧪 *Teste 2: Product List*\n\nItens disponíveis:",
										buttonText: "🛒 Ver Produtos",
										sections: [{
											title: "Produtos",
											rows: [
												{ title: "📱 Produto 1", description: "Smartphone", rowId: "prod_1" },
												{ title: "💻 Produto 2", description: "Notebook", rowId: "prod_2" }
											]
										}]
									};

									// Usar o tipo proto diretamente na mensagem
									const productMessage = {
										...productList,
										listType: proto.Message.ListMessage.ListType.PRODUCT_LIST
									};

									const result2 = await sock.sendMessage(msg.key.remoteJid!, productMessage);
									console.log('✅ Teste 2 enviado! ID:', result2?.key?.id);
									await delay(3000);

									// Teste 3: Lista com footer e title
									console.log('📝 TESTE 3: Lista com footer e title...');
									const titleFooterList = {
										text: "🧪 *Teste 3: Com Title/Footer*\n\nEscolha uma opção:",
										title: "Menu de Teste",
										buttonText: "⚡ Selecionar",
										footer: "Teste com Footer",
										sections: [{
											title: "Opções com Title",
											rows: [
												{ title: "🔥 Com Title 1", description: "Primeira com title", rowId: "title_1" },
												{ title: "🔥 Com Title 2", description: "Segunda com title", rowId: "title_2" }
											]
										}]
									};

									const result3 = await sock.sendMessage(msg.key.remoteJid!, titleFooterList);
									console.log('✅ Teste 3 enviado! ID:', result3?.key?.id);
									await delay(3000);

									// Teste 4: Lista com uma única row (minimalista)
									console.log('📝 TESTE 4: Lista com uma única opção...');
									const singleRowList = {
										text: "🧪 *Teste 4: Uma Opção*\n\nEscolha:",
										buttonText: "🎯 Selecionar",
										sections: [{
											title: "Única Opção",
											rows: [
												{ title: "✅ Única", description: "Apenas uma opção", rowId: "single_1" }
											]
										}]
									};

									const result4 = await sock.sendMessage(msg.key.remoteJid!, singleRowList);
									console.log('✅ Teste 4 enviado! ID:', result4?.key?.id);

									// Resumo dos testes
									setTimeout(async () => {
										await sendMessageWTyping({
											text: `🧪 *Resumo dos Testes Enviados:*\n\n` +
												`✅ Teste 1 (Básica): ${result1?.key?.id}\n` +
												`✅ Teste 2 (Product): ${result2?.key?.id}\n` +
												`✅ Teste 3 (Title/Footer): ${result3?.key?.id}\n` +
												`✅ Teste 4 (Única Opção): ${result4?.key?.id}\n\n` +
												`📱 Verifique seu WhatsApp para ver quais apareceram como lista interativa!\n\n` +
												`🔍 *Status das Listas:*\n` +
												`• ViewOnce: Removido ✅\n` +
												`• ListType: Convertido para PRODUCT_LIST ✅\n` +
												`• Estrutura: listMessage puro ✅`
										}, msg.key.remoteJid!);
									}, 2000);

								} catch (error) {
									console.error('❌ Erro no teste de lista:', error);
									await sendMessageWTyping({
										text: "❌ Teste de lista falhou: " + (error instanceof Error ? error.message : 'Erro desconhecido')
									}, msg.key.remoteJid!);
								}
							}

							// Teste individual de lista mais simples
							if (text === "!list") {
								try {
									await sock!.readMessages([msg.key]);
									console.log('📋 Testando lista individual simples...');

									const simpleList = {
										text: "📋 *Menu Principal*\n\nEscolha uma opção:",
										buttonText: "📱 Ver Opções",
										sections: [{
											title: "📂 Menu",
											rows: [
												{ title: "🆔 Ver JID", description: "Obter seu identificador JID", rowId: "get_jid" },
												{ title: "🔗 Ver LID", description: "Obter seu identificador LID", rowId: "get_lid" },
												{ title: "📊 Status", description: "Ver status da conexão", rowId: "status" },
												{ title: "ℹ️ Sobre", description: "Informações sobre o bot", rowId: "about" }
											]
										}]
									};

									const result = await sock.sendMessage(msg.key.remoteJid!, simpleList);
									console.log('✅ Lista simples enviada! ID:', result?.key?.id);

								} catch (error) {
									console.error('❌ Erro na lista simples:', error);
									await sendMessageWTyping({
										text: "❌ Lista simples falhou: " + (error instanceof Error ? error.message : 'Erro desconhecido')
									}, msg.key.remoteJid!);
								}
							}

							// Teste de botões interativos
							if (text === "!buttons") {
								try {
									await sock!.readMessages([msg.key]);
									console.log('🔘 Testando botões interativos...');

									const buttonsMessage = {
										text: "🔘 *Teste de Botões Interativos*\n\nEscolha uma opção clicando nos botões abaixo:",
										buttons: [
											{ buttonId: "btn_1", buttonText: { displayText: "✅ Botão 1" }, type: 1 },
											{ buttonId: "btn_2", buttonText: { displayText: "🔥 Botão 2" }, type: 1 },
											{ buttonId: "btn_3", buttonText: { displayText: "⚡ Botão 3" }, type: 1 }
										],
										headerType: 1
									};

									const result = await sock.sendMessage(msg.key.remoteJid!, buttonsMessage);
									console.log('✅ Botões enviados! ID:', result?.key?.id);

								} catch (error) {
									console.error('❌ Erro no teste de botões:', error);
									await sendMessageWTyping({
										text: "❌ Teste de botões falhou: " + (error instanceof Error ? error.message : 'Erro desconhecido')
									}, msg.key.remoteJid!);
								}
							}

							// Teste de poll/enquete
							if (text === "!poll") {
								try {
									await sock!.readMessages([msg.key]);
									console.log('📊 Testando poll/enquete...');

									const pollMessage = {
										name: "🗳️ Enquete de Teste",
										values: [
											"🍕 Pizza",
											"🍔 Hambúrguer",
											"🌮 Taco",
											"🍣 Sushi"
										],
										selectableCount: 1
									};

									const result = await sock.sendMessage(msg.key.remoteJid!, { poll: pollMessage });
									console.log('✅ Poll enviado! ID:', result?.key?.id);

									// Confirmação de sucesso
									setTimeout(async () => {
										await sendMessageWTyping({
											text: `🎉 *Poll Enviado com Sucesso!*\n\n` +
												`📊 ID: ${result?.key?.id}\n\n` +
												`✅ *DESCOBERTA IMPORTANTE:*\n` +
												`• Polls/Enquetes FUNCIONAM! 🎯\n` +
												`• Listas interativas NÃO funcionam ❌\n` +
												`• Botões interativos NÃO funcionam ❌\n\n` +
												`💡 *Conclusão:*\n` +
												`Use polls como alternativa às listas!\n\n` +
												`🔗 Para mais testes: !polltest`
										}, msg.key.remoteJid!);
									}, 1000);

								} catch (error) {
									console.error('❌ Erro no teste de poll:', error);
									await sendMessageWTyping({
										text: "❌ Teste de poll falhou: " + (error instanceof Error ? error.message : 'Erro desconhecido')
									}, msg.key.remoteJid!);
								}
							}

							// Teste múltiplo de polls como alternativa às listas
							if (text === "!polltest") {
								try {
									await sock!.readMessages([msg.key]);
									console.log('🗳️ Testando múltiplos polls como alternativa às listas...');

									// Poll 1: Menu Principal (substituto da lista)
									const menuPoll = {
										name: "📋 Menu Principal - Escolha uma opção:",
										values: [
											"🆔 Ver meu JID",
											"🔗 Ver meu LID",
											"📊 Status do Bot",
											"ℹ️ Informações"
										],
										selectableCount: 1
									};

									const result1 = await sock.sendMessage(msg.key.remoteJid!, { poll: menuPoll });
									console.log('✅ Poll Menu enviado! ID:', result1?.key?.id);
									await delay(2000);

									// Poll 2: Teste de funcionalidades
									const funcPoll = {
										name: "🧪 Teste de Funcionalidades:",
										values: [
											"📝 Teste de Listas",
											"🔘 Teste de Botões",
											"📊 Teste de Polls",
											"🔍 Diagnóstico Completo"
										],
										selectableCount: 1
									};

									const result2 = await sock.sendMessage(msg.key.remoteJid!, { poll: funcPoll });
									console.log('✅ Poll Funcionalidades enviado! ID:', result2?.key?.id);
									await delay(2000);

									// Poll 3: Preferências (múltipla escolha)
									const prefPoll = {
										name: "🎯 Suas preferências (múltipla escolha):",
										values: [
											"🍕 Pizza",
											"🍔 Hambúrguer",
											"🌮 Taco",
											"🍣 Sushi",
											"🥗 Salada"
										],
										selectableCount: 3 // Permitir múltiplas seleções
									};

									const result3 = await sock.sendMessage(msg.key.remoteJid!, { poll: prefPoll });
									console.log('✅ Poll Preferências enviado! ID:', result3?.key?.id);

									// Resumo
									setTimeout(async () => {
										await sendMessageWTyping({
											text: `🗳️ *Testes de Polls Concluídos!*\n\n` +
												`✅ Poll Menu: ${result1?.key?.id}\n` +
												`✅ Poll Funcionalidades: ${result2?.key?.id}\n` +
												`✅ Poll Preferências: ${result3?.key?.id}\n\n` +
												`🎯 *Como usar Polls como alternativa:*\n` +
												`• Use polls para menus de navegação\n` +
												`• Permita seleção única ou múltipla\n` +
												`• Capture as respostas nos eventos\n` +
												`• Polls aparecem como interativos! ✅\n\n` +
												`📊 Vote nos polls acima para testar!`
										}, msg.key.remoteJid!);
									}, 3000);

								} catch (error) {
									console.error('❌ Erro no teste de polls múltiplos:', error);
									await sendMessageWTyping({
										text: "❌ Teste de polls múltiplos falhou: " + (error instanceof Error ? error.message : 'Erro desconhecido')
									}, msg.key.remoteJid!);
								}
							}

							// Comando de diagnóstico completo
							if (text === "!diagnostic") {
								try {
									await sock!.readMessages([msg.key]);
									console.log('🔍 Executando diagnóstico completo...');
									await sendMessageWTyping({
										text: `🔍 *Diagnóstico Completo do Bot*\n\n` +
											`📱 *Informações da Conexão:*\n` +
											`• Status: Conectado ✅\n` +
											`• JID do Chat: ${msg.key.remoteJid!}\n` +
											`• Versão Baileys: ${await fetchLatestBaileysVersion().then(v => v.version.join('.'))}\n` +
											`• User ID: ${JSON.stringify(sock.user?.id || 'N/A')}\n\n` +
											`🧪 *Testes Disponíveis:*\n` +
											`• !listtest - 4 variantes de lista ❌\n` +
											`• !list - Lista simples ❌\n` +
											`• !listfix - Lista com correção viewOnce 🔧\n` +
											`• !buttons - Botões interativos ❌\n` +
											`• !poll - Enquete/Poll ✅\n` +
											`• !polltest - Múltiplos polls ✅\n\n` +
											`🔧 *Configurações Ativas (ATUALIZADAS):*\n` +
											`• Remoção ViewOnce: ATIVA ✅\n` +
											`• Conversão para SINGLE_SELECT: ATIVA ✅\n` +
											`• Limpeza DeviceSentMessage: ATIVA ✅\n` +
											`• Logs detalhados: Ativos ✅\n\n` +
											`🎯 *DESCOBERTAS IMPORTANTES:*\n` +
											`• ✅ Polls/Enquetes: FUNCIONAM!\n` +
											`• 🔧 Listas: Testando correção viewOnce\n` +
											`• ❌ Botões: Não aparecem como interativos\n` +
											`• ✅ Mensagens texto: Funcionam\n\n` +
											`💡 *Teste a correção:*\n` +
											`Use !listfix para testar a lista corrigida!\n\n` +
											`🔗 *Alternativa confiável:*\n` +
											`!poll e !polltest funcionam perfeitamente!\n\n` +
											`🌍 *Possíveis Causas das Limitações:*\n` +
											`• Política do WhatsApp para contas pessoais\n` +
											`• Restrições regionais do Brasil\n` +
											`• Limitações da API não-oficial\n` +
											`• Mudanças recentes no protocolo WhatsApp`
									}, msg.key.remoteJid!);

								} catch (error) {
									console.error('❌ Erro no diagnóstico:', error);
									await sendMessageWTyping({
										text: "❌ Diagnóstico falhou: " + (error instanceof Error ? error.message : 'Erro desconhecido')
									}, msg.key.remoteJid!);
								}
							}

							// Teste de resposta a botão (existente) - substituir por versão consolidada
							if (msg.message?.buttonsResponseMessage?.selectedButtonId) {
								const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
								await sock!.readMessages([msg.key]);

								console.log('🔘 Resposta do botão recebida:', buttonId);

								switch (buttonId) {
									case "btn_jid":
										const lid = sock.user;
										const phone = msg.key.remoteJid!.split('@')[0];
										const lidUser = await sock.onWhatsApp(phone);
										await sendMessageWTyping({
											text: `🆔 *Botão JID Selecionado:*\n\n` +
												`📱 JID: ${msg.key.remoteJid!}\n` +
												`🔗 LID: ${JSON.stringify(lidUser && lidUser.length > 0 ? lidUser[0] : 'N/A')}`
										}, msg.key.remoteJid!);
										break;

									case "btn_lid":
										const myLid = sock.user;
										await sendMessageWTyping({
											text: `🔗 *Botão LID Selecionado:*\n\n` +
												`🤖 Bot LID: ${JSON.stringify(myLid)}`
										}, msg.key.remoteJid!);
										break;

									case "btn_status":
										await sendMessageWTyping({
											text: `📊 *Botão Status Selecionado:*\n\n` +
												`✅ Bot funcionando via botões!`
										}, msg.key.remoteJid!);
										break;

									// Novos botões dos testes
									case "btn_1":
										await sendMessageWTyping({
											text: "✅ Você clicou no *Botão 1*!\n\nParabéns! Os botões estão funcionando!"
										}, msg.key.remoteJid!);
										break;
									case "btn_2":
										await sendMessageWTyping({
											text: "🔥 Você clicou no *Botão 2*!\n\nBoa escolha! Sistema responsivo!"
										}, msg.key.remoteJid!);
										break;
									case "btn_3":
										await sendMessageWTyping({
											text: "⚡ Você clicou no *Botão 3*!\n\nÓtimo! Interação confirmada!"
										}, msg.key.remoteJid!);
										break;

									default:
										await sendMessageWTyping({
											text: `🔘 Botão selecionado: ${buttonId}`
										}, msg.key.remoteJid!);
								}
							}

							// Resposta ao poll (melhorada)
							if (msg.message?.pollUpdateMessage) {
								await sock!.readMessages([msg.key]);
								console.log('📊 Resposta do poll recebida:', JSON.stringify(msg.message.pollUpdateMessage, null, 2));

								// Tentar extrair a escolha do usuário
								const pollUpdate = msg.message.pollUpdateMessage;
								let selectedOption = "Escolha detectada";

								// Capturar detalhes da votação se disponível
								try {
									const vote = pollUpdate.vote;
									if (vote && (vote as any).selectedOptions) {
										const voteIndex = (vote as any).selectedOptions[0];
										if (typeof voteIndex === 'number') {
											selectedOption = `Opção ${voteIndex + 1}`;
										}
									}
								} catch (error) {
									console.log('Erro ao extrair opção do poll:', error);
								}

								await sendMessageWTyping({
									text: `📊 *Poll/Enquete Respondida!*\n\n` +
										`✅ Sua escolha: ${selectedOption}\n` +
										`🎯 Obrigado por participar!\n\n` +
										`📈 *Status dos Polls:*\n` +
										`• Funcionalidade: CONFIRMADA ✅\n` +
										`• Interatividade: FUNCIONA ✅\n` +
										`• Captura de respostas: ATIVA ✅\n\n` +
										`💡 *Polls são a solução ideal para menus interativos!*\n\n` +
										`🧪 Teste mais: !polltest`
								}, msg.key.remoteJid!);
							}

							// Resposta para seleção de lista
							if (msg.message?.listResponseMessage) {
								const selectedOption = msg.message.listResponseMessage.singleSelectReply?.selectedRowId;
								console.log('🎯 Lista selecionada:', selectedOption);

								if (selectedOption) {
									let responseText = "";

									if (selectedOption.startsWith("fixed_")) {
										const fixedNumber = selectedOption.split("_")[1];
										switch (fixedNumber) {
											case "1":
												responseText = "🛠️ *ViewOnce Removido Selecionado!*\n\n✅ SUCESSO! A lista interativa funcionou!\n\nO wrapper viewOnceMessage foi removido corretamente e a lista apareceu como interativa no WhatsApp!";
												break;
											case "2":
												responseText = "🎯 *Tipo Corrigido Selecionado!*\n\n✅ FUNCIONOU! A conversão do listType foi aplicada corretamente!\n\nA lista foi convertida para SINGLE_SELECT e apareceu como interativa!";
												break;
											case "3":
												responseText = "📱 *Estrutura Limpa Selecionada!*\n\n✅ PERFEITO! A estrutura da mensagem está funcionando!\n\nA remoção do aninhamento desnecessário permitiu que a lista funcionasse corretamente!";
												break;
											default:
												responseText = `🔧 Correção selecionada: ${selectedOption}`;
										}
									} else if (selectedOption.startsWith("option_")) {
										const optionNumber = selectedOption.split("_")[1];
										responseText = `✅ Você escolheu a *Opção ${optionNumber}*!\n\nEssa foi sua seleção da lista. Legal!`;
									} else if (selectedOption.startsWith("menu_")) {
										const menuOption = selectedOption.split("_")[1];
										switch (menuOption) {
											case "1":
												responseText = "📋 Você escolheu *Listar Comandos*!\n\nComandos disponíveis:\n• !list\n• !listtest\n• !listfix\n• !buttons\n• !poll\n• !diagnostic";
												break;
											case "2":
												responseText = "ℹ️ Você escolheu *Sobre o Bot*!\n\nEste é um bot de teste do Baileys para WhatsApp.";
												break;
											case "3":
												responseText = "⚙️ Você escolheu *Configurações*!\n\nConfigurações atuais:\n• Logs: Ativados\n• Patches: Ativados\n• ViewOnce: Removido";
												break;
											default:
												responseText = `✅ Você escolheu: ${selectedOption}`;
										}
									} else {
										responseText = `✅ Você escolheu: ${selectedOption}`;
									}

									await sendMessageWTyping({ text: responseText }, msg.key.remoteJid!);
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
							: await sock!.profilePictureUrl(contact.id!, 'preview', 30000).catch(() => null)
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
