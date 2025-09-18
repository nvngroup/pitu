import { BinaryNode } from '../WABinary'
import { USyncUser } from '../WAUSync'

/**
 * Defines the interface for a USyncQuery protocol
 */
export interface USyncQueryProtocol {
    name: string
    getQueryElement: () => BinaryNode
    getUserElement: (user: USyncUser) => BinaryNode | null
    parser: (data: BinaryNode) => unknown
}
