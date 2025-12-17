import { Boom } from '@hapi/boom'
import { SocketConfig } from '../Types'
import { BinaryNode, S_WHATSAPP_NET } from '../WABinary'
import { USyncQuery, USyncUser } from '../WAUSync'
import { makeSocket } from './socket'

export const makeUSyncSocket = (config: SocketConfig) => {
	const { logger } = config
	const sock = makeSocket(config)

	const {
		generateMessageTag,
		query,
	} = sock

	const executeUSyncQuery = async(usyncQuery: USyncQuery) => {
		if (usyncQuery.protocols.length === 0) {
			throw new Boom('USyncQuery must have at least one protocol')
		}

		/**
			* Validate users before processing:
			* - User must have a valid id (non-empty string)
			* - If phone is set, id should be a valid phone number format
			* Invalid users are filtered out and logged as warnings
			*/
		const validUsers: USyncUser[] = usyncQuery.users.filter(user => {
			if (!user.id || typeof user.id !== 'string' || user.id.trim().length === 0) {
				logger?.warn({ user }, 'Invalid USyncUser: missing or empty id')
				return false
			}

			// If phone flag is set, validate that id looks like a phone number
			if (user.phone && !user.id.match(/^\+?\d+(@s\.whatsapp\.net)?$/)) {
				logger?.warn({ user }, 'Invalid USyncUser: phone flag set but id is not a valid phone number')
				return false
			}

			return true
		})

		if (validUsers.length === 0) {
			logger?.warn(
				{ originalCount: usyncQuery.users.length },
				'USyncQuery has no valid users after validation'
			)
			throw new Boom('USyncQuery must have at least one valid user', { statusCode: 400 })
		}

		if (validUsers.length < usyncQuery.users.length) {
			logger?.warn(
				{
					originalCount: usyncQuery.users.length,
					validCount: validUsers.length,
					filteredCount: usyncQuery.users.length - validUsers.length
				},
				'Some users were filtered out due to validation errors'
			)
		}

		const userNodes: BinaryNode[] = validUsers.map((user) => {
			return {
				tag: 'user',
				attrs: {
					jid: !user.phone ? user.id : undefined,
				},
				content: usyncQuery.protocols
					.map((a) => a.getUserElement(user))
					.filter(a => a !== null)
			} as BinaryNode
		})

		const listNode: BinaryNode = {
			tag: 'list',
			attrs: {},
			content: userNodes
		}

		const queryNode: BinaryNode = {
			tag: 'query',
			attrs: {},
			content: usyncQuery.protocols.map((a) => a.getQueryElement())
		}
		const iq = {
			tag: 'iq',
			attrs: {
				to: S_WHATSAPP_NET,
				type: 'get',
				xmlns: 'usync',
			},
			content: [
				{
					tag: 'usync',
					attrs: {
						context: usyncQuery.context,
						mode: usyncQuery.mode,
						sid: generateMessageTag(),
						last: 'true',
						index: '0',
					},
					content: [
						queryNode,
						listNode
					]
				}
			],
		}

		const result: BinaryNode = await query(iq)

		return usyncQuery.parseUSyncQueryResult(result)
	}

	return {
		...sock,
		executeUSyncQuery,
	}
}
