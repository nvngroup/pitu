import { Boom } from '@hapi/boom'
import { waproto } from '../../WAProto'
import { WA_DEFAULT_EPHEMERAL } from '../Defaults'
import { AnyMessageContent, CacheStore, GroupMetadata, MediaConnInfo, MessageReceiptType, MessageRelayOptions, MiscMessageGenerationOptions, nativeFlowSpecials, SocketConfig, WAMessageKey } from '../Types'
import { aggregateMessageKeysNotFromMe, assertMediaContent, bindWaitForEvent, decryptMediaRetryData, delay, encodeSignedDeviceIdentity, encodeWAMessage, encryptMediaRetryRequest, extractDeviceJids, generateMessageIDV2, generateParticipantHashV2, generateWAMessage, getContentType, getStatusCodeForMediaRetry, getUrlFromDirectPath, getWAUploadToServer, makeMessageRelayMutex, normalizeMessageContent, parseAndInjectE2ESessions, unixTimestampSeconds } from '../Utils'
import { getUrlInfo } from '../Utils/link-preview'
import { areJidsSameUser, BinaryNode, BinaryNodeAttributes, getBinaryNodeChild, getBinaryNodeChildren, isHostedLidUser, isHostedPnUser, isJidGroup, isJidUser, isLidUser, isPnUser, jidDecode, jidEncode, jidNormalizedUser, JidWithDevice, S_WHATSAPP_NET } from '../WABinary'
import { USyncQuery, USyncQueryResult, USyncQueryResultList, USyncUser } from '../WAUSync'
import { CacheManager } from './cache-manager'
import ListType = waproto.Message.ListMessage.ListType;
import { LIDMappingStore } from '../Signal/lid-mapping'
import { MessageRetryManager } from '../Utils/message-retry-manager'
import { makeNewsletterSocket } from './newsletter'

export const makeMessagesSocket = (config: SocketConfig) => {
	const {
		logger,
		linkPreviewImageThumbnailWidth,
		generateHighQualityLinkPreview,
		options: axiosOptions,
		patchMessageBeforeSending,
		cachedGroupMetadata,
		enableRecentMessageCache,
		maxMsgRetryCount,
		messageRelayMaxConcurrent,
		messageRelayMaxQueueSize
	} = config
	const sock = makeNewsletterSocket(config)
	const {
		ev,
		authState,
		processingMutex,
		signalRepository,
		upsertMessage,
		query,
		fetchPrivacySettings,
		sendNode,
		groupMetadata,
		groupMetadataWithRetry,
		groupToggleEphemeral,
	} = sock

	const patchMessageRequiresBeforeSending = (msg: waproto.IMessage): waproto.IMessage => {
		if (msg?.deviceSentMessage?.message?.listMessage) {
			msg = JSON.parse(JSON.stringify(msg))
			msg.deviceSentMessage!.message.listMessage.listType = waproto.Message.ListMessage.ListType.SINGLE_SELECT
		}

		if (msg?.listMessage) {
			msg = JSON.parse(JSON.stringify(msg))
			msg.listMessage!.listType = waproto.Message.ListMessage.ListType.SINGLE_SELECT
		}

		return msg
	}

	const messageRetryManager = enableRecentMessageCache ? new MessageRetryManager(logger, maxMsgRetryCount) : null

	const messageRelayMutex = makeMessageRelayMutex({
		maxConcurrent: messageRelayMaxConcurrent,
		maxQueueSize: messageRelayMaxQueueSize
	})

	const userDevicesCache: CacheStore = config.userDevicesCache || CacheManager.getInstance('USER_DEVICES')
	const peerSessionsCache: CacheStore =	CacheManager.getInstance('PEER_SESSIONS')

	let mediaConn: Promise<MediaConnInfo>
	const refreshMediaConn = async(forceGet = false) => {
		const media: MediaConnInfo = await mediaConn
		if (!media || forceGet || (new Date().getTime() - media.fetchDate.getTime()) > media.ttl * 1000) {
			mediaConn = (async() => {
				const result: BinaryNode = await query({
					tag: 'iq',
					attrs: {
						type: 'set',
						xmlns: 'w:m',
						to: S_WHATSAPP_NET,
					},
					content: [ { tag: 'media_conn', attrs: { } } ]
				})
				const mediaConnNode: BinaryNode | undefined = getBinaryNodeChild(result, 'media_conn')
				const node: MediaConnInfo = {
					hosts: getBinaryNodeChildren(mediaConnNode, 'host').map(
						({ attrs }) => ({
							hostname: attrs.hostname,
							maxContentLengthBytes: +attrs.maxContentLengthBytes,
						})
					),
					auth: mediaConnNode!.attrs.auth,
					ttl: +mediaConnNode!.attrs.ttl,
					fetchDate: new Date()
				}
				logger.debug({}, 'fetched media conn')
				return node
			})()
		}

		return mediaConn
	}

	/**
			* generic send receipt function
			* used for receipts of phone call, read, delivery etc.
			* */
	const sendReceipt = async(jid: string, participant: string | undefined, messageIds: string[], type: MessageReceiptType) => {
		const node: BinaryNode = {
			tag: 'receipt',
			attrs: {
				id: messageIds[0],
			},
		}
		const isReadReceipt: boolean = type === 'read' || type === 'read-self'
		if (isReadReceipt) {
			node.attrs.t = unixTimestampSeconds().toString()
		}

		if (type === 'sender' && isJidUser(jid)) {
			node.attrs.recipient = jid
			node.attrs.to = participant!
		} else {
			node.attrs.to = jid
			if (participant) {
				node.attrs.participant = participant
			}
		}

		if (type) {
			node.attrs.type = type
		}

		const remainingMessageIds: string[] = messageIds.slice(1)
		if (remainingMessageIds.length) {
			node.content = [
				{
					tag: 'list',
					attrs: { },
					content: remainingMessageIds.map(id => ({
						tag: 'item',
						attrs: { id }
					}))
				}
			]
		}

		logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages')
		await sendNode(node)
	}

	const sendReceipts = async(keys: WAMessageKey[], type: MessageReceiptType) => {
		const recps = aggregateMessageKeysNotFromMe(keys)
		for (const { jid, participant, messageIds } of recps) {
			await sendReceipt(jid, participant, messageIds, type)
		}
	}

	const readMessages = async(keys: WAMessageKey[]) => {
		const privacySettings = await fetchPrivacySettings()
		const readType: MessageReceiptType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self'
		await sendReceipts(keys, readType)
 	}

	const getUSyncDevices = async(jids: string[], useCache: boolean, ignoreZeroDevices: boolean) => {
		const deviceResults: JidWithDevice[] = []

		if (!useCache) {
			logger.debug({ jids, ignoreZeroDevices }, 'not using cache for devices')
		}

		const toFetch: string[] = []
		jids = Array.from(new Set(jids))

		for (let jid of jids) {
			const user: string | undefined = jidDecode(jid)?.user
			jid = jidNormalizedUser(jid)
			if (useCache) {
				const devices: JidWithDevice[] | undefined = userDevicesCache.get<JidWithDevice[]>(user!)
				if (devices && devices.length > 0) {
					deviceResults.push(...devices)
					logger.trace({ user, deviceCount: devices.length }, 'using cache for devices')
				} else {
					logger.trace({ user }, 'no cached devices found, will fetch')
					toFetch.push(jid)
				}
			} else {
				toFetch.push(jid)
			}
		}

		if (!toFetch.length) {
			logger.debug({ cachedDeviceCount: deviceResults.length }, 'using all cached devices')
			return deviceResults
		}

		logger.debug({ toFetch, ignoreZeroDevices }, 'fetching devices from server')

		const query: USyncQuery = new USyncQuery()
			.withContext('message')
			.withDeviceProtocol()

		for (const jid of toFetch) {
			query.withUser(new USyncUser().withId(jid))
		}

		try {
			const result: USyncQueryResult | undefined = await sock.executeUSyncQuery(query)

			if (result) {
				const lidResults: USyncQueryResultList[] = result.list.filter(a => !!a.lid)
				if (lidResults.length > 0) {
					logger.trace({}, 'Storing LID maps from device call')
					await signalRepository.getLIDMappingStore().storeLIDPNMappings(lidResults.map(a => ({ lidUser: a.lid as string, pnUser: a.id })))

					// Force-refresh sessions for newly mapped LIDs to align identity addressing
					try {
						const lids: string[] = lidResults.map(a => a.lid as string)
						if (lids.length) {
							await assertSessions(lids, true)
						}
					} catch (e) {
						logger.warn({ e, count: lidResults.length }, 'failed to assert sessions for newly mapped LIDs')
					}
				}

				const extracted: JidWithDevice[] = extractDeviceJids(result?.list, authState.creds.me!.id, ignoreZeroDevices)
				logger.debug({ extractedCount: extracted.length, ignoreZeroDevices }, 'extracted devices from server')

				if (extracted.length === 0) {
					logger.warn({ toFetch, ignoreZeroDevices }, 'no devices extracted from USyncQuery result')
				}

				const deviceMap: { [_: string]: JidWithDevice[] } = {}

				for (const item of extracted) {
					deviceMap[item.user] = deviceMap[item.user] || []
					deviceMap[item.user].push(item)

					deviceResults.push(item)
				}

				for (const key in deviceMap) {
					userDevicesCache.set(key, deviceMap[key])
					logger.debug({ user: key, deviceCount: deviceMap[key].length }, 'cached devices for user')
				}
			} else {
				logger.warn({ toFetch }, 'USyncQuery returned no result')
			}
		} catch (error) {
			logger.error({ error: error.message, toFetch }, 'error fetching devices from server')
		}

		logger.debug({ totalDevices: deviceResults.length }, 'total devices found')
		return deviceResults
	}

	const assertSessions = async(jids: string[], force: boolean) => {
		let didFetchNewSession = false
		let jidsRequiringFetch: string[] = []
		if (force) {
			jidsRequiringFetch = jids
		} else {
			const addrs: string[] = jids.map(jid => (
				signalRepository
					.jidToSignalProtocolAddress(jid)
			))
			const sessions = await authState.keys.get('session', addrs)
			for (const jid of jids) {
				const signalId: string = signalRepository
					.jidToSignalProtocolAddress(jid)
				if (!sessions[signalId]) {
					jidsRequiringFetch.push(jid)
				}
			}
		}

		if (jidsRequiringFetch.length) {
			const wireJids: string[] = [
				...jidsRequiringFetch.filter(jid => !!isLidUser(jid) || !!isHostedLidUser(jid)),
				...(
					(await signalRepository.getLIDMappingStore().getLIDsForPNs(
						jidsRequiringFetch.filter(jid => !!isPnUser(jid) || !!isHostedPnUser(jid))
					)) || []
				).map(a => a.lidUser)
			]

			logger.debug({ jidsRequiringFetch, wireJids }, 'fetching sessions')
			const result: BinaryNode = await query({
				tag: 'iq',
				attrs: {
					xmlns: 'encrypt',
					type: 'get',
					to: S_WHATSAPP_NET
				},
				content: [
					{
						tag: 'key',
						attrs: {},
						content: wireJids.map(jid => {
							const attrs: { [key: string]: string } = { jid }
							if (force) {
								attrs.reason = 'identity'
							}

							return { tag: 'user', attrs }
						})
					}
				]
			})
			await parseAndInjectE2ESessions(result, signalRepository)
			didFetchNewSession = true

			// Cache fetched sessions using wire JIDs
			for (const wireJid of wireJids) {
				const signalId: string = signalRepository.jidToSignalProtocolAddress(wireJid)
				peerSessionsCache.set(signalId, true)
			}
		}

		return didFetchNewSession
	}

	const sendPeerDataOperationMessage = async(
		pdoMessage: waproto.Message.IPeerDataOperationRequestMessage
	): Promise<string> => {
		//TODO: for later, abstract the logic to send a Peer Message instead of just PDO - useful for App State Key Resync with phone
		if (!authState.creds.me?.id) {
			throw new Boom('Not authenticated')
		}

		const protocolMessage: waproto.IMessage = {
			protocolMessage: {
				peerDataOperationRequestMessage: pdoMessage,
				type: waproto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
			}
		}

		const meJid: string = jidNormalizedUser(authState.creds.me.id)

		const msgId: string = await relayMessage(meJid, protocolMessage, {
			additionalAttributes: {
				category: 'peer',
				push_priority: 'high_force',
			},
		})

		return msgId
	}

	const createParticipantNodes = async(
		jids: string[],
		message: waproto.IMessage,
		extraAttrs?: BinaryNode['attrs']
	) => {
		const patched: waproto.IMessage = await patchMessageBeforeSending(message, jids)
		const requiredPatched: waproto.IMessage = patchMessageRequiresBeforeSending(patched)
		const bytes: Buffer = encodeWAMessage(requiredPatched)

		let shouldIncludeDeviceIdentity = false
		const nodes: BinaryNode[] = await Promise.all(
			jids.map(
				async jid => {
					const { type, ciphertext } = await signalRepository
						.encryptMessage({ jid, data: bytes })
					if (type === 'pkmsg') {
						shouldIncludeDeviceIdentity = true
					}

					const node: BinaryNode = {
						tag: 'to',
						attrs: { jid },
						content: [{
							tag: 'enc',
							attrs: {
								v: '2',
								type,
								...extraAttrs || {}
							},
							content: ciphertext
						}]
					}
					return node
				}
			)
		)
		return { nodes, shouldIncludeDeviceIdentity }
	}

	const relayMessage = async(
		jid: string,
		message: waproto.IMessage,
		{
			messageId: msgId,
			participant,
			additionalAttributes,
			additionalNodes,
			useUserDevicesCache,
			useCachedGroupMetadata,
			statusJidList
		}: MessageRelayOptions
	) => {
		return messageRelayMutex.mutex(async() => {
			const stats = messageRelayMutex.getStats()
			logger.debug(
				{
					jid,
					msgId,
					activeMessages: stats.activeCount,
					queuedMessages: stats.queueSize,
					maxConcurrent: stats.maxConcurrent
				},
				'relaying message with mutex control'
			)

			return await relayMessageInternal(
				jid,
				message,
				{
					messageId: msgId,
					participant,
					additionalAttributes,
					additionalNodes,
					useUserDevicesCache,
					useCachedGroupMetadata,
					statusJidList
				}
			)
		})
	}

	const relayMessageInternal = async(
		jid: string,
		message: waproto.IMessage,
		{
			messageId: msgId,
			participant,
			additionalAttributes,
			additionalNodes,
			useUserDevicesCache,
			useCachedGroupMetadata,
			statusJidList
		}: MessageRelayOptions
	) => {
		const meId: string = authState.creds.me!.id
		const meLid: string | undefined = authState.creds.me!.lid
		const isRetryResend = Boolean(participant?.jid)
		let shouldIncludeDeviceIdentity: boolean = isRetryResend

		const { user, server } = jidDecode(jid)!
		const statusJid = 'status@broadcast'
		const isGroup: boolean = server === 'g.us'
		const isStatus: boolean = jid === statusJid
		const isLid: boolean = server === 'lid'
		const isNewsletter: boolean = server === 'newsletter'
		const isGroupOrStatus: boolean = isGroup || isStatus
		const finalJid: string = jid

		msgId = msgId || generateMessageIDV2(sock.user?.id)
		useUserDevicesCache = useUserDevicesCache !== false
		useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus

		const participants: BinaryNode[] = []
		const destinationJid: string = (!isStatus) ? jidEncode(user, isLid ? 'lid' : isGroup ? 'g.us' : 's.whatsapp.net') : statusJid
		const binaryNodeContent: BinaryNode[] = []
		const devices: JidWithDevice[] = []

		const meMsg: waproto.IMessage = {
			deviceSentMessage: {
				destinationJid,
				message
			},
			messageContextInfo: message.messageContextInfo
		}

		const extraAttrs = {}

		const normalizedMessage: waproto.IMessage | undefined = normalizeMessageContent(message)
		const isInteractiveMessage: boolean = getContentType(normalizedMessage) === 'interactiveMessage'

		if (participant && !isInteractiveMessage) {
			if (!isGroup && !isStatus) {
				additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' }
			}

			const { user, device } = jidDecode(participant.jid)! // rajeh: how does this even make sense TODO check out
			devices.push({ user, device })
		}

		if (isInteractiveMessage) {
			additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' }
		}

		await authState.keys.transaction(
			async() => {
				const mediaType = getMediaType(message)
				if (mediaType) {
					extraAttrs['mediatype'] = mediaType
				}

				if (normalizeMessageContent(message)?.pinInChatMessage) {
					extraAttrs['decrypt-fail'] = 'hide' // TODO: expand for reactions and other types
				}

				if (isGroupOrStatus && !isRetryResend) {
					const [groupData, senderKeyMap] = await Promise.all([
						(async() => {
							let groupData: GroupMetadata | undefined = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined // TODO: should we rely on the cache specially if the cache is outdated and the metadata has new fields?
							if (groupData && Array.isArray(groupData?.participants)) {
								logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata')
							} else if (!isStatus) {
								try {
									groupData = await groupMetadataWithRetry(jid, 3, 300_000)
								} catch (error) {
									logger.warn({ jid, error }, 'failed to get group metadata with retry, falling back to regular call')
									groupData = await groupMetadata(jid)
								}
							}

							return groupData
						})(),
						(async() => {
							if (!participant && !isStatus) {
								const result = await authState.keys.get('sender-key-memory', [jid]) // TODO: check out what if the sender key memory doesn't include the LID stuff now?
								return result[jid] || { }
							}

							return { }
						})()
					])

					const participantsList = groupData ? groupData.participants.map(p => p.id) : []
					if (groupData?.ephemeralDuration && groupData.ephemeralDuration > 0) {
						additionalAttributes = {
							...additionalAttributes,
							expiration: groupData.ephemeralDuration.toString()

						}
					}

					if (isStatus && statusJidList) {
						participantsList.push(...statusJidList)
					}

					const additionalDevices: JidWithDevice[] = await getUSyncDevices(participantsList, !!useUserDevicesCache, false)
					devices.push(...additionalDevices)

					if (isGroup) {
						additionalAttributes = {
							...additionalAttributes,
							addressing_mode: groupData?.addressingMode || 'lid'
						}
					}

					const patched: waproto.IMessage = await patchMessageBeforeSending(message, devices.map(d => jidEncode(d.user, isLid ? 'lid' : 's.whatsapp.net', d.device)))
					const requiredPatched: waproto.IMessage = patchMessageRequiresBeforeSending(patched)
					const bytes: Buffer = encodeWAMessage(requiredPatched)
					const groupAddressingMode: string = additionalAttributes?.['addressing_mode'] || groupData?.addressingMode || 'lid'
					const groupSenderIdentity: string = groupAddressingMode === 'lid' && meLid ? meLid : meId

					const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage(
						{
							group: destinationJid,
							data: bytes,
							meId: groupSenderIdentity,
						}
					)

					const senderKeyJids: string[] = []
					for (const { user, device } of devices) {
						const jid: string = jidEncode(user, groupData?.addressingMode === 'lid' ? 'lid' : 's.whatsapp.net', device)
						if (!senderKeyMap[jid] || !!isRetryResend) {
							senderKeyJids.push(jid)
							senderKeyMap[jid] = true
						}
					}

					if (senderKeyJids.length) {
						logger.debug({ senderKeyJids }, 'sending new sender key')

						const senderKeyMsg: waproto.IMessage = {
							senderKeyDistributionMessage: {
								axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
								groupId: destinationJid
							}
						}

						await assertSessions(senderKeyJids, false)

						const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs)
						shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity

						participants.push(...result.nodes)
					}

					binaryNodeContent.push({
						tag: 'enc',
						attrs: { v: '2', type: 'skmsg', ...extraAttrs },
						content: ciphertext
					})
					await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } })
				} else {
					// TODO: investigate if this is true
					let ownId: string = meId
					if (isLid && meLid) {
						ownId = meLid
						logger.debug({ to: jid, ownId }, 'Using LID identity for @lid conversation')
					} else {
						logger.debug({ to: jid, ownId }, 'Using PN identity for @s.whatsapp.net conversation')
					}

					const { user: ownUser } = jidDecode(ownId)!

					if (!isRetryResend) {
						const targetUserServer: 'lid' | 's.whatsapp.net' = isLid ? 'lid' : 's.whatsapp.net'
						devices.push({
							user,
							device: 0,
							jid: jidEncode(user, targetUserServer, 0) // TODO: this entire logic is convoluted and weird.
						})

						if (user !== ownUser) {
							const ownUserServer: 'lid' | 's.whatsapp.net' = isLid ? 'lid' : 's.whatsapp.net'
							const ownUserForAddressing: string = isLid && meLid ? jidDecode(meLid)!.user : jidDecode(meId)!.user

							devices.push({
								user: ownUserForAddressing,
								device: 0,
								jid: jidEncode(ownUserForAddressing, ownUserServer, 0)
							})
						}

						if (additionalAttributes?.['category'] !== 'peer') {
							devices.length = 0

							const senderIdentity: string =
								isLid && meLid
									? jidEncode(jidDecode(meLid)?.user!, 'lid', undefined)
									: jidEncode(jidDecode(meId)?.user!, 's.whatsapp.net', undefined)

							const sessionDevices: JidWithDevice[] = await getUSyncDevices([senderIdentity, jid], true, false)
							devices.push(...sessionDevices)

							logger.debug(
								{
									deviceCount: devices.length,
									devices: devices.map(d => `${d.user}:${d.device}@${jidDecode(d.jid)?.server}`)
								},
								'Device enumeration complete with unified addressing'
							)
						}
					}

					const allRecipients: string[] = []
					const meRecipients: string[] = []
					const otherRecipients: string[] = []
					const { user: mePnUser } = jidDecode(meId)!
					const { user: meLidUser } = meLid ? jidDecode(meLid)! : { user: null }

					for (const { user, jid } of devices) {
						const isExactSenderDevice: boolean = jid === meId || jid === meLid
						if (isExactSenderDevice) {
							logger.debug({ jid, meId, meLid }, 'Skipping exact sender device (whatsmeow pattern)')
							continue
						}

						// Check if this is our device (could match either PN or LID user)
						const isMe: boolean = user === mePnUser || user === meLidUser

						if (jid) {
							if (isMe) {
								meRecipients.push(jid)
							} else {
								otherRecipients.push(jid)
							}

							allRecipients.push(jid)
						}
					}

					logger.debug({ allRecipientsCount: allRecipients.length, meRecipientsCount: meRecipients.length, otherRecipientsCount: otherRecipients.length }, 'prepared jids for encryption')

					await assertSessions(allRecipients, false)

					const [
						{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 },
						{ nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }
					] = await Promise.all([
						createParticipantNodes(meRecipients, meMsg || message, extraAttrs),
						createParticipantNodes(otherRecipients, message, extraAttrs)
					])
					participants.push(...meNodes)
					participants.push(...otherNodes)

					if (meRecipients.length > 0 || otherRecipients.length > 0) {
						extraAttrs['phash'] = generateParticipantHashV2([...meRecipients, ...otherRecipients])
					}

					shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2
				}

				if (isRetryResend) {
					const isParticipantLid: boolean | undefined = isLidUser(participant!.jid)
					const isMe: boolean = areJidsSameUser(participant!.jid, isParticipantLid ? meLid : meId)

					const encodedMessageToSend: Buffer = isMe
						? encodeWAMessage({
							deviceSentMessage: {
								destinationJid,
								message
							}
						})
						: encodeWAMessage(message)

					const { type, ciphertext: encryptedContent } = await signalRepository.encryptMessage({
						data: encodedMessageToSend,
						jid: participant!.jid
					})

					binaryNodeContent.push({
						tag: 'enc',
						attrs: {
							v: '2',
							type,
							count: participant!.count.toString()
						},
						content: encryptedContent
					})
				}

				if (participants.length) {
					if (additionalAttributes?.['category'] === 'peer') {
						const peerNode = participants[0]?.content?.[0] as BinaryNode
						if (peerNode) {
							binaryNodeContent.push(peerNode)
						}
					} else {
						binaryNodeContent.push({
							tag: 'participants',
							attrs: { },
							content: participants
						})
					}
				} else {
					logger.warn({ jid, msgId, isGroup, isStatus }, 'no participants to send message, message may not be delivered')
				}

				const stanza: BinaryNode = {
					tag: 'message',
					attrs: {
						id: msgId,
						type: getMessageType(message),
						...(additionalAttributes || {})
					},
					content: binaryNodeContent
				}

				if (participant) {
					if (isJidGroup(destinationJid)) {
						stanza.attrs.to = destinationJid
						stanza.attrs.participant = participant.jid
					} else if (areJidsSameUser(participant.jid, meId)) {
						stanza.attrs.to = participant.jid
						stanza.attrs.recipient = destinationJid
					} else {
						stanza.attrs.to = participant.jid
					}
				} else {
					stanza.attrs.to = destinationJid
				}

				if (shouldIncludeDeviceIdentity) {
					(stanza.content as BinaryNode[]).push({
						tag: 'device-identity',
						attrs: { },
						content: encodeSignedDeviceIdentity(authState.creds.account!, true)
					})

					logger.debug({ jid }, 'adding device identity')
				}

				const contactTcToken =
					!isGroup && !isRetryResend && !isStatus
						? await authState.keys.get('contacts-tc-token', [destinationJid])
						: {}

				const tcTokenBuffer = contactTcToken[destinationJid]?.token

				if (tcTokenBuffer) {
					(stanza.content as BinaryNode[]).push({
						tag: 'tctoken',
						attrs: {},
						content: tcTokenBuffer
					})
				}

				const nativeFlow = message?.interactiveMessage?.nativeFlowMessage ||
								  message?.viewOnceMessage?.message?.interactiveMessage?.nativeFlowMessage ||
								  message?.viewOnceMessageV2?.message?.interactiveMessage?.nativeFlowMessage ||
								  message?.viewOnceMessageV2Extension?.message?.interactiveMessage?.nativeFlowMessage

				const firstButtonName = nativeFlow?.buttons?.[0]?.name

				const buttonType = getButtonType(message)
				if (buttonType) {
					const bizNode: BinaryNode = { tag: 'biz', attrs: {} }

					if (nativeFlow && (firstButtonName === 'review_and_pay' || firstButtonName === 'payment_info')) {
						bizNode.attrs = {
							native_flow_name: firstButtonName === 'review_and_pay' ? 'order_details' : firstButtonName
						}
					} else if (nativeFlow && nativeFlowSpecials.includes(firstButtonName || '')) {
						bizNode.content = [{
							tag: 'biz',
							attrs: {
								actual_actors: '2',
								host_storage: '2',
								privacy_mode_ts: unixTimestampSeconds().toString()
							},
							content: [{
								tag: 'interactive',
								attrs: {
									type: 'native_flow',
									v: '1'
								},
								content: [{
									tag: 'native_flow',
									attrs: {
										v: '2',
										name: firstButtonName || 'mixed'
									}
								}]
							},
							{
								tag: 'quality_control',
								attrs: {
									source_type: 'third_party'
								}
							}]
						}]
					} else if (nativeFlow || message?.buttonsMessage ||
							   message?.viewOnceMessage?.message?.buttonsMessage ||
							   message?.viewOnceMessageV2?.message?.buttonsMessage ||
							   message?.viewOnceMessageV2Extension?.message?.buttonsMessage) {
						bizNode.attrs = {
							actual_actors: '2',
							host_storage: '2',
							privacy_mode_ts: unixTimestampSeconds().toString()
						}
						bizNode.content = [{
							tag: 'interactive',
							attrs: {
								type: 'native_flow',
								v: '1'
							},
							content: [{
								tag: 'native_flow',
								attrs: {
									v: '9',
									name: 'mixed'
								}
							}]
						}]
					} else if (message?.listMessage) {
						bizNode.content = [{
							tag: 'list',
							attrs: {
								type: 'product_list',
								v: '2'
							}
						}]
					} else {
						bizNode.content = [
							{
								tag: buttonType,
								attrs: firstButtonName ? getButtonAttrs(message, nativeFlowSpecials.indexOf(firstButtonName) !== -1 ? firstButtonName : undefined) : getButtonAttrs(message),
								content: firstButtonName ? getButtonContent(message, nativeFlowSpecials.indexOf(firstButtonName) !== -1 ? firstButtonName : undefined) : getButtonContent(message)
							}
						]
					}

					(stanza.content as BinaryNode[]).push(bizNode)

					logger.debug({ jid }, 'adding business node')
				}

				if (additionalNodes && additionalNodes.length > 0) {
					(stanza.content as BinaryNode[]).push(...additionalNodes)
				}

				logger.debug({ msgId }, `sending message to ${participants.length} devices`)

				await sendNode(stanza)

				if (messageRetryManager && !participant) {
					messageRetryManager.addRecentMessage(destinationJid, msgId, message)
				}
			}
		)

		return msgId
	}

	const getMessageType = (message: waproto.IMessage) => {
		if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) {
			return 'poll'
		}

		if (message.eventMessage) {
			return 'event'
		}

		return 'text'
	}

	const getMediaType = (message: waproto.IMessage) => {
		if (message.imageMessage) {
			return 'image'
		} else if (message.videoMessage) {
			return message.videoMessage.gifPlayback ? 'gif' : 'video'
		} else if (message.audioMessage) {
			return message.audioMessage.ptt ? 'ptt' : 'audio'
		} else if (message.contactMessage) {
			return 'vcard'
		} else if (message.documentMessage) {
			return 'document'
		} else if (message.contactsArrayMessage) {
			return 'contact_array'
		} else if (message.liveLocationMessage) {
			return 'livelocation'
		} else if (message.stickerMessage) {
			return 'sticker'
		} else if (message.listMessage) {
			return 'list'
		} else if (message.listResponseMessage) {
			return 'list_response'
		} else if (message.buttonsResponseMessage) {
			return 'buttons_response'
		} else if (message.orderMessage) {
			return 'order'
		} else if (message.productMessage) {
			return 'product'
		} else if (message.interactiveResponseMessage) {
			return 'native_flow_response'
		} else if (message.groupInviteMessage) {
			return 'url'
		}
	}

	const getButtonType = (message: waproto.IMessage) => {
		if (message.buttonsMessage) {
			return 'buttons'
		} else if (message.interactiveMessage?.nativeFlowMessage) {
			return 'interactive'
		} else if (message.buttonsResponseMessage) {
			return 'buttons_response'
		} else if (message.interactiveResponseMessage) {
			return 'interactive_response'
		} else if (message.listMessage) {
			return 'list'
		} else if (message.listResponseMessage) {
			return 'list_response'
		}
	}

	const getButtonAttrs = (message: waproto.IMessage, nativeFlowSpecial?: string): BinaryNode['attrs'] => {
		if (message.interactiveMessage?.nativeFlowMessage) {
			switch (nativeFlowSpecial) {
			case 'review_and_pay':
			case 'payment_info':
				return {
					native_flow_name: nativeFlowSpecial === 'review_and_pay' ? 'order_details' : nativeFlowSpecial
				}
			case 'galaxy_message':
				return {
					actual_actors: '2',
					host_storage: '2',
					privacy_mode_ts: unixTimestampSeconds().toString()
				}
			default:
				return {
					actual_actors: '2',
					host_storage: '2',
					privacy_mode_ts: unixTimestampSeconds().toString()
				}
			}
		} else if (message.templateMessage) {
			return {}
		} else if (message.listMessage) {
			const type: waproto.Message.ListMessage.ListType | null | undefined = message.listMessage.listType
			if (!type) {
				throw new Boom('Expected list type inside message')
			}

			return { v: '2', type: ListType[type].toLowerCase() }
		} else {
			return {}
		}
	}

	const getButtonContent = (message: waproto.IMessage, nativeFlowSpecial?: string): BinaryNode['content'] => {
		if (message.interactiveMessage?.nativeFlowMessage && nativeFlowSpecial) {
			switch (nativeFlowSpecial) {
			case 'review_and_pay':
			case 'payment_info':
				return []
			case 'galaxy_message':
				return [{
					tag: 'interactive',
					attrs: {
						type: 'native_flow',
						v: '1'
					},
					content: [{
						tag: 'native_flow',
						attrs: {
							v: '2',
							name: nativeFlowSpecial
						}
					}]
				},
				{
					tag: 'quality_control',
					attrs: {
						source_type: 'third_party'
					}
				}]
			default:
				return [{
					tag: 'interactive',
					attrs: {
						type: 'native_flow',
						v: '1'
					},
					content: [{
						tag: 'native_flow',
						attrs: {
							v: '2',
							name: nativeFlowSpecial || 'mixed'
						}
					}]
				},
				{
					tag: 'quality_control',
					attrs: {
						source_type: 'third_party'
					}
				}]
			}
		} else if (message.interactiveMessage?.nativeFlowMessage) {
			return [{
				tag: 'interactive',
				attrs: {
					type: 'native_flow',
					v: '1'
				},
				content: [{
					tag: 'native_flow',
					attrs: {
						v: '9',
						name: 'mixed'
					}
				}]
			}]
		} else {
			return []
		}
	}

	const getPrivacyTokens = async(jids: string[]) => {
		const t: string = unixTimestampSeconds().toString()
		const result: BinaryNode = await query({
			tag: 'iq',
			attrs: {
				to: S_WHATSAPP_NET,
				type: 'set',
				xmlns: 'privacy'
			},
			content: [
				{
					tag: 'tokens',
					attrs: { },
					content: jids.map(
						jid => ({
							tag: 'token',
							attrs: {
								jid: jidNormalizedUser(jid),
								t,
								type: 'trusted_contact'
							}
						})
					)
				}
			]
		})

		return result
	}

	const waUploadToServer = getWAUploadToServer(config, refreshMediaConn)

	const waitForMsgMediaUpdate = bindWaitForEvent(ev, 'messages.media-update')

	return {
		...sock,
		getPrivacyTokens,
		assertSessions,
		relayMessage,
		sendReceipt,
		sendReceipts,
		getButtonAttrs,
		getButtonContent,
		readMessages,
		refreshMediaConn,
		waUploadToServer,
		fetchPrivacySettings,
		sendPeerDataOperationMessage,
		createParticipantNodes,
		getUSyncDevices,
		updateMediaMessage: async(message: waproto.IWebMessageInfo) => {
			const content: waproto.Message.IDocumentMessage | waproto.Message.IImageMessage | waproto.Message.IVideoMessage | waproto.Message.IAudioMessage | waproto.Message.IStickerMessage = assertMediaContent(message.message)
			const mediaKey: Uint8Array = content.mediaKey!
			const meId: string = authState.creds.me!.id
			const node: BinaryNode = await encryptMediaRetryRequest(message.key, mediaKey, meId)

			let error: Error | undefined = undefined
			await Promise.all(
				[
					sendNode(node),
					waitForMsgMediaUpdate(async(update) => {
						const result = update.find(c => c.key.id === message.key.id)
						if (result) {
							if (result.error) {
								error = result.error
							} else {
								try {
									const media = await decryptMediaRetryData(result.media!, mediaKey, result.key.id!)
									if (media.result !== waproto.MediaRetryNotification.ResultType.SUCCESS) {
										const resultStr: string = waproto.MediaRetryNotification.ResultType[media.result!]
										throw new Boom(
											`Media re-upload failed by device (${resultStr})`,
											{ data: media, statusCode: getStatusCodeForMediaRetry(media.result!) || 404 }
										)
									}

									content.directPath = media.directPath
									content.url = getUrlFromDirectPath(content.directPath!)

									logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful')
								} catch (err) {
									error = err
								}
							}

							return true
						}
					})
				]
			)

			if (error) {
				throw error
			}

			ev.emit('messages.update', [
				{ key: message.key, update: { message: message.message } }
			])

			return message
		},
		sendMessage: async(
			jid: string,
			content: AnyMessageContent,
			options: MiscMessageGenerationOptions = {}
		) => {
			const userJid: string = authState.creds.me!.id
			if (
				typeof content === 'object' &&
				'disappearingMessagesInChat' in content &&
				typeof content['disappearingMessagesInChat'] !== 'undefined' &&
				isJidGroup(jid)
			) {
				const { disappearingMessagesInChat } = content
				const value: number = typeof disappearingMessagesInChat === 'boolean' ?
					(disappearingMessagesInChat ? WA_DEFAULT_EPHEMERAL : 0) :
					disappearingMessagesInChat
				await groupToggleEphemeral(jid, value)
			} else {
				const fullMsg = await generateWAMessage(
					jid,
					content,
					{
						logger,
						userJid,
						getUrlInfo: text => getUrlInfo(
							text,
							{
								thumbnailWidth: linkPreviewImageThumbnailWidth,
								fetchOpts: {
									timeout: 3_000,
									...axiosOptions || {}
								},
								logger,
								uploadImage: generateHighQualityLinkPreview
									? waUploadToServer
									: undefined
							},
						),
						getProfilePicUrl: (jid: string) => sock.profilePictureUrl(jid, 'preview', 30000),
						getCallLink: sock.createCallLink,
						upload: waUploadToServer,
						mediaCache: config.mediaCache,
						options: config.options,
						messageId: generateMessageIDV2(sock.user?.id),
						...options,
					}
				)
				const isEventMsg = 'event' in content && !!content.event
				const isDeleteMsg = 'delete' in content && !!content.delete
				const isEditMsg = 'edit' in content && !!content.edit
				const isPinMsg = 'pin' in content && !!content.pin
				const isPollMessage = 'poll' in content && !!content.poll
				const additionalAttributes: BinaryNodeAttributes = {}
				const additionalNodes: BinaryNode[] = []
				if (isDeleteMsg) {
					if (isJidGroup(content.delete.remoteJid as string) && !content.delete.fromMe) {
						additionalAttributes.edit = '8'
					} else {
						additionalAttributes.edit = '7'
					}
				} else if (isEditMsg) {
					additionalAttributes.edit = '1'
				} else if (isPinMsg) {
					additionalAttributes.edit = '2'
				} else if (isPollMessage) {
					additionalNodes.push({
						tag: 'meta',
						attrs: {
							polltype: 'creation'
						},
					} as BinaryNode)
				} else if (isEventMsg) {
					additionalNodes.push({
						tag: 'meta',
						attrs: {
							event_type: 'creation'
						}
					} as BinaryNode)
				}

				if ('cachedGroupMetadata' in options) {
					logger.warn({}, 'cachedGroupMetadata in sendMessage are deprecated, now cachedGroupMetadata is part of the socket config.')
				}

				if (
					getContentType(fullMsg.message!) === 'templateMessage' ||
					getContentType(fullMsg.message!) === 'interactiveMessage'
				) {
					logger.warn({ jid, message: fullMsg.message }, 'Sending native flow messages may require additional approval from WhatsApp to avoid message being marked as spam')
				}

				await relayMessage(jid, fullMsg.message!, { messageId: fullMsg.key.id!, useCachedGroupMetadata: options.useCachedGroupMetadata, additionalAttributes, statusJidList: options.statusJidList, additionalNodes })

				try {
					if (getContentType(fullMsg.message!) === 'listMessage') {
						await relayMessage(jid, { viewOnceMessageV2: { message: fullMsg.message! } }, { messageId: fullMsg.key.id!, useCachedGroupMetadata: options.useCachedGroupMetadata, additionalAttributes, statusJidList: options.statusJidList, additionalNodes })
					}
				} catch (err) {
					logger.error(err)
				}

				if (config.emitOwnEvents) {
					process.nextTick(() => {
						processingMutex.mutex(() => (
							upsertMessage(fullMsg, 'append')
						))
					})
				}

				// Handle album media sending
				if (typeof content === 'object' && 'album' in content && content.album) {
					const { medias, delay: delayMs = 500 } = content.album

					// Send each media with association to album
					for (let i = 0; i < medias.length; i++) {
						const media = medias[i]

						const mediaMsg = await generateWAMessage(jid, media as any, {
							logger,
							userJid,
							getUrlInfo: text => getUrlInfo(text, {
								thumbnailWidth: linkPreviewImageThumbnailWidth,
								fetchOpts: {
									timeout: 3_000,
									...(axiosOptions || {})
								},
								logger,
								uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
							}),
							getProfilePicUrl: sock.profilePictureUrl,
							getCallLink: sock.createCallLink,
							upload: waUploadToServer,
							mediaCache: config.mediaCache,
							options: config.options,
							messageId: generateMessageIDV2(sock.user?.id),
							...options
						})

						// Add message association to link this media to the album
						mediaMsg.message = {
							...mediaMsg.message,
							messageContextInfo: {
								messageAssociation: {
									associationType: waproto.MessageAssociation.AssociationType.MEDIA_ALBUM,
									parentMessageKey: fullMsg.key
								}
							}
						}

						await relayMessage(jid, mediaMsg.message, {
							messageId: mediaMsg.key.id!,
							useCachedGroupMetadata: options.useCachedGroupMetadata,
							statusJidList: options.statusJidList
						})

						if (config.emitOwnEvents) {
							process.nextTick(() => {
								processingMutex.mutex(() => upsertMessage(mediaMsg, 'append'))
							})
						}

						// Add delay between media sends (except for the last one)
						if (i < medias.length - 1) {
							await delay(delayMs)
						}
					}
				}

				return fullMsg
			}
		}
	}
}
