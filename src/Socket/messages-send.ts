import { waproto } from '../../WAProto'
import { WA_DEFAULT_EPHEMERAL } from '../Defaults'
import { AlbumMedia, AnyMessageContent, CacheStore, GroupMetadata, MediaConnInfo, MessageReceiptType, MessageRelayOptions, MiscMessageGenerationOptions, nativeFlowSpecials, SocketConfig, WAMessageKey } from '../Types'
import { aggregateMessageKeysNotFromMe, assertMediaContent, bindWaitForEvent, decryptMediaRetryData, delay, encodeSignedDeviceIdentity, encodeWAMessage, encryptMediaRetryRequest, extractDeviceJids, generateMessageIDV2, generateParticipantHashV2, generateWAMessage, getContentType, getStatusCodeForMediaRetry, getUrlFromDirectPath, getUserId, getUserLid, getWAUploadToServer, makeMessageRelayMutex, normalizeMessageContent, parseAndInjectE2ESessions, unixTimestampSeconds } from '../Utils'
import { getUrlInfo } from '../Utils/link-preview'
import { areJidsSameUser, assertJidDecode, BinaryNode, BinaryNodeAttributes, FullJid, getBinaryNodeChild, getBinaryNodeChildren, isHostedLidUser, isHostedPnUser, isJidGroup, isJidNewsletter, isJidUser, isLidUser, isPnUser, jidDecode, jidEncode, jidNormalizedUser, JidWithDevice, S_WHATSAPP_NET } from '../WABinary'
import { USyncQuery, USyncQueryResult, USyncQueryResultList, USyncUser } from '../WAUSync'
import { CacheManager } from './cache-manager'
import { Boom } from '@hapi/boom'
import ListType = waproto.Message.ListMessage.ListType;
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
		// Clone the message using protobuf methods instead of JSON
		let cloned = false

		if (msg?.deviceSentMessage?.message?.listMessage) {
			if (!cloned) {
				msg = waproto.Message.fromObject(waproto.Message.toObject(msg as any)) as waproto.IMessage
				cloned = true
			}

			if (msg.deviceSentMessage?.message?.listMessage) {
				msg.deviceSentMessage.message.listMessage.listType = waproto.Message.ListMessage.ListType.SINGLE_SELECT
			}
		}

		if (msg?.listMessage) {
			if (!cloned) {
				msg = waproto.Message.fromObject(waproto.Message.toObject(msg as any)) as waproto.IMessage
				cloned = true
			}

			if (msg.listMessage) {
				msg.listMessage.listType = waproto.Message.ListMessage.ListType.SINGLE_SELECT
			}
		}

		return msg
	}

	const messageRetryManager: MessageRetryManager | null = enableRecentMessageCache ? new MessageRetryManager(logger, maxMsgRetryCount) : null
	const baseEnd = sock.end
	let resourcesClosed = false
	const cleanupResources = () => {
		if (resourcesClosed) {
			return
		}

		resourcesClosed = true
		peerSessionsCache.close()
		localUserDevicesCache?.close()
		messageRetryManager?.shutdown()
	}

	const messageRelayMutex = makeMessageRelayMutex({
		maxConcurrent: messageRelayMaxConcurrent,
		maxQueueSize: messageRelayMaxQueueSize
	})

	const shouldCloseUserDevicesCache = !config.userDevicesCache

	const userDevicesCache: CacheStore = config.userDevicesCache || CacheManager.getInstance('USER_DEVICES')
	const peerSessionsCache: CacheStore = CacheManager.getInstance('PEER_SESSIONS')

	const localUserDevicesCache: CacheStore | undefined = shouldCloseUserDevicesCache ? (userDevicesCache) : undefined

	let mediaConn: Promise<MediaConnInfo>
	const refreshMediaConn = async (forceGet = false) => {
		const media: MediaConnInfo = await mediaConn
		if (!media || forceGet || (new Date().getTime() - media.fetchDate.getTime()) > media.ttl * 1000) {
			mediaConn = (async () => {
				const result: BinaryNode = await query({
					tag: 'iq',
					attrs: {
						type: 'set',
						xmlns: 'w:m',
						to: S_WHATSAPP_NET,
					},
					content: [{ tag: 'media_conn', attrs: {} }]
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
	const sendReceipt = async (jid: string, participant: string | undefined, messageIds: string[], type: MessageReceiptType) => {
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
					attrs: {},
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

	const sendReceipts = async (keys: WAMessageKey[], type: MessageReceiptType) => {
		const recps = aggregateMessageKeysNotFromMe(keys)
		for (const { jid, participant, messageIds } of recps) {
			await sendReceipt(jid, participant, messageIds, type)
		}
	}

	const readMessages = async (keys: WAMessageKey[]) => {
		const privacySettings = await fetchPrivacySettings()
		const readType: MessageReceiptType = privacySettings?.readreceipts === 'all' ? 'read' : 'read-self'
		await sendReceipts(keys, readType)
	}

	const getUSyncDevices = async (jids: string[], useCache: boolean, ignoreZeroDevices: boolean) => {
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

		const requestedLidUsers = new Set<string>()
		for (const jid of toFetch) {
			if (isLidUser(jid) || isHostedLidUser(jid)) {
				const user: string | undefined = jidDecode(jid)?.user
				if (user) {
					requestedLidUsers.add(user)
				}
			}
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
					await signalRepository.lidMapping.storeLIDPNMappings(lidResults.map(a => ({ lidUser: a.lid as string, pnUser: a.id })))

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

				const extracted: FullJid[] = extractDeviceJids(result?.list, getUserId(authState.creds), ignoreZeroDevices)

				const deviceMap: { [_: string]: FullJid[] } = {}

				for (const item of extracted) {
					deviceMap[item.user] = deviceMap[item.user] || []
					deviceMap[item.user].push(item)

					// deviceResults.push(item)
				}

				// Process each user's devices as a group for bulk LID migration
				for (const [user, userDevices] of Object.entries(deviceMap)) {
					const isLidUser = requestedLidUsers.has(user)

					// Process all devices for this user
					for (const item of userDevices) {
						const finalJid: string = isLidUser
							? jidEncode(user, item.server, item.device)
							: jidEncode(item.user, item.server, item.device)

						deviceResults.push({
							...item,
							jid: finalJid
						})

						logger.debug(
							{
								user: item.user,
								device: item.device,
								finalJid,
								usedLid: isLidUser
							},
							'Processed device with LID priority'
						)
					}
				}

				for (const key in deviceMap) {
					userDevicesCache.set(key, deviceMap[key])
					logger.debug({ user: key, deviceCount: deviceMap[key].length }, 'cached devices for user')
				}

				const userDeviceUpdates: { [userId: string]: string[] } = {}
				for (const [userId, devices] of Object.entries(deviceMap)) {
					if (devices && devices.length > 0) {
						userDeviceUpdates[userId] = devices.map(d => d.device?.toString() || '0')
					}
				}

				if (Object.keys(userDeviceUpdates).length > 0) {
					try {
						await authState.keys.set({ 'device-list': userDeviceUpdates })
						logger.debug(
							{ userCount: Object.keys(userDeviceUpdates).length },
							'stored user device lists for bulk migration'
						)
					} catch (error) {
						logger.warn({ error }, 'failed to store user device lists')
					}
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

	const assertSessions = async (jids: string[], force: boolean) => {
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
				// Check both session storage and peer cache to avoid redundant fetches
				const hasCachedSession: boolean = peerSessionsCache.get<boolean>(signalId) === true
				if (!sessions[signalId] && !hasCachedSession) {
					jidsRequiringFetch.push(jid)
				}
			}
		}

		if (jidsRequiringFetch.length) {
			const lidMappings = await signalRepository.lidMapping.getLIDsForPNs(
				jidsRequiringFetch.filter(jid => !!isPnUser(jid) || !!isHostedPnUser(jid))
			) || []

			const wireJids: string[] = [
				...jidsRequiringFetch.filter(jid => !!isLidUser(jid) || !!isHostedLidUser(jid)),
				...lidMappings.map(a => a.lidUser)
			]

			// If no LID mappings found, use the original PN JIDs
			const pnJidsWithoutLid = jidsRequiringFetch.filter(jid => {
				if (!isPnUser(jid) && !isHostedPnUser(jid)) {
					return false
				}

				const hasLidMapping = lidMappings.some(m => areJidsSameUser(m.pnUser, jid))
				return !hasLidMapping
			})

			if (pnJidsWithoutLid.length > 0) {
				logger.debug({ pnJidsWithoutLid }, 'No LID mapping found for some PNs, using PN JIDs directly')
				wireJids.push(...pnJidsWithoutLid)
			}

			logger.debug({ jidsRequiringFetch, wireJids }, 'fetching sessions')			// Check if we already have cached sessions for these wire JIDs
			const wireJidsToFetch: string[] = []
			for (const wireJid of wireJids) {
				const signalId: string = signalRepository.jidToSignalProtocolAddress(wireJid)
				const hasCached: boolean = peerSessionsCache.get<boolean>(signalId) === true
				if (!hasCached) {
					wireJidsToFetch.push(wireJid)
				} else {
					logger.debug({ wireJid }, 'skipping fetch, session already cached')
				}
			}

			if (wireJidsToFetch.length === 0) {
				logger.debug({}, 'all sessions already cached, skipping fetch')
				return didFetchNewSession
			}

			// Retry logic with exponential backoff for session fetching
			let retries = 3
			let result: BinaryNode | null = null
			let lastError: Error | null = null

			while (retries > 0 && !result) {
				try {
					result = await query({
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
								content: wireJidsToFetch.map(jid => {
									const attrs: { [key: string]: string } = { jid }
									if (force) {
										attrs.reason = 'identity'
									}

									return { tag: 'user', attrs }
								})
							}
						]
					}, 150_000) // 150 seconds timeout
					break
				} catch (error) {
					lastError = error as Error
					retries--
					if (retries > 0) {
						const backoffDelay = (4 - retries) * 5000 // 5s, 10s, 15s
						logger.warn(
							{ error: error.message, retriesLeft: retries, backoffDelay },
							'Failed to fetch sessions, retrying...'
						)
						await delay(backoffDelay)
					}
				}
			}

			if (!result) {
				logger.error({ error: lastError?.message, jidsRequiringFetch }, 'Failed to fetch sessions after all retries')
				throw lastError || new Boom('Failed to fetch sessions', { statusCode: 408 })
			}

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

	const sendPeerDataOperationMessage = async (
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

	const createParticipantNodes = async (
		jids: string[],
		message: waproto.IMessage,
		extraAttrs?: BinaryNode['attrs']
	) => {
		const patched: waproto.IMessage = await patchMessageBeforeSending(message, jids)
		const requiredPatched: waproto.IMessage = patchMessageRequiresBeforeSending(patched)
		const bytes: Buffer = encodeWAMessage(requiredPatched)

		let shouldIncludeDeviceIdentity = false
		const nodes: BinaryNode[] = []
		const failedJids: string[] = []

		for (const jid of jids) {
			try {
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
				nodes.push(node)
			} catch (error) {
				failedJids.push(jid)
				logger.warn(
					{ jid, error: error.message },
					'Failed to encrypt message for participant, skipping'
				)
			}
		}

		if (failedJids.length > 0) {
			logger.warn(
				{
					failedCount: failedJids.length,
					totalCount: jids.length,
					failedJids: failedJids.slice(0, 5) // Log first 5 to avoid huge logs
				},
				'Some participants failed encryption'
			)
		}

		return { nodes, shouldIncludeDeviceIdentity }
	}

	const relayMessage = async (
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
		return messageRelayMutex.mutex(async () => {
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

	const relayMessageInternal = async (
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
		const meId: string = getUserId(authState.creds)
		const meLid: string | undefined = getUserLid(authState.creds)
		const isRetryResend = Boolean(participant?.jid)
		let shouldIncludeDeviceIdentity: boolean = isRetryResend

		const { user, server } = assertJidDecode(jid, 'Destination JID')
		const statusJid = 'status@broadcast'
		const isGroup: boolean = server === 'g.us'
		const isStatus: boolean = jid === statusJid

		let isLid: boolean = server === 'lid'
		let effectiveJid: string = jid

		// Auto-detect and use LID from mapping: ensure LID session exists and use it
		if (!isGroup && !isStatus && !isLid && (isPnUser(jid) || isHostedPnUser(jid))) {
			try {
				// First, try to get LID mapping from store
				const lidMappings = await signalRepository.lidMapping.getLIDsForPNs([jid])
				if (lidMappings && lidMappings.length > 0 && lidMappings[0].lidUser) {
					const potentialLid = lidMappings[0].lidUser

					// Check if we have an active LID session
					const lidSignalId = `${potentialLid.split('@')[0]}.0:0`
					let lidSession = await authState.keys.get('session', [lidSignalId])

					if (!lidSession?.[lidSignalId]) {
						// No LID session exists, try to create it via assertSessions
						logger.debug(
							{ originalJid: jid, potentialLid },
							'LID mapping found but no session, fetching LID session'
						)

						try {
							await assertSessions([potentialLid], false)
							// Re-check if session was created
							lidSession = await authState.keys.get('session', [lidSignalId])
						} catch (sessionError) {
							logger.warn(
								{ error: sessionError.message, potentialLid },
								'Failed to create LID session, will keep PN'
							)
						}
					}

					if (lidSession?.[lidSignalId]) {
						// We have a valid LID session now, use it
						isLid = true
						effectiveJid = potentialLid
						logger.debug(
							{ originalJid: jid, lidJid: effectiveJid },
							'Using LID addressing based on session'
						)
					} else {
						logger.debug(
							{ originalJid: jid, potentialLid },
							'Could not establish LID session, keeping PN'
						)
					}
				}
			} catch (error) {
				logger.debug({ error: error.message, jid }, 'Failed to check LID mapping, using original JID')
			}
		}

		// const isNewsletter: boolean = server === 'newsletter'
		const isGroupOrStatus: boolean = isGroup || isStatus
		// const finalJid: string = jid

		msgId = msgId || generateMessageIDV2(sock.user?.id)
		useUserDevicesCache = useUserDevicesCache !== false
		useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus

		// Use the effective user from the LID or original JID
		const effectiveUser = jidDecode(effectiveJid)?.user || user

		const participants: BinaryNode[] = []
		const destinationJid: string = (!isStatus) ? jidEncode(effectiveUser, isLid ? 'lid' : isGroup ? 'g.us' : 's.whatsapp.net') : statusJid
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

			const decoded = jidDecode(participant.jid)!
			const { user, device } = decoded

			// Check if we have a valid session for this specific device
			if (device !== undefined) {
				const signalId = signalRepository.jidToSignalProtocolAddress(participant.jid)
				const sessions = await authState.keys.get('session', [signalId])

				if (sessions[signalId]) {
					// We have a valid session, use this specific device
					devices.push({
						user,
						device,
						jid: participant.jid
					})

					logger.debug(
						{ participantJid: participant.jid, user, device },
						'Using specific device for retry (session exists)'
					)
				} else {
					// No session for this device, will fetch all devices via getUSyncDevices later
					logger.debug(
						{ participantJid: participant.jid, user, device },
						'No session for specific device, will fetch all devices'
					)
				}
			} else {
				// No device specified, will fetch all devices via getUSyncDevices later
				logger.debug(
					{ participantJid: participant.jid, user },
					'No device specified in retry, will fetch all devices'
				)
			}
		}

		if (isInteractiveMessage) {
			additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' }
		}

		await authState.keys.transaction(
			async () => {
				const mediaType = getMediaType(message)
				if (mediaType) {
					extraAttrs['mediatype'] = mediaType
				}

				if (normalizeMessageContent(message)?.pinInChatMessage) {
					extraAttrs['decrypt-fail'] = 'hide' // TODO: expand for reactions and other types
				}

				if (isGroupOrStatus && !isRetryResend) {
					const [groupData, senderKeyMap] = await Promise.all([
						(async () => {
							let groupData: GroupMetadata | undefined = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined

							/**
							 * Validate cached metadata has critical fields needed for message relay.
							 * Critical fields: participants (required), addressingMode (required for LID/PN routing)
							 * If cache is missing critical fields, fetch fresh data from server.
							 */
							const hasCriticalFields = groupData
								&& Array.isArray(groupData.participants)
								&& groupData.participants.length > 0
								&& typeof groupData.addressingMode === 'string'

							if (hasCriticalFields) {
								logger.trace({
									jid,
									participants: groupData!.participants.length,
									addressingMode: groupData!.addressingMode
								}, 'using cached group metadata with all critical fields')
							} else if (!isStatus) {
								if (groupData && !hasCriticalFields) {
									logger.debug({
										jid,
										hasParticipants: Array.isArray(groupData?.participants),
										hasAddressingMode: !!groupData?.addressingMode
									}, 'cached metadata missing critical fields, fetching from server')
								}

								try {
									groupData = await groupMetadataWithRetry(jid, 3, 300_000)
								} catch (error) {
									logger.warn({ jid, error }, 'failed to get group metadata with retry, falling back to regular call')
									groupData = await groupMetadata(jid)
								}
							}

							return groupData
						})(),
						(async () => {
							if (!participant && !isStatus) {
								/**
								 * Sender key memory tracks which devices have received the sender key for this group.
								 * With LID addressing, we need to ensure the memory uses the correct addressing mode.
								 *
								 * Problem: If a group migrated from PN to LID addressing (or vice versa), the cached
								 * sender-key-memory will have entries in the old format (e.g., user@s.whatsapp.net)
								 * while we now need entries in the new format (e.g., user@lid).
								 *
								 * Solution: For groups with LID addressing, validate that cached entries use @lid domain.
								 * If they don't match the expected addressing mode, treat cache as empty to force resend.
								 */
								const cachedResult = await authState.keys.get('sender-key-memory', [jid])
								const cachedMap = cachedResult[jid] || {}

								if (!groupData) {
									return cachedMap
								}

								const expectedAddressingMode: 'pn' | 'lid' = groupData.addressingMode || 'lid'
								const expectedDomain: '@lid' | '@s.whatsapp.net' = expectedAddressingMode === 'lid' ? '@lid' : '@s.whatsapp.net'

								const cachedKeys: string[] = Object.keys(cachedMap)
								if (cachedKeys.length === 0) {
									return cachedMap
								}

								const allEntriesMatchAddressingMode: boolean = cachedKeys.every(key => key.includes(expectedDomain))

								if (allEntriesMatchAddressingMode) {
									logger.trace({
										jid,
										addressingMode: expectedAddressingMode,
										cachedCount: cachedKeys.length
									}, 'sender-key-memory matches group addressing mode')
									return cachedMap
								}

								logger.debug({
									jid,
									expectedMode: expectedAddressingMode,
									cachedSample: cachedKeys.slice(0, 3),
									cachedCount: cachedKeys.length
								}, 'sender-key-memory addressing mode mismatch, will resend sender keys')

								return {}
							}

							return {}
						})()
					])

					const participantsList: string[] = groupData ? groupData.participants.map(p => p.id) : []
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
							user: effectiveUser,
							device: 0,
							jid: jidEncode(effectiveUser, targetUserServer, 0)
						})

						if (effectiveUser !== ownUser) {
							const ownUserServer: 'lid' | 's.whatsapp.net' = isLid ? 'lid' : 's.whatsapp.net'
							const ownUserForAddressing: string = isLid && meLid ? jidDecode(meLid)!.user : jidDecode(meId)!.user

							devices.push({
								user: ownUserForAddressing,
								device: 0,
								jid: jidEncode(ownUserForAddressing, ownUserServer, 0)
							})
						}

						if (additionalAttributes?.['category'] !== 'peer') {
							const initialDevices = [...devices]
							devices.length = 0

							const senderIdentity: string =
								isLid && meLid
									? jidEncode(jidDecode(meLid)?.user!, 'lid', undefined)
									: jidEncode(jidDecode(meId)?.user!, 's.whatsapp.net', undefined)

							const sessionDevices: JidWithDevice[] = await getUSyncDevices([senderIdentity, effectiveJid], true, false)

							// Filter devices to match the destination server type (lid or s.whatsapp.net)
							const targetServer = isLid ? 'lid' : 's.whatsapp.net'
							const filteredDevices = sessionDevices.filter(d => {
								const decoded = jidDecode(d.jid)
								return decoded?.server === targetServer
							})

							devices.push(...filteredDevices)

							if (devices.length === 0) {
								logger.warn({ jid, targetServer }, 'No devices found via USync for target server type, using initial device list as fallback')
								devices.push(...initialDevices)
							}

							logger.debug(
								{
									deviceCount: devices.length,
									targetServer,
									devices: devices.map(d => `${d.user}:${d.device}@${jidDecode(d.jid)?.server}`)
								},
								'Device enumeration complete with unified addressing'
							)
						}
					} else if (devices.length === 0) {
						// Retry without devices - fetch all devices for the target
						logger.debug({ jid, effectiveJid }, 'Retry without devices, fetching all devices')

						const senderIdentity: string =
							isLid && meLid
								? jidEncode(jidDecode(meLid)?.user!, 'lid', undefined)
								: jidEncode(jidDecode(meId)?.user!, 's.whatsapp.net', undefined)

						const sessionDevices: JidWithDevice[] = await getUSyncDevices([senderIdentity, effectiveJid], false, false)

						// Filter devices to match the destination server type (lid or s.whatsapp.net)
						const targetServer = isLid ? 'lid' : 's.whatsapp.net'
						const filteredDevices = sessionDevices.filter(d => {
							const decoded = jidDecode(d.jid)
							return decoded?.server === targetServer
						})

						devices.push(...filteredDevices)

						if (devices.length === 0) {
							// Fallback to device 0
							const targetUserServer: 'lid' | 's.whatsapp.net' = isLid ? 'lid' : 's.whatsapp.net'
							devices.push({
								user,
								device: 0,
								jid: jidEncode(user, targetUserServer, 0)
							})

							logger.warn({ jid, targetServer }, 'No devices found for retry, using device 0 as fallback')
						}

						logger.debug(
							{
								deviceCount: devices.length,
								targetServer,
								devices: devices.map(d => `${d.user}:${d.device}@${jidDecode(d.jid)?.server}`)
							},
							'Device enumeration complete for retry'
						)
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

					// Validate that we have a valid session before attempting encryption
					const signalId = signalRepository.jidToSignalProtocolAddress(participant!.jid)
					const sessions = await authState.keys.get('session', [signalId])

					if (!sessions[signalId]) {
						logger.error(
							{
								participantJid: participant!.jid,
								signalId
							},
							'No valid session for retry participant, skipping retry encryption'
						)
						// Don't throw error, just skip this retry attempt
						// The message will remain in PENDING state and may retry again later
					} else {
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
							attrs: {},
							content: participants
						})
					}
				} else {
					logger.warn({ jid, msgId, isGroup, isStatus }, 'no participants to send message, message may not be delivered')
				}

				// Validate that we have content to send
				if (binaryNodeContent.length === 0) {
					logger.error(
						{ jid, msgId, isRetryResend, hasParticipant: !!participant },
						'No encrypted content to send, aborting message send'
					)
					throw new Boom('No encrypted content available for message', { statusCode: 500 })
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
						attrs: {},
						content: encodeSignedDeviceIdentity(authState.creds.account!, true)
					})

					logger.debug({ jid }, 'adding device identity')
				}

				const contactTcToken =
					!isGroup && !isRetryResend && !isStatus
						? await authState.keys.get('tc-token', [destinationJid])
						: {}

				const tcTokenBuffer: Buffer = contactTcToken[destinationJid]?.token

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

	const getPrivacyTokens = async (jids: string[]) => {
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
					attrs: {},
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

	const end: typeof sock.end = error => {
		cleanupResources()
		baseEnd(error)
	}

	return {
		...sock,
		end,
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
		updateMediaMessage: async (message: waproto.IWebMessageInfo) => {
			const mediaContent: any = assertMediaContent(message.message)
			if (!mediaContent.mediaKey || mediaContent.mediaKey.length === 0) {
				throw new Error('Message does not have a valid mediaKey')
			}

			const mediaKey: Uint8Array = mediaContent.mediaKey
			const meId: string = getUserId(authState.creds)
			const node: BinaryNode = await encryptMediaRetryRequest(message.key, mediaKey, meId)

			let error: Error | undefined = undefined
			await Promise.all(
				[
					sendNode(node),
					waitForMsgMediaUpdate(async (update) => {
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

									mediaContent.directPath = media.directPath
									if (mediaContent.directPath) {
										mediaContent.url = getUrlFromDirectPath(mediaContent.directPath)
									}

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
		sendMessage: async (
			jid: string,
			content: AnyMessageContent,
			options: MiscMessageGenerationOptions = {}
		) => {
			const userJid: string = getUserId(authState.creds)
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
							polltype: 'creation',
							contenttype: isJidNewsletter(jid) ? 'text' : undefined,
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

				await relayMessage(jid, fullMsg.message!, {
					messageId: fullMsg.key.id!,
					useCachedGroupMetadata: options.useCachedGroupMetadata,
					additionalAttributes,
					statusJidList: options.statusJidList,
					additionalNodes
				})

				try {
					if (getContentType(fullMsg.message!) === 'listMessage') {
						await relayMessage(jid, { viewOnceMessageV2: { message: fullMsg.message! } }, {
							messageId: fullMsg.key.id!,
							useCachedGroupMetadata: options.useCachedGroupMetadata,
							additionalAttributes,
							statusJidList: options.statusJidList,
							additionalNodes
						})
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
						const media: AlbumMedia = medias[i]

						const mediaMsg = await generateWAMessage(jid, media, {
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
