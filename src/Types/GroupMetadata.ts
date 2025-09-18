import { Contact } from './Contact'

export type GroupParticipant = (Contact & { isAdmin?: boolean, isSuperAdmin?: boolean, admin?: 'admin' | 'superadmin' | null, jid?: string | undefined })

export type ParticipantAction = 'add' | 'remove' | 'promote' | 'demote' | 'modify'

export type RequestJoinAction = 'created' | 'revoked' | 'rejected'

export type RequestJoinMethod = 'invite_link' | 'linked_group_join' | 'non_admin_add' | undefined

export interface GroupMetadata {
    id: string
    addressingMode: 'pn' | 'lid'
    owner: string | undefined
    ownerJid?: string
    ownerCountryCode: string
    subject: string
    subjectOwner?: string
    subjectOwnerJid?: string
    subjectTime?: number
    creation?: number
    desc?: string
    descOwner?: string
    descOwnerJid?: string
    descId?: string
    descTime?: number
    linkedParent?: string
    restrict?: boolean
    announce?: boolean
    memberAddMode?: boolean
    joinApprovalMode?: boolean
    isCommunity?: boolean
    isCommunityAnnounce?: boolean
    size?: number
    participants: GroupParticipant[]
    ephemeralDuration?: number
    inviteCode?: string
    author?: string
}


export interface WAGroupCreateResponse {
    status: number
    gid?: string
    participants?: [{ [key: string]: {} }]
}

export interface GroupModificationResponse {
    status: number
    participants?: { [key: string]: {} }
}
