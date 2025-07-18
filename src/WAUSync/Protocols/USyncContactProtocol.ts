import { USyncQueryProtocol } from '../../Types/USync'
import { assertNodeErrorFree, BinaryNode } from '../../WABinary'
import { USyncUser } from '../USyncUser'

export class USyncContactProtocol implements USyncQueryProtocol {
	name = 'contact'

	getQueryElement(): BinaryNode {
		return {
			tag: 'contact',
			attrs: {},
		}
	}

	getUserElement(user: USyncUser): BinaryNode {
		// Implementa os campos type e username se disponíveis
		const attrs: Record<string, string> = {}
		if(user.type) {
			attrs.type = user.type
		}

		if(user.username) {
			attrs.username = user.username
		}

		return {
			tag: 'contact',
			attrs,
			content: user.phone,
		}
	}

	parser(node: BinaryNode): boolean {
		if(node.tag === 'contact') {
			assertNodeErrorFree(node)
			return node?.attrs?.type === 'in'
		}

		return false
	}
}
