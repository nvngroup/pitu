import { USyncQueryProtocol } from '../../Types/USync'
import { BinaryNode } from '../../WABinary'
import { USyncUser } from '../USyncUser'

export class USyncLIDProtocol implements USyncQueryProtocol {
	name = 'lid'

	getQueryElement(): BinaryNode {
		return {
			tag: 'lid',
			attrs: {}
		}
	}

	getUserElement(user: USyncUser): BinaryNode | null {
		if(user.lid) {
			return {
				tag: 'lid',
				attrs: { jid: user.lid }
			}
		} else {
			return null
		}
	}

	parser(node: BinaryNode): string | null {
		if(node.tag === 'lid') {
			return node.attrs.val
		}

		return null
	}
}
