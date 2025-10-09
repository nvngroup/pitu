import { Boom } from '@hapi/boom'
import { waproto } from '../../WAProto'
import { PROCESSABLE_HISTORY_TYPES } from '../Defaults'
import { ALL_WA_PATCH_NAMES, CacheStore, ChatModification, ChatMutation, Contact, ContactAction, LTHashState, MessageUpsertType, PresenceData, SocketConfig, WABusinessHoursConfig, WABusinessProfile, WAMediaUpload, WAMessage, WAPatchCreate, WAPatchName, WAPresence, WAPrivacyCallValue, WAPrivacyGroupAddValue, WAPrivacyMessagesValue, WAPrivacyOnlineValue, WAPrivacyValue, WAReadReceiptsValue } from '../Types'
import type { LabelActionBody } from '../Types/Label'
import { SyncState } from '../Types/State'
import { chatModificationToAppPatch, ChatMutationMap, decodePatches, decodeSyncdSnapshot, encodeSyncdPatch, extractSyncdPatches, generateProfilePicture, getHistoryMsg, newLTHashState, processSyncAction } from '../Utils'
import { makeMutex } from '../Utils/make-mutex'
import processMessage from '../Utils/process-message'
import { BinaryNode, getBinaryNodeChild, getBinaryNodeChildren, jidDecode, jidNormalizedUser, reduceBinaryNodeToDictionary, S_WHATSAPP_NET } from '../WABinary'
import { USyncQuery, USyncQueryResult, USyncUser } from '../WAUSync'
import { CacheManager } from './cache-manager'
import { makeUSyncSocket } from './usync'

const MAX_SYNC_ATTEMPTS = 2

export const makeChatsSocket = (config: SocketConfig) => {
	const {
		logger,
		markOnlineOnConnect,
		fireInitQueries,
		appStateMacVerification,
		shouldIgnoreJid,
		shouldSyncHistoryMessage,
	} = config
	const sock = makeUSyncSocket(config)
	const {
		ev,
		ws,
		authState,
		generateMessageTag,
		sendNode,
		query,
		onUnexpectedError,
	} = sock

	let privacySettings: { [_: string]: string } | undefined
	let syncState: SyncState = SyncState.Connecting
	const processingMutex = makeMutex()

	let awaitingSyncTimeout: NodeJS.Timeout | undefined

	const placeholderResendCache: CacheStore = config.placeholderResendCache || CacheManager.getInstance('MSG_RETRY')

	if(!config.placeholderResendCache) {
		config.placeholderResendCache = placeholderResendCache
	}

	const onWhatsAppCache: CacheStore = config.onWhatsAppCache || CacheManager.getInstance('ON_WHATSAPP')

	if(!config.onWhatsAppCache) {
		config.onWhatsAppCache = onWhatsAppCache
	}

	const getAppStateSyncKey = async(keyId: string) => {
		const { [keyId]: key } = await authState.keys.get('app-state-sync-key', [keyId])
		return key
	}

	const fetchPrivacySettings = async(force = false) => {
		if(!privacySettings || force) {
			const { content } = await query({
				tag: 'iq',
				attrs: {
					xmlns: 'privacy',
					to: S_WHATSAPP_NET,
					type: 'get'
				},
				content: [
					{ tag: 'privacy', attrs: {} }
				]
			})
			privacySettings = reduceBinaryNodeToDictionary(content?.[0] as BinaryNode, 'category')
		}

		return privacySettings
	}

	const privacyQuery = async(name: string, value: string) => {
		await query({
			tag: 'iq',
			attrs: {
				xmlns: 'privacy',
				to: S_WHATSAPP_NET,
				type: 'set'
			},
			content: [{
				tag: 'privacy',
				attrs: {},
				content: [
					{
						tag: 'category',
						attrs: { name, value }
					}
				]
			}]
		})
	}

	const updateMessagesPrivacy = async(value: WAPrivacyMessagesValue) => {
		await privacyQuery('messages', value)
	}

	const updateCallPrivacy = async(value: WAPrivacyCallValue) => {
		await privacyQuery('calladd', value)
	}

	const updateLastSeenPrivacy = async(value: WAPrivacyValue) => {
		await privacyQuery('last', value)
	}

	const updateOnlinePrivacy = async(value: WAPrivacyOnlineValue) => {
		await privacyQuery('online', value)
	}

	const updateProfilePicturePrivacy = async(value: WAPrivacyValue) => {
		await privacyQuery('profile', value)
	}

	const updateStatusPrivacy = async(value: WAPrivacyValue) => {
		await privacyQuery('status', value)
	}

	const updateReadReceiptsPrivacy = async(value: WAReadReceiptsValue) => {
		await privacyQuery('readreceipts', value)
	}

	const updateGroupsAddPrivacy = async(value: WAPrivacyGroupAddValue) => {
		await privacyQuery('groupadd', value)
	}

	const updateDefaultDisappearingMode = async(duration: number) => {
		await query({
			tag: 'iq',
			attrs: {
				xmlns: 'disappearing_mode',
				to: S_WHATSAPP_NET,
				type: 'set'
			},
			content: [{
				tag: 'disappearing_mode',
				attrs: {
					duration: duration.toString()
				}
			}]
		})
	}

	const onWhatsApp = async(...jids: string[]) => {
		const cacheKey: string = jids.sort().join(',')
		const cached = onWhatsAppCache.get(cacheKey)
		if(cached) {
			return cached
		}

		const usyncQuery = new USyncQuery()
			.withContactProtocol()
			.withLIDProtocol()

		for(const jid of jids) {
			const phone = `+${jid.replace('+', '').split('@')[0].split(':')[0]}`
			usyncQuery.withUser(new USyncUser().withPhone(phone))
		}

		const results = await sock.executeUSyncQuery(usyncQuery)

		if(results) {
			const filtered = results.list
				.filter(a => !!a.contact)
				.map(({ contact, id, lid }) => ({ jid: id, exists: contact, lid }))
			onWhatsAppCache.set(cacheKey, filtered)
			return filtered
		}
	}

	const fetchStatus = async(...jids: string[]) => {
		const usyncQuery = new USyncQuery()
			.withStatusProtocol()

		for(const jid of jids) {
			usyncQuery.withUser(new USyncUser().withId(jid))
		}

		const result: USyncQueryResult | undefined = await sock.executeUSyncQuery(usyncQuery)
		if(result) {
			return result.list
		}
	}

	const fetchDisappearingDuration = async(...jids: string[]) => {
		const usyncQuery = new USyncQuery()
			.withDisappearingModeProtocol()

		for(const jid of jids) {
			usyncQuery.withUser(new USyncUser().withId(jid))
		}

		const result: USyncQueryResult | undefined = await sock.executeUSyncQuery(usyncQuery)
		if(result) {
			return result.list
		}
	}

	const updateProfilePicture = async(jid: string, content: WAMediaUpload, dimensions?: { w: number; h: number }) => {
		let targetJid
		if(!jid) {
			throw new Boom('Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update')
		}

		if(jidNormalizedUser(jid) !== jidNormalizedUser(authState.creds.me!.id)) {
			targetJid = jidNormalizedUser(jid)
		}

		const { img } = await generateProfilePicture(content, dimensions)
		await query({
			tag: 'iq',
			attrs: {
				target: targetJid,
				to: S_WHATSAPP_NET,
				type: 'set',
				xmlns: 'w:profile:picture'
			},
			content: [
				{
					tag: 'picture',
					attrs: { type: 'image' },
					content: img
				}
			]
		})
	}

	const removeProfilePicture = async(jid: string) => {
		let targetJid
		if(!jid) {
			throw new Boom('Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update')
		}

		if(jidNormalizedUser(jid) !== jidNormalizedUser(authState.creds.me!.id)) {
			targetJid = jidNormalizedUser(jid)
		}

		await query({
			tag: 'iq',
			attrs: {
				target: targetJid,
				to: S_WHATSAPP_NET,
				type: 'set',
				xmlns: 'w:profile:picture'
			}
		})
	}

	const updateProfileStatus = async(status: string) => {
		await query({
			tag: 'iq',
			attrs: {
				to: S_WHATSAPP_NET,
				type: 'set',
				xmlns: 'status'
			},
			content: [
				{
					tag: 'status',
					attrs: {},
					content: Buffer.from(status, 'utf-8')
				}
			]
		})
	}

	const updateProfileName = async(name: string) => {
		await chatModify({ pushNameSetting: name }, '')
	}

	const fetchBlocklist = async() => {
		const result: BinaryNode = await query({
			tag: 'iq',
			attrs: {
				xmlns: 'blocklist',
				to: S_WHATSAPP_NET,
				type: 'get'
			}
		})

		const listNode: BinaryNode | undefined = getBinaryNodeChild(result, 'list')
		return getBinaryNodeChildren(listNode, 'item')
			.map(n => n.attrs.jid)
	}

	const updateBlockStatus = async(jid: string, action: 'block' | 'unblock') => {
		await query({
			tag: 'iq',
			attrs: {
				xmlns: 'blocklist',
				to: S_WHATSAPP_NET,
				type: 'set'
			},
			content: [
				{
					tag: 'item',
					attrs: {
						action,
						jid
					}
				}
			]
		})
	}

	const getBusinessProfile = async(jid: string): Promise<WABusinessProfile | void> => {
		const results: BinaryNode = await query({
			tag: 'iq',
			attrs: {
				to: 's.whatsapp.net',
				xmlns: 'w:biz',
				type: 'get'
			},
			content: [{
				tag: 'business_profile',
				attrs: { v: '244' },
				content: [{
					tag: 'profile',
					attrs: { jid }
				}]
			}]
		})

		const profileNode: BinaryNode | undefined = getBinaryNodeChild(results, 'business_profile')
		const profiles: BinaryNode | undefined = getBinaryNodeChild(profileNode, 'profile')
		if(profiles) {
			const address: BinaryNode | undefined = getBinaryNodeChild(profiles, 'address')
			const description: BinaryNode | undefined = getBinaryNodeChild(profiles, 'description')
			const website: BinaryNode | undefined = getBinaryNodeChild(profiles, 'website')
			const email: BinaryNode | undefined = getBinaryNodeChild(profiles, 'email')
			const category: BinaryNode | undefined = getBinaryNodeChild(getBinaryNodeChild(profiles, 'categories'), 'category')
			const businessHours: BinaryNode | undefined = getBinaryNodeChild(profiles, 'business_hours')
			const businessHoursConfig: BinaryNode[] | undefined = businessHours
				? getBinaryNodeChildren(businessHours, 'business_hours_config')
				: undefined
			const websiteStr: string | undefined = website?.content?.toString()
			return {
				wid: profiles.attrs?.jid,
				address: address?.content?.toString(),
				description: description?.content?.toString() || '',
				website: websiteStr ? [websiteStr] : [],
				email: email?.content?.toString(),
				category: category?.content?.toString(),
				'business_hours': {
					timezone: businessHours?.attrs?.timezone,
					'business_config': businessHoursConfig?.map(({ attrs }) => attrs as unknown as WABusinessHoursConfig)
				}
			}
		}
	}

	const cleanDirtyBits = async(type: 'account_sync' | 'groups', fromTimestamp?: number | string) => {
		logger.trace({ fromTimestamp }, 'clean dirty bits ' + type)
		await sendNode({
			tag: 'iq',
			attrs: {
				to: S_WHATSAPP_NET,
				type: 'set',
				xmlns: 'urn:xmpp:whatsapp:dirty',
				id: generateMessageTag(),
			},
			content: [
				{
					tag: 'clean',
					attrs: {
						type,
						...(fromTimestamp ? { timestamp: fromTimestamp.toString() } : null),
					}
				}
			]
		})
	}

	const newAppStateChunkHandler = (isInitialSync: boolean) => {
		return {
			onMutation(mutation: ChatMutation) {
				processSyncAction(
					mutation,
					ev,
					authState.creds.me!,
					isInitialSync ? { accountSettings: authState.creds.accountSettings } : undefined,
					logger
				)
			}
		}
	}

	const resyncAppState = ev.createBufferedFunction(async(collections: readonly WAPatchName[], isInitialSync: boolean) => {
		const initialVersionMap: { [T in WAPatchName]?: number } = {}
		const globalMutationMap: ChatMutationMap = {}

		await authState.keys.transaction(
			async() => {
				const collectionsToHandle = new Set<string>(collections)
				const attemptsMap: { [T in WAPatchName]?: number } = {}
				while(collectionsToHandle.size) {
					const states = {} as { [T in WAPatchName]: LTHashState }
					const nodes: BinaryNode[] = []

					for(const name of collectionsToHandle) {
						const result = await authState.keys.get('app-state-sync-version', [name])
						let state: LTHashState = result[name]

						if(state) {
							if(typeof initialVersionMap[name] === 'undefined') {
								initialVersionMap[name] = state.version
							}
						} else {
							state = newLTHashState()
						}

						states[name] = state

						logger.trace(state, `resyncing ${name} from v${state.version}`)

						nodes.push({
							tag: 'collection',
							attrs: {
								name,
								version: state.version.toString(),
								'return_snapshot': (!state.version).toString()
							}
						})
					}

					const result: BinaryNode = await query({
						tag: 'iq',
						attrs: {
							to: S_WHATSAPP_NET,
							xmlns: 'w:sync:app:state',
							type: 'set'
						},
						content: [
							{
								tag: 'sync',
								attrs: {},
								content: nodes
							}
						]
					})

					const decoded = await extractSyncdPatches(result, config?.options)
					for(const key in decoded) {
						const name = key as WAPatchName
						const { patches, hasMorePatches, snapshot } = decoded[name]
						try {
							if(snapshot) {
								const { state: newState, mutationMap } = await decodeSyncdSnapshot(
									name,
									snapshot,
									getAppStateSyncKey,
									initialVersionMap[name],
									appStateMacVerification.snapshot
								)
								states[name] = newState
								Object.assign(globalMutationMap, mutationMap)

								logger.trace(newState, `restored state of ${name} from snapshot to v${newState.version} with mutations`)

								await authState.keys.set({ 'app-state-sync-version': { [name]: newState } })
							}

							if(patches.length) {
								const { state: newState, mutationMap } = await decodePatches(
									name,
									patches,
									states[name],
									getAppStateSyncKey,
									config.options,
									initialVersionMap[name],
									logger,
									appStateMacVerification.patch
								)

								await authState.keys.set({ 'app-state-sync-version': { [name]: newState } })

								logger.trace(newState, `synced ${name} to v${newState.version}`)
								initialVersionMap[name] = newState.version

								Object.assign(globalMutationMap, mutationMap)
							}

							if(hasMorePatches) {
								logger.trace({ name }, `${name} has more patches...`)
							} else {
								collectionsToHandle.delete(name)
							}
						} catch(error) {
							const isIrrecoverableError: boolean = attemptsMap[name]! >= MAX_SYNC_ATTEMPTS
								|| error.output?.statusCode === 404
								|| error.name === 'TypeError'
							logger.error(
								{ name, error: error.stack },
								`failed to sync state from version${isIrrecoverableError ? '' : ', removing and trying from scratch'}`
							)
							await authState.keys.set({ 'app-state-sync-version': { [name]: null } })
							attemptsMap[name] = (attemptsMap[name] || 0) + 1

							if(isIrrecoverableError) {
								collectionsToHandle.delete(name)
							}
						}
					}
				}
			}
		)

		const { onMutation } = newAppStateChunkHandler(isInitialSync)
		for(const key in globalMutationMap) {
			onMutation(globalMutationMap[key])
		}
	})

	/**
	 * fetch the profile picture of a user/group
	 * type = "preview" for a low res picture
	 * type = "image for the high res picture"
	 */
	const profilePictureUrl = async(jid: string, type: 'preview' | 'image' = 'preview', timeoutMs?: number) => {
		jid = jidNormalizedUser(jid)
		const result: BinaryNode = await query({
			tag: 'iq',
			attrs: {
				target: jid,
				to: S_WHATSAPP_NET,
				type: 'get',
				xmlns: 'w:profile:picture'
			},
			content: [
				{ tag: 'picture', attrs: { type, query: 'url' } }
			]
		}, timeoutMs)
		const child: BinaryNode | undefined = getBinaryNodeChild(result, 'picture')
		return child?.attrs?.url
	}

	const createCallLink = async(type: 'audio' | 'video', event?: { startTime: number }, timeoutMs?: number) => {
		const result: BinaryNode = await query(
			{
				tag: 'call',
				attrs: {
					id: generateMessageTag(),
					to: '@call'
				},
				content: [
					{
						tag: 'link_create',
						attrs: { media: type },
						content: event ? [{ tag: 'event', attrs: { start_time: String(event.startTime) } }] : undefined
					}
				]
			},
			timeoutMs
		)
		const child: BinaryNode | undefined = getBinaryNodeChild(result, 'link_create')
		return child?.attrs?.token
	}

	const sendPresenceUpdate = async(type: WAPresence, toJid?: string) => {
		const me: Contact = authState.creds.me!
		if(type === 'available' || type === 'unavailable') {
			if(!me.name) {
				logger.warn({}, 'no name present, ignoring presence update request...')
				return
			}

			ev.emit('connection.update', { isOnline: type === 'available' })

			await sendNode({
				tag: 'presence',
				attrs: {
					name: me.name.replace(/@/g, ''),
					type
				}
			})
		} else {
			const { server } = jidDecode(toJid)!
			const isLid: boolean = server === 'lid'
			await sendNode({
				tag: 'chatstate',
				attrs: {
					from: isLid ? me.lid! : me.id,
					to: toJid!,
				},
				content: [
					{
						tag: type === 'recording' ? 'composing' : type,
						attrs: type === 'recording' ? { media: 'audio' } : {}
					}
				]
			})
		}
	}

	/**
	 * @param toJid the jid to subscribe to
	 * @param tcToken token for subscription, use if present
	 */
	const presenceSubscribe = (toJid: string, tcToken?: Buffer) => (
		sendNode({
			tag: 'presence',
			attrs: {
				to: toJid,
				id: generateMessageTag(),
				type: 'subscribe'
			},
			content: tcToken
				? [
					{
						tag: 'tctoken',
						attrs: {},
						content: tcToken
					}
				]
				: undefined
		})
	)

	const handlePresenceUpdate = ({ tag, attrs, content }: BinaryNode) => {
		let presence: PresenceData | undefined
		const jid: string = attrs.from
		const participant: string = attrs.participant || attrs.from

		if(shouldIgnoreJid(jid) && jid !== '@s.whatsapp.net') {
			return
		}

		if(tag === 'presence') {
			presence = {
				lastKnownPresence: attrs.type === 'unavailable' ? 'unavailable' : 'available',
				lastSeen: attrs.last && attrs.last !== 'deny' ? +attrs.last : undefined
			}
		} else if(Array.isArray(content)) {
			const [firstChild] = content
			let type: WAPresence = firstChild.tag as WAPresence
			if(type === 'paused') {
				type = 'available'
			}

			if(firstChild.attrs?.media === 'audio') {
				type = 'recording'
			}

			presence = { lastKnownPresence: type }
		} else {
			logger.error({ tag, attrs, content }, 'recv invalid presence node')
		}

		if(presence) {
			ev.emit('presence.update', { id: jid, presences: { [participant]: presence } })
		}
	}

	const appPatch = async(patchCreate: WAPatchCreate) => {
		const name = patchCreate.type
		const myAppStateKeyId = authState.creds.myAppStateKeyId
		if(!myAppStateKeyId) {
			throw new Boom('App state key not present!', { statusCode: 400 })
		}

		let initial: LTHashState
		let encodeResult: { patch: waproto.ISyncdPatch, state: LTHashState }

		await processingMutex.mutex(
			async() => {
				await authState.keys.transaction(
					async() => {
						logger.debug({ patch: patchCreate }, 'applying app patch')

						await resyncAppState([name], false)

						const { [name]: currentSyncVersion } = await authState.keys.get('app-state-sync-version', [name])
						initial = currentSyncVersion || newLTHashState()

						encodeResult = await encodeSyncdPatch(
							patchCreate,
							myAppStateKeyId,
							initial,
							getAppStateSyncKey,
						)
						const { patch, state } = encodeResult

						const node: BinaryNode = {
							tag: 'iq',
							attrs: {
								to: S_WHATSAPP_NET,
								type: 'set',
								xmlns: 'w:sync:app:state'
							},
							content: [
								{
									tag: 'sync',
									attrs: {},
									content: [
										{
											tag: 'collection',
											attrs: {
												name,
												version: (state.version - 1).toString(),
												'return_snapshot': 'false'
											},
											content: [
												{
													tag: 'patch',
													attrs: {},
													content: waproto.SyncdPatch.encode(patch).finish()
												}
											]
										}
									]
								}
							]
						}
						await query(node)

						await authState.keys.set({ 'app-state-sync-version': { [name]: state } })
					}
				)
			}
		)

		if(config.emitOwnEvents) {
			const { onMutation } = newAppStateChunkHandler(false)
			const { mutationMap } = await decodePatches(
				name,
				[{ ...encodeResult!.patch, version: { version: encodeResult!.state.version }, }],
				initial!,
				getAppStateSyncKey,
				config.options,
				undefined,
				logger,
			)
			for(const key in mutationMap) {
				onMutation(mutationMap[key])
			}
		}
	}

	const fetchProps = async() => {
		const resultNode: BinaryNode = await query({
			tag: 'iq',
			attrs: {
				to: S_WHATSAPP_NET,
				xmlns: 'w',
				type: 'get',
			},
			content: [
				{ tag: 'props', attrs: {
					protocol: '2',
					hash: authState?.creds?.lastPropHash || ''
				} }
			]
		})

		const propsNode: BinaryNode | undefined = getBinaryNodeChild(resultNode, 'props')


		let props: { [_: string]: string } = {}
		if(propsNode) {
			if(propsNode.attrs?.hash) {
				authState.creds.lastPropHash = propsNode?.attrs?.hash
				ev.emit('creds.update', authState.creds)
			}

			props = reduceBinaryNodeToDictionary(propsNode, 'prop')
		}

		logger.debug({}, 'fetched props')

		return props
	}

	/**
	 * modify a chat -- mark unread, read etc.
	 * lastMessages must be sorted in reverse chronologically
	 * requires the last messages till the last message received; required for archive & unread
	*/
	const chatModify = (mod: ChatModification, jid: string) => {
		const patch: WAPatchCreate = chatModificationToAppPatch(mod, jid)
		return appPatch(patch)
	}

	/**
		* Enable/Disable link preview privacy, not related to baileys link preview generation
		*/
	const updateDisableLinkPreviewsPrivacy = (isPreviewsDisabled: boolean) => {
		return chatModify(
			{
				disableLinkPreviews: { isPreviewsDisabled }
			},
			''
		)
	}

	/**
	 * Star or Unstar a message
	 */
	const star = (jid: string, messages: { id: string, fromMe?: boolean }[], star: boolean) => {
		return chatModify({
			star: {
				messages,
				star
			}
		}, jid)
	}

	/**
	 * remove label
	 */
	const removeLabel = (jid: string, labels: LabelActionBody) => {
		return chatModify({
			removeLabel: {
				...labels
			}
		}, jid)
	}

	/**
	 * Add or Edit Contact
	 */
	const addOrEditContact = (jid: string, contact: ContactAction) => {
		return chatModify({
			contact
		}, jid)
	}

	/**
	 * Remove Contact
	 */
	const removeContact = (jid: string) => {
		return chatModify({
			contact: null
		}, jid)
	}

	/**
	 * Adds label
	 */
	const addLabel = (jid: string, labels: LabelActionBody) => {
		return chatModify({
			addLabel: {
				...labels
			}
		}, jid)
	}

	/**
	 * Adds label for the chats
	 */
	const addChatLabel = (jid: string, labelId: string) => {
		return chatModify({
			addChatLabel: {
				labelId
			}
		}, jid)
	}

	/**
	 * Removes label for the chat
	 */
	const removeChatLabel = (jid: string, labelId: string) => {
		return chatModify({
			removeChatLabel: {
				labelId
			}
		}, jid)
	}

	/**
	 * Adds label for the message
	 */
	const addMessageLabel = (jid: string, messageId: string, labelId: string) => {
		return chatModify({
			addMessageLabel: {
				messageId,
				labelId
			}
		}, jid)
	}

	/**
	 * Removes label for the message
	 */
	const removeMessageLabel = (jid: string, messageId: string, labelId: string) => {
		return chatModify({
			removeMessageLabel: {
				messageId,
				labelId
			}
		}, jid)
	}

	/**
	 * queries need to be fired on connection open
	 * help ensure parity with WA Web
	 * */
	const executeInitQueries = async() => {
		await Promise.all([
			fetchProps(),
			fetchBlocklist(),
			fetchPrivacySettings(),
		])
	}

	const upsertMessage = ev.createBufferedFunction(async(msg: WAMessage, type: MessageUpsertType) => {
		ev.emit('messages.upsert', { messages: [msg], type })

		if(!!msg.pushName) {
			let jid = msg.key.fromMe ? authState.creds.me!.id : (msg.key.participant || msg.key.remoteJid)
			jid = jidNormalizedUser(jid!)

			if(!msg.key.fromMe) {
				ev.emit('contacts.update', [{ id: jid, notify: msg.pushName, verifiedName: msg.verifiedBizName! }])
			}

			if(msg.key.fromMe && msg.pushName && authState.creds.me?.name !== msg.pushName) {
				ev.emit('creds.update', { me: { ...authState.creds.me!, name: msg.pushName } })
			}
		}

		const historyMsg = getHistoryMsg(msg.message!)
		const shouldProcessHistoryMsg = historyMsg
			? (
				shouldSyncHistoryMessage(historyMsg)
				&& PROCESSABLE_HISTORY_TYPES.includes(historyMsg.syncType!)
			)
			: false

		if(historyMsg && syncState === SyncState.AwaitingInitialSync) {
			if(awaitingSyncTimeout) {
				clearTimeout(awaitingSyncTimeout)
				awaitingSyncTimeout = undefined
			}

			if(shouldProcessHistoryMsg) {
				syncState = SyncState.Syncing
				logger.info({}, 'Transitioned to Syncing state')
			} else {
				syncState = SyncState.Online
				logger.info({}, 'History sync skipped, transitioning to Online state and flushing buffer')
				ev.flush()
			}
		}

		const doAppStateSync = async() => {
			if(syncState === SyncState.Syncing) {
				logger.info({}, 'Doing app state sync')
				await resyncAppState(ALL_WA_PATCH_NAMES, true)

				syncState = SyncState.Online
				logger.info({}, 'App state sync complete, transitioning to Online state and flushing buffer')
				ev.flush()

				const accountSyncCounter = (authState.creds.accountSyncCounter || 0) + 1
				ev.emit('creds.update', { accountSyncCounter })
			}
		}

		await Promise.all([
			(async() => {
				if(shouldProcessHistoryMsg) {
					await doAppStateSync()
				}
			})(),
			processMessage(
				msg,
				{
					shouldProcessHistoryMsg,
					placeholderResendCache,
					ev,
					creds: authState.creds,
					keyStore: authState.keys,
					logger,
					options: config.options,
					getMessage: config.getMessage,
				}
			)
		])

		if(msg.message?.protocolMessage?.appStateSyncKeyShare && syncState === SyncState.Syncing) {
			logger.info({}, 'App state sync key arrived, triggering app state sync')
			await doAppStateSync()
		}
	})

	ws.on('CB:presence', handlePresenceUpdate)
	ws.on('CB:chatstate', handlePresenceUpdate)

	ws.on('CB:ib,,dirty', async(node: BinaryNode) => {
		const { attrs } = getBinaryNodeChild(node, 'dirty')!
		const type = attrs.type
		switch (type) {
		case 'account_sync':
			if(attrs.timestamp) {
				let { lastAccountSyncTimestamp } = authState.creds
				if(lastAccountSyncTimestamp) {
					await cleanDirtyBits('account_sync', lastAccountSyncTimestamp)
				}

				lastAccountSyncTimestamp = +attrs.timestamp
				ev.emit('creds.update', { lastAccountSyncTimestamp })
			}

			break
		case 'groups':
			break
		default:
			logger.trace({ node }, 'received unknown sync')
			break
		}
	})

	ev.on('connection.update', ({ connection }) => {
		if(connection === 'open') {
			if(fireInitQueries) {
				executeInitQueries()
					.catch(
						error => onUnexpectedError(error, 'init queries')
					)
			}

			sendPresenceUpdate(markOnlineOnConnect ? 'available' : 'unavailable')
				.catch(
					error => onUnexpectedError(error, 'presence update requests')
				)
		}

		if(syncState !== SyncState.Connecting) {
			return
		}

		syncState = SyncState.AwaitingInitialSync
		logger.info({}, 'Connection is now AwaitingInitialSync, buffering events')
		ev.buffer()

		const willSyncHistory = shouldSyncHistoryMessage(
			waproto.Message.HistorySyncNotification.fromObject({
				syncType: waproto.HistorySync.HistorySyncType.RECENT
			})
		)

		if(!willSyncHistory) {
			logger.info({}, 'History sync is disabled by config, not waiting for notification. Transitioning to Online.')
			syncState = SyncState.Online
			setTimeout(() => ev.flush(), 0)
			return
		}

		logger.info({}, 'History sync is enabled, awaiting notification with a 20s timeout.')

		if(awaitingSyncTimeout) {
			clearTimeout(awaitingSyncTimeout)
		}

		awaitingSyncTimeout = setTimeout(() => {
			if(syncState === SyncState.AwaitingInitialSync) {
				logger.warn({}, 'Timeout in AwaitingInitialSync, forcing state to Online and flushing buffer')
				syncState = SyncState.Online
				ev.flush()
			}
		}, 20_000)
	})

	return {
		...sock,
		createCallLink,
		processingMutex,
		fetchPrivacySettings,
		upsertMessage,
		appPatch,
		sendPresenceUpdate,
		presenceSubscribe,
		profilePictureUrl,
		onWhatsApp,
		fetchBlocklist,
		fetchStatus,
		fetchDisappearingDuration,
		updateProfilePicture,
		removeProfilePicture,
		updateProfileStatus,
		updateProfileName,
		updateBlockStatus,
		updateDisableLinkPreviewsPrivacy,
		updateMessagesPrivacy,
		updateCallPrivacy,
		updateLastSeenPrivacy,
		updateOnlinePrivacy,
		updateProfilePicturePrivacy,
		updateStatusPrivacy,
		updateReadReceiptsPrivacy,
		updateGroupsAddPrivacy,
		updateDefaultDisappearingMode,
		getBusinessProfile,
		resyncAppState,
		chatModify,
		cleanDirtyBits,
		addOrEditContact,
		removeContact,
		addLabel,
		removeLabel,
		addChatLabel,
		removeChatLabel,
		addMessageLabel,
		removeMessageLabel,
		star
	}
}
