import { Boom } from '@hapi/boom'
import { createHash } from 'crypto'
import { waproto } from '../../WAProto'
import {
	KEY_BUNDLE_TYPE,
	WA_ADV_ACCOUNT_SIG_PREFIX,
	WA_ADV_DEVICE_SIG_PREFIX,
	WA_ADV_HOSTED_ACCOUNT_SIG_PREFIX
} from '../Defaults'
import type { AuthenticationCreds, SignalCreds, SignalIdentity, SocketConfig } from '../Types'
import { type BinaryNode, getBinaryNodeChild, jidDecode, S_WHATSAPP_NET } from '../WABinary'
import { Curve, hmacSign } from './crypto'
import { encodeBigEndian } from './generics'
import { hasDetails, toBuffer } from './proto-guards'
import { createSignalIdentity } from './signal'

const getUserAgent = (config: SocketConfig): waproto.ClientPayload.IUserAgent => {
	return {
		appVersion: {
			primary: config.version[0],
			secondary: config.version[1],
			tertiary: config.version[2],
		},
		platform: waproto.ClientPayload.UserAgent.Platform.WEB,
		releaseChannel: waproto.ClientPayload.UserAgent.ReleaseChannel.RELEASE,
		osVersion: '0.1',
		device: 'Desktop',
		osBuildNumber: '0.1',
		localeLanguageIso6391: 'en',
		mnc: '000',
		mcc: '000',
		localeCountryIso31661Alpha2: config.countryCode,
	}
}

const PLATFORM_MAP = {
	'Mac OS': waproto.ClientPayload.WebInfo.WebSubPlatform.DARWIN,
	'Windows': waproto.ClientPayload.WebInfo.WebSubPlatform.WIN32
}

const getWebInfo = (config: SocketConfig): waproto.ClientPayload.IWebInfo => {
	let webSubPlatform = waproto.ClientPayload.WebInfo.WebSubPlatform.WEB_BROWSER
	if (config.syncFullHistory && PLATFORM_MAP[config.browser[0]]) {
		webSubPlatform = PLATFORM_MAP[config.browser[0]]
	}

	return { webSubPlatform }
}


const getClientPayload = (config: SocketConfig) => {
	const payload: waproto.IClientPayload = {
		connectType: waproto.ClientPayload.ConnectType.WIFI_UNKNOWN,
		connectReason: waproto.ClientPayload.ConnectReason.USER_ACTIVATED,
		userAgent: getUserAgent(config),
	}

	payload.webInfo = getWebInfo(config)

	return payload
}


export const generateLoginNode = (userJid: string, config: SocketConfig): waproto.IClientPayload => {
	const { user, device } = jidDecode(userJid)!
	const payload: waproto.IClientPayload = {
		...getClientPayload(config),
		passive: false,
		pull: true,
		username: +user,
		device: device,
	}
	return waproto.ClientPayload.fromObject(payload)
}

const getPlatformType = (platform: string): waproto.DeviceProps.PlatformType => {
	const platformType: string = platform.toUpperCase()
	return waproto.DeviceProps.PlatformType[platformType] || waproto.DeviceProps.PlatformType.DESKTOP
}

export const generateRegistrationNode = (
	{ registrationId, signedPreKey, signedIdentityKey }: SignalCreds,
	config: SocketConfig
) => {
	const appVersionBuf: Buffer = createHash('md5')
		.update(config.version.join('.'))
		.digest()

	const companion: waproto.IDeviceProps = {
		os: config.browser[0],
		platformType: getPlatformType(config.browser[1]),
		requireFullSync: config.syncFullHistory,
		historySyncConfig: {
			/** HistorySyncConfig fullSyncDaysLimit */
			fullSyncDaysLimit: config.syncFullHistoryLimitDays,

			/** HistorySyncConfig fullSyncSizeMbLimit */
			fullSyncSizeMbLimit: undefined,

			/** HistorySyncConfig storageQuotaMb */
			storageQuotaMb: 10240,

			/** HistorySyncConfig inlineInitialPayloadInE2EeMsg */
			inlineInitialPayloadInE2EeMsg: true,

			/** HistorySyncConfig recentSyncDaysLimit */
			recentSyncDaysLimit: config.recentSyncDaysLimit,

			/** HistorySyncConfig supportCallLogHistory */
			supportCallLogHistory: false,

			/** HistorySyncConfig supportBotUserAgentChatHistory */
			supportBotUserAgentChatHistory: true,

			/** HistorySyncConfig supportCagReactionsAndPolls */
			supportCagReactionsAndPolls: true,

			/** HistorySyncConfig supportBizHostedMsg */
			supportBizHostedMsg: true,

			/** HistorySyncConfig supportRecentSyncChunkMessageCountTuning */
			supportRecentSyncChunkMessageCountTuning: true,

			/** HistorySyncConfig supportHostedGroupMsg */
			supportHostedGroupMsg: true,

			/** HistorySyncConfig supportFbidBotChatHistory */
			supportFbidBotChatHistory: true,

			/** HistorySyncConfig supportAddOnHistorySyncMigration */
			supportAddOnHistorySyncMigration: undefined,

			/** HistorySyncConfig supportMessageAssociation */
			supportMessageAssociation: true,

			/** HistorySyncConfig supportGroupHistory */
			supportGroupHistory: true,

			/** HistorySyncConfig onDemandReady */
			onDemandReady: undefined,

			/** HistorySyncConfig supportGuestChat */
			supportGuestChat: undefined,

			/** HistorySyncConfig completeOnDemandReady */
			completeOnDemandReady: undefined,

			/** HistorySyncConfig thumbnailSyncDaysLimit */
			thumbnailSyncDaysLimit: config.thumbnailSyncDaysLimit,
		},
		version: {
			primary: 10,
			secondary: 15,
			tertiary: 7
		}
	}

	const companionProto: Uint8Array = waproto.DeviceProps.encode(companion).finish()

	const registerPayload: waproto.IClientPayload = {
		...getClientPayload(config),
		passive: false,
		pull: false,
		devicePairingData: {
			buildHash: appVersionBuf,
			deviceProps: companionProto,
			eRegid: encodeBigEndian(registrationId),
			eKeytype: KEY_BUNDLE_TYPE,
			eIdent: signedIdentityKey.public,
			eSkeyId: encodeBigEndian(signedPreKey.keyId, 3),
			eSkeyVal: signedPreKey.keyPair.public,
			eSkeySig: signedPreKey.signature,
		},
	}

	return waproto.ClientPayload.fromObject(registerPayload)
}

export const configureSuccessfulPairing = (
	stanza: BinaryNode,
	{ advSecretKey, signedIdentityKey, signalIdentities }: Pick<AuthenticationCreds, 'advSecretKey' | 'signedIdentityKey' | 'signalIdentities'>
) => {
	const msgId: string = stanza.attrs.id

	const pairSuccessNode: BinaryNode | undefined = getBinaryNodeChild(stanza, 'pair-success')
	const deviceIdentityNode: BinaryNode | undefined = getBinaryNodeChild(pairSuccessNode, 'device-identity')
	const platformNode: BinaryNode | undefined = getBinaryNodeChild(pairSuccessNode, 'platform')
	const deviceNode: BinaryNode | undefined = getBinaryNodeChild(pairSuccessNode, 'device')
	const businessNode: BinaryNode | undefined = getBinaryNodeChild(pairSuccessNode, 'biz')

	if (!deviceIdentityNode || !deviceNode) {
		throw new Boom('Missing device-identity or device in pair success node', { data: stanza })
	}

	const bizName: string | undefined = businessNode?.attrs.name
	const jid: string = deviceNode.attrs.jid
	const lid: string = deviceNode.attrs.lid

	const buffer = toBuffer(deviceIdentityNode.content)
	const { details, hmac, accountType } = waproto.ADVSignedDeviceIdentityHMAC.decode(buffer)

	if (!hasDetails({ details })) {
		throw new Boom('Missing details in device identity')
	}

	// TypeScript now knows details is not null/undefined
	const detailsBuffer = details as Uint8Array

	let hmacPrefix: Buffer = Buffer.from([])
	if (accountType !== undefined && accountType === waproto.ADVEncryptionType.HOSTED) {
		hmacPrefix = WA_ADV_HOSTED_ACCOUNT_SIG_PREFIX
	}

	if (!hmac) {
		throw new Boom('Missing hmac in device identity')
	}

	const advSign: Buffer = hmacSign(Buffer.concat([hmacPrefix, detailsBuffer]), Buffer.from(advSecretKey, 'base64'))
	if (Buffer.compare(hmac, advSign) !== 0) {
		throw new Boom('Invalid account signature')
	}

	const account: waproto.ADVSignedDeviceIdentity = waproto.ADVSignedDeviceIdentity.decode(detailsBuffer)
	const { accountSignatureKey, accountSignature, details: deviceDetails } = account

	if (!deviceDetails || deviceDetails.length === 0) {
		throw new Boom('Missing device details')
	}

	if (!accountSignatureKey || accountSignatureKey.length === 0) {
		throw new Boom('Missing account signature key')
	}

	if (!accountSignature || accountSignature.length === 0) {
		throw new Boom('Missing account signature')
	}

	const deviceIdentity: waproto.ADVDeviceIdentity = waproto.ADVDeviceIdentity.decode(deviceDetails)

	const accountSignaturePrefix: Buffer =
		deviceIdentity.deviceType === waproto.ADVEncryptionType.HOSTED
			? WA_ADV_HOSTED_ACCOUNT_SIG_PREFIX
			: WA_ADV_ACCOUNT_SIG_PREFIX
	const accountMsg: Buffer = Buffer.concat([accountSignaturePrefix, deviceDetails, signedIdentityKey.public])
	if (!Curve.verify(accountSignatureKey, accountMsg, accountSignature)) {
		throw new Boom('Failed to verify account signature')
	}

	const deviceMsg: Buffer = Buffer.concat([
		WA_ADV_DEVICE_SIG_PREFIX,
		deviceDetails,
		signedIdentityKey.public,
		accountSignatureKey
	])
	account.deviceSignature = Curve.sign(signedIdentityKey.private, deviceMsg)

	const identity: SignalIdentity = createSignalIdentity(lid, accountSignatureKey)
	const accountEnc: Uint8Array = encodeSignedDeviceIdentity(account, false)

	const reply: BinaryNode = {
		tag: 'iq',
		attrs: {
			to: S_WHATSAPP_NET,
			type: 'result',
			id: msgId,
		},
		content: [
			{
				tag: 'pair-device-sign',
				attrs: { },
				content: [
					{
						tag: 'device-identity',
						attrs: { 'key-index': (deviceIdentity.keyIndex ?? 0).toString() },
						content: accountEnc
					}
				]
			}
		]
	}

	const authUpdate: Partial<AuthenticationCreds> = {
		account,
		me: { id: jid, name: bizName, lid: lid },
		signalIdentities: [
			...(signalIdentities || []),
			identity
		],
		platform: platformNode?.attrs.name
	}

	return {
		creds: authUpdate,
		reply
	}
}

export const encodeSignedDeviceIdentity = (
	account: waproto.IADVSignedDeviceIdentity,
	includeSignatureKey: boolean
) => {
	account = { ...account }
	if (!includeSignatureKey || !account.accountSignatureKey?.length) {
		account.accountSignatureKey = null
	}

	return waproto.ADVSignedDeviceIdentity
		.encode(account)
		.finish()
}
