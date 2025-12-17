import { USyncQueryProtocol } from '../../Types/USync'
import { assertNodeErrorFree, BinaryNode, getBinaryNodeChild } from '../../WABinary'
import { USyncUser } from '../USyncUser'
//import { USyncUser } from '../USyncUser'

export type KeyIndexData = {
	timestamp: number
	signedKeyIndex?: Uint8Array
	expectedTimestamp?: number
}

export type DeviceListData = {
	id: number
	keyIndex?: number
	isHosted?: boolean
}

export type ParsedDeviceInfo = {
    deviceList?: DeviceListData[]
	keyIndex?: KeyIndexData
}

export class USyncDeviceProtocol implements USyncQueryProtocol {
	name = 'devices'

	getQueryElement(): BinaryNode {
		return {
			tag: 'devices',
			attrs: {
				version: '2',
			},
		}
	}

	/**
	* Returns a device query element for the given user.
	* If devicePhash, deviceTimestamp and deviceExpectedTimestamp are all present,
	* returns a 'devices' node with these attributes for optimized device queries.
	* Otherwise returns null to perform a full device query.
	*/
	getUserElement(user: USyncUser): BinaryNode | null {
		const { devicePhash, deviceTimestamp, deviceExpectedTimestamp } = user

		// All three fields must be present for optimized device query
		if (devicePhash && deviceTimestamp !== undefined && deviceExpectedTimestamp !== undefined) {
			return {
				tag: 'devices',
				attrs: {
					phash: devicePhash,
					ts: deviceTimestamp.toString(),
					expected_ts: deviceExpectedTimestamp.toString()
				}
			}
		}

		// Return null to trigger full device list query
		return null
	}

	parser(node: BinaryNode): ParsedDeviceInfo {
		const deviceList: DeviceListData[] = []
		let keyIndex: KeyIndexData | undefined = undefined

		if (node.tag === 'devices') {
			assertNodeErrorFree(node)
			const deviceListNode = getBinaryNodeChild(node, 'device-list')
			const keyIndexNode = getBinaryNodeChild(node, 'key-index-list')

			if (Array.isArray(deviceListNode?.content)) {
				for (const { tag, attrs } of deviceListNode.content) {
					const id = +attrs.id
					const keyIndex = +attrs['key-index']
					if (tag === 'device') {
						deviceList.push({
							id,
							keyIndex,
							isHosted: !!(attrs['is_hosted'] && attrs['is_hosted'] === 'true')
						})
					}
				}
			}

			if (keyIndexNode?.tag === 'key-index-list') {
				keyIndex = {
					timestamp: +keyIndexNode.attrs['ts'],
					signedKeyIndex: keyIndexNode?.content as Uint8Array,
					expectedTimestamp: keyIndexNode.attrs['expected_ts'] ? +keyIndexNode.attrs['expected_ts'] : undefined
				}
			}
		}

		return {
			deviceList,
			keyIndex
		}
	}
}
