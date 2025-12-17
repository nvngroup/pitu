import { USyncQueryProtocol } from '../Types/USync'
import { BinaryNode, getBinaryNodeChild } from '../WABinary'
import { USyncContactProtocol, USyncDeviceProtocol, USyncDisappearingModeProtocol, USyncLIDProtocol, USyncStatusProtocol } from './Protocols'
import { USyncUser } from './USyncUser'

export type USyncQueryResultList = { [protocol: string]: unknown, id: string }

export type USyncQueryResult = {
	list: USyncQueryResultList[]
	sideList: USyncQueryResultList[]
	errors?: Array<{
		jid: string
		errorCode: number
		errorText: string
	}>
}

export class USyncQuery {
	protocols: USyncQueryProtocol[]
	users: USyncUser[]
	context: string
	mode: string

	constructor() {
		this.protocols = []
		this.users = []
		this.context = 'interactive'
		this.mode = 'query'
	}

	withMode(mode: string) {
		this.mode = mode
		return this
	}

	withContext(context: string) {
		this.context = context
		return this
	}

	withUser(user: USyncUser) {
		this.users.push(user)
		return this
	}

	parseUSyncQueryResult(result: BinaryNode): USyncQueryResult | undefined {
		if (result.attrs.type !== 'result') {
			return
		}

		const protocolMap = Object.fromEntries(this.protocols.map((protocol) => {
			return [protocol.name, protocol.parser]
		}))

		const queryResult: USyncQueryResult = {
			list: [],
			sideList: [],
			errors: []
		}

		const usyncNode = getBinaryNodeChild(result, 'usync')

		/**
			* Process main list of query results
			* Each user node may contain protocol-specific data or error information
			*/
		const listNode = getBinaryNodeChild(usyncNode, 'list')
		if (Array.isArray(listNode?.content) && typeof listNode !== 'undefined') {
			for (const node of listNode.content) {
				const id = node?.attrs.jid

				// Check for error node in user response
				const errorNode = getBinaryNodeChild(node, 'error')
				if (errorNode) {
					queryResult.errors!.push({
						jid: id,
						errorCode: +errorNode.attrs.code || 0,
						errorText: errorNode.attrs.text || 'Unknown error'
					})
					continue
				}

				// Parse protocol data for successful responses
				const data = Array.isArray(node?.content) ? Object.fromEntries(node.content.map((content) => {
					const protocol = content.tag
					const parser = protocolMap[protocol]
					if (parser) {
						return [protocol, parser(content)]
					} else {
						return [protocol, null]
					}
				}).filter(([, b]) => b !== null) as [string, unknown][]) : {}

				queryResult.list.push({ ...data, id })
			}
		}

		/**
			* Process side list - additional users discovered through the query
			* (e.g., linked accounts, alternate addresses)
			*/
		const sideListNode = getBinaryNodeChild(usyncNode, 'side_list')
		if (Array.isArray(sideListNode?.content) && typeof sideListNode !== 'undefined') {
			for (const node of sideListNode.content) {
				const id = node?.attrs.jid

				// Check for error node in side list entry
				const errorNode = getBinaryNodeChild(node, 'error')
				if (errorNode) {
					queryResult.errors!.push({
						jid: id,
						errorCode: +errorNode.attrs.code || 0,
						errorText: errorNode.attrs.text || 'Unknown error'
					})
					continue
				}

				// Parse protocol data for side list entries
				const data = Array.isArray(node?.content) ? Object.fromEntries(node.content.map((content) => {
					const protocol = content.tag
					const parser = protocolMap[protocol]
					if (parser) {
						return [protocol, parser(content)]
					} else {
						return [protocol, null]
					}
				}).filter(([, b]) => b !== null) as [string, unknown][]) : {}

				queryResult.sideList.push({ ...data, id })
			}
		}

		// Clean up errors array if empty
		if (queryResult.errors!.length === 0) {
			delete queryResult.errors
		}

		return queryResult
	}

	withDeviceProtocol() {
		this.protocols.push(new USyncDeviceProtocol())
		return this
	}

	withContactProtocol() {
		this.protocols.push(new USyncContactProtocol())
		return this
	}

	withStatusProtocol() {
		this.protocols.push(new USyncStatusProtocol())
		return this
	}

	withDisappearingModeProtocol() {
		this.protocols.push(new USyncDisappearingModeProtocol())
		return this
	}

	withLIDProtocol() {
		this.protocols.push(new USyncLIDProtocol())
		return this
	}
}
