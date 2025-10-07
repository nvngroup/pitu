# Baileys Socket - Documentation

## Table of Contents

- [Introduction](#introduction)
- [Socket Overview](#socket-overview)
- [Socket Events](#socket-events)
  - [connection.update](#connectionupdate)
  - [creds.update](#credsupdate)
  - [messaging-history.set](#messaging-historyset)
  - [chats.upsert](#chatsupsert)
  - [chats.update](#chatsupdate)
  - [chats.phoneNumberShare](#chatsphonenumbershare)
  - [chats.delete](#chatsdelete)
  - [presence.update](#presenceupdate)
  - [contacts.upsert](#contactsupsert)
  - [contacts.update](#contactsupdate)
  - [messages.delete](#messagesdelete)
  - [messages.update](#messagesupdate)
  - [messages.media-update](#messagesmedia-update)
  - [messages.upsert](#messagesupsert)
  - [messages.reaction](#messagesreaction)
  - [message-receipt.update](#message-receiptupdate)
  - [groups.upsert](#groupsupsert)
  - [groups.update](#groupsupdate)
  - [group-participants.update](#group-participantsupdate)
  - [group.join-request](#groupjoin-request)
  - [blocklist.set](#blocklistset)
  - [blocklist.update](#blocklistupdate)
  - [call](#call)
  - [labels.edit](#labelsedit)
  - [labels.association](#labelsassociation)
- [Authentication and Session](#authentication-and-session)
- [Default Socket Settings](#default-socket-settings)
  - [patchMessageBeforeSending](#patchmessagebeforesending)
  - [shouldSyncHistoryMessage](#shouldsynchistorymessage)
  - [shouldIgnoreJid](#shouldignorejid)
  - [getMessage](#getmessage)
  - [cachedGroupMetadata](#cachedgroupmetadata)
  - [makeSignalRepository](#makesignalrepository)
- [Message Management](#message-management)
  - [Sending Messages](#sending-messages)
  - [Internal Message Management](#internal-message-management)
    - [Message Generation and Sending](#1-message-generation-and-sending)
    - [Special Sending Options](#2-special-sending-options)
    - [Sending to Groups, Contacts, and Status](#3-sending-to-groups-contacts-and-status)
    - [Read and Delivery Receipts](#4-read-and-delivery-receipts)
    - [Sync and Sessions](#5-sync-and-sessions)
    - [Best Practices and Notes](#6-best-practices-and-notes)
- [Group Management](#group-management)
  - [Fetch Group Metadata](#1-fetch-group-metadata)
  - [Create a Group](#2-create-a-group)
  - [Leave a Group](#3-leave-a-group)
  - [Update Group Subject](#4-update-group-subject)
  - [Update Group Description](#5-update-group-description)
  - [Manage Participants](#6-manage-participants)
  - [Fetch All Participating Groups](#7-fetch-all-participating-groups)
  - [Manage Invites](#8-manage-invites)
  - [Advanced Modes and Settings](#9-advanced-modes-and-settings)
  - [Manage Join Requests](#10-manage-join-requests)
  - [Group-Related Events](#11-group-related-events)
- [Chat Management](#chat-management)
  - [Modify a Chat (mark as read, archive, etc)](#1-modify-a-chat-mark-as-read-archive-etc)
  - [Manage Contacts](#2-manage-contacts)
  - [Update Profile Photo, Name, and Status](#3-update-profile-photo-name-and-status)
  - [Manage Labels](#4-manage-labels)
  - [Manage Privacy](#5-manage-privacy)
  - [Manage Disappearing Mode](#6-manage-disappearing-mode)
  - [Fetch Blocked Contacts List](#7-fetch-blocked-contacts-list)
  - [Block or Unblock Contact](#8-block-or-unblock-contact)
  - [Fetch Business Profile](#9-fetch-business-profile)
  - [Fetch Status, Bots, and Disappearing Mode](#10-fetch-status-bots-and-disappearing-mode)
  - [Chat-Related Events](#11-chat-related-events)
- [Business Messages](#business-messages)
  - [Fetch Product Catalog](#1-fetch-product-catalog)
  - [Fetch Catalog Collections](#2-fetch-catalog-collections)
  - [Fetch Order Details](#3-fetch-order-details)
  - [Create Product in Catalog](#4-create-product-in-catalog)
  - [Edit Product in Catalog](#5-edit-product-in-catalog)
  - [Delete Product(s) from Catalog](#6-delete-products-from-catalog)
- [Data Sync (USync)](#data-sync-usync)
- [Socket Utilities](#socket-utilities)

## Introduction

Baileys Socket allows direct connection to WhatsApp Web via WebSocket, without the need for Selenium or browsers. It is highly efficient, consumes less memory, and supports multiple devices.

## Socket Overview

Baileys Socket is the core responsible for real-time communication with WhatsApp Web, using the WebSocket protocol. It abstracts all the complexity of connection, authentication, sending and receiving events and messages, allowing developers to create robust and scalable integrations with the WhatsApp platform.

Main features:

- **Direct Connection:** Uses WebSocket for efficient communication, no browsers or Selenium required.
- **Multi-device:** Supports authentication and use on multiple devices, following the WhatsApp Web standard.
- **Session Management:** Allows saving and restoring sessions, avoiding the need for recurring authentication.
- **Real-time Events:** Emits events for all relevant actions, such as receiving messages, chat updates, groups, presence, and more.
- **Message Sending and Receiving:** Full support for text messages, media, reactions, lists, polls, and other formats.
- **Group and Contact Management:** Allows programmatic creation, editing, and management of groups and contacts.
- **Extensible:** Modular structure, making it easy to add new features and integrations.

The Socket is the foundation for all Baileys operations, essential for any application that wants to interact with WhatsApp in an automated and reliable way.

## Socket Events

`BaileysEventMap` defines all events that can be emitted by the Baileys Socket. Each event represents a relevant action or update during communication with WhatsApp. Below, I explain each of the main events:

### connection.update

Update of the WebSocket connection state (open, closed, connecting, etc). Allows monitoring the health of the connection and reacting to drops or reconnections.

Listen for connection updates:

```ts
sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
        console.log('Connected to WhatsApp!')
    } else if (update.connection === 'close') {
        console.log('Connection closed:', update.lastDisconnect?.error)
    }
})
```

### creds.update

Update of authentication credentials. Important for persisting session data and avoiding the need for a new login.

Always save credentials when updated:

```ts
sock.ev.on('creds.update', (creds) => {
    saveCreds(creds)
})
```

### messaging-history.set

Synchronization of chat, contact, and message history. Used when restoring sessions or syncing old data.

- `chats`: List of synced chats
- `contacts`: List of contacts
- `messages`: Synced messages
- `isLatest`: Indicates if this is the latest history
- `progress`: Sync progress
- `syncType`: Type of sync
- `peerDataRequestSessionId`: Request session ID

Receive chat, contact, and message history:

```ts
sock.ev.on('messaging-history.set', (data) => {
    console.log('History synced:', data)
})
```

### chats.upsert

Insertion of new detected chats.

Detect new chats:

```ts
sock.ev.on('chats.upsert', (chats) => {
    chats.forEach(chat => console.log('New chat:', chat))
})
```

### chats.update

Update of existing chats (e.g., name, status, etc).

Chat updates:

```ts
sock.ev.on('chats.update', (updates) => {
    updates.forEach(update => console.log('Chat updated:', update))
})
```

### chats.phoneNumberShare

Phone number sharing event in a chat.

Number sharing:

```ts
sock.ev.on('chats.phoneNumberShare', (data) => {
    console.log('Number shared:', data)
})
```

### chats.delete

Deletion of chats by ID.

Chat deletion:

```ts
sock.ev.on('chats.delete', (ids) => {
    console.log('Chats deleted:', ids)
})
```

### presence.update

Update of presence (online, typing, etc) of contacts in a chat.

Presence change:

```ts
sock.ev.on('presence.update', (data) => {
    console.log('Presence updated:', data)
})
```

### contacts.upsert

Insertion of new contacts.

New contacts:

```ts
sock.ev.on('contacts.upsert', (contacts) => {
    contacts.forEach(contact => console.log('New contact:', contact))
})
```

### contacts.update

Update of existing contacts.

Contact update:

```ts
sock.ev.on('contacts.update', (updates) => {
    updates.forEach(update => console.log('Contact updated:', update))
})
```

### messages.delete

Deletion of messages. Can be by specific key(s) or all from a chat.

Message deletion:

```ts
sock.ev.on('messages.delete', (info) => {
    console.log('Messages deleted:', info)
})
```

### messages.update

Update of messages (e.g., edit, delivery status, etc).

Message update:

```ts
sock.ev.on('messages.update', (updates) => {
    updates.forEach(update => console.log('Message updated:', update))
})
```

### messages.media-update

Media update in messages (download, upload, error, etc).

Media update:

```ts
sock.ev.on('messages.media-update', (medias) => {
    medias.forEach(media => console.log('Media updated:', media))
})
```

### messages.upsert

Insertion of new messages (received or sent). Includes type (notify, append, etc) and optionally a requestId.

New messages:

```ts
sock.ev.on('messages.upsert', ({ messages, type }) => {
    messages.forEach(msg => console.log('New message:', msg))
})
```

### messages.reaction

Reaction to messages (e.g., emoji). If the reaction is removed, the `reaction.text` field will be empty.

Message reactions:

```ts
sock.ev.on('messages.reaction', (reactions) => {
    reactions.forEach(reaction => console.log('Reaction:', reaction))
})
```

### message-receipt.update

Update of message receipts (delivered, read, etc).

Message receipts:

```ts
sock.ev.on('message-receipt.update', (receipts) => {
    receipts.forEach(receipt => console.log('Receipt:', receipt))
})
```

### groups.upsert

Insertion of new groups.

New groups:

```ts
sock.ev.on('groups.upsert', (groups) => {
    groups.forEach(group => console.log('New group:', group))
})
```

### groups.update

Update of existing groups.

Group update:

```ts
sock.ev.on('groups.update', (updates) => {
    updates.forEach(update => console.log('Group updated:', update))
})
```

### group-participants.update

Action on group participants (add, remove, promote, etc).

- `id`: Group ID
- `author`: Who performed the action
- `participants`: Affected participants
- `action`: Type of action

Group participants change:

```ts
sock.ev.on('group-participants.update', (data) => {
    console.log('Group participants updated:', data)
})
```

### group.join-request

Group join request, including method and action taken.

Group join request:

```ts
sock.ev.on('group.join-request', (data) => {
    console.log('Group join request:', data)
})
```

### blocklist.set

Setting the blocked contacts list.

Blocklist set:

```ts
sock.ev.on('blocklist.set', (data) => {
    console.log('Blocklist set:', data)
})
```

### blocklist.update

Update of the blocklist (addition or removal).

Blocklist update:

```ts
sock.ev.on('blocklist.update', (data) => {
    console.log('Blocklist updated:', data)
})
```

### call

Update about calls (received, rejected, accepted, etc).

Call update:

```ts
sock.ev.on('call', (calls) => {
    calls.forEach(call => console.log('Call:', call))
})
```

### labels.edit

Editing labels for organizing chats/messages.

Label edit:

```ts
sock.ev.on('labels.edit', (label) => {
    console.log('Label edited:', label)
})
```

### labels.association

Association or removal of labels in chats or messages.

Label association:

```ts
sock.ev.on('labels.association', (data) => {
    console.log('Label association:', data)
})
```

## Authentication and Session

Authentication and session management are fundamental to ensure your application maintains access to WhatsApp without needing to scan the QR Code on every run. Baileys makes this process easy through the `makeWASocket` method and credential persistence utilities.

### Creating the Socket with makeWASocket

`makeWASocket` is the main function to initialize the connection with WhatsApp Web. It accepts several configuration options, including authentication state.

#### Basic connection example

```ts
import makeWASocket from 'baileys'

const sock = makeWASocket({
    printQRInTerminal: true // Shows the QR Code in the terminal for authentication
})
```

### Saving and Restoring Session

To avoid the need for manual authentication every time, use the `useMultiFileAuthState` utility to save and restore credentials:

```ts
import makeWASocket, { useMultiFileAuthState } from 'baileys'

async function startSocket() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    })
    sock.ev.on('creds.update', saveCreds)
}

startSocket()
```

- The `useMultiFileAuthState` method stores credentials in files, making persistence between runs easier.
- The `creds.update` event should be listened to automatically save credentials whenever there is a change.

### Notes

- Always save credentials after any update to avoid session loss.
- The directory passed to `useMultiFileAuthState` can be customized as needed.
- For production, it is recommended to store credentials in a secure and, if possible, encrypted location.

## Default Socket Settings

Baileys offers a default configuration for the Socket, defined in `DEFAULT_CONNECTION_CONFIG`. These options control connection behavior, authentication, performance, and advanced features. You can override any of them when creating the socket with `makeWASocket`.

### Main Default Options

- **version**: WhatsApp Web protocol version used.
- **browser**: Emulated browser identification (e.g., Ubuntu/Chrome).
- **waWebSocketUrl**: WhatsApp Web WebSocket URL.
- **connectTimeoutMs**: Maximum time (ms) to try to connect.
- **keepAliveIntervalMs**: Interval (ms) for sending keep-alive packets.
- **logger**: Default logger for Baileys logs.
- **emitOwnEvents**: Whether own events should be emitted.
- **defaultQueryTimeoutMs**: Default timeout for queries (ms).
- **customUploadHosts**: Custom hosts for media upload.
- **retryRequestDelayMs**: Delay between request retries (ms).
- **maxMsgRetryCount**: Maximum attempts to resend messages.
- **fireInitQueries**: Whether to fire initial queries on connect.
- **auth**: Authentication state (must be provided by the user).
- **markOnlineOnConnect**: Whether status should be marked as online on connect.
- **syncFullHistory**: Whether to sync the entire message history.
- **patchMessageBeforeSending**: Function to modify messages before sending.
- **shouldSyncHistoryMessage**: Function to decide whether to sync historical messages.
- **shouldIgnoreJid**: Function to ignore specific JIDs.
- **linkPreviewImageThumbnailWidth**: Link preview thumbnail width.
- **transactionOpts**: Options for internal transactions (retries, delays).
- **generateHighQualityLinkPreview**: Generates high-quality link previews.
- **options**: Object for additional settings.
- **appStateMacVerification**: App state integrity verification.
- **countryCode**: Default country code (e.g., 'US').
- **getMessage**: Function to fetch messages from local storage.
- **cachedGroupMetadata**: Function for group metadata cache.
- **makeSignalRepository**: Function to create the Signal repository (encryption).

### Example of customizing settings

```ts
const sock = makeWASocket({
    printQRInTerminal: true,
    browser: Browsers.macOS('Safari'), // Emulates Safari/macOS
    markOnlineOnConnect: false, // Do not mark online on connect
    syncFullHistory: true, // Sync entire history
    countryCode: 'BR', // Set default country to Brazil
    logger: customLogger // Custom logger
})
```

You can override only the options you want, keeping the rest of the default settings.

> See the `SocketConfig` type for all available options and their detailed descriptions.

### patchMessageBeforeSending

The `patchMessageBeforeSending` option allows you to modify or adjust a message before it is sent to WhatsApp. This function receives the message object as a parameter and should return the (possibly changed) message. It is useful for adding, removing, or transforming fields dynamically, such as inserting metadata, correcting formatting, or applying specific business rules.

#### Example usage

```ts
const sock = makeWASocket({
    patchMessageBeforeSending: (msg) => {
        // Example: add a custom tag to all text messages
        if (msg.text) {
            msg.text = '[BOT] ' + msg.text
        }
        return msg
    }
})
```

You can use this function to:

- Add prefixes or suffixes to messages
- Inject extra information (e.g., IDs, tags)
- Correct or standardize fields before sending
- Apply content filters

If you don't need to modify anything, just return the received message.

> Tip: Use with caution to avoid generating messages incompatible with the WhatsApp protocol.

### shouldSyncHistoryMessage

The `shouldSyncHistoryMessage` function allows you to programmatically control whether a historical message (old messages retrieved during sync) should be synced or ignored by Baileys. It receives the message as a parameter and should return `true` (to sync) or `false` (to ignore).

This function is useful for filtering old messages, for example, ignoring messages from certain types, groups, or contacts during history restoration.

#### Example of usage

```ts
const sock = makeWASocket({
    shouldSyncHistoryMessage: (msg) => {
        // Example: ignore messages from specific groups
        if (msg.key.remoteJid?.endsWith('@g.us')) {
            return false // do not sync group messages
        }
        return true // sync all others
    }
})
```

You can use this function to:

- Sync only messages from specific contacts
- Ignore messages from groups, channels, or bots
- Filter messages by type (text, media, etc)
- Reduce the amount of data synced in large histories

If not defined, the default is to sync all historical messages (`true`).

### shouldIgnoreJid

The `shouldIgnoreJid` function allows you to programmatically define which JIDs (user, group, channel, etc identifiers) should be ignored by Baileys during sync and event/message processing. It receives the JID as a parameter and should return `true` (to ignore) or `false` (to process normally).

This function is useful for filtering groups, contacts, channels, or any JID you don't want your bot/process to interact with or process.

#### Example of usage

```ts
const sock = makeWASocket({
    shouldIgnoreJid: (jid) => {
        // Example: ignore all groups
        if (jid.endsWith('@g.us')) {
            return true // ignore groups
        }
        // Example: ignore a specific contact
        if (jid === '123456789@s.whatsapp.net') {
            return true
        }
        return false // process all others
    }
})
```

You can use this function to:

- Ignore specific groups, channels, or contacts
- Block interactions with certain JIDs
- Reduce processing of unwanted events

If not defined, the default is to process all JIDs (`false`).

### getMessage

The `getMessage` function is used to fetch and return a specific message from your application's local storage, based on an identifier (usually the `WAMessageKey`).

It is essential for scenarios where Baileys needs to access the full content of a previously received or sent message, such as when resending, editing, deleting, or processing reactions and read receipts.

This function should be asynchronous and return the corresponding message for the provided identifier, or `undefined` if not found.

#### Example of usage

```ts
const sock = makeWASocket({
    getMessage: async (key) => {
        // Example: fetch the message from a local database or cache
        return await fetchMessageFromDatabase(key.id)
    }
})
```

You can use this function to:

- Allow Baileys to retrieve old messages for operations like deletion, editing, quoting
- Integrate with your own databases, caches, or persistence systems
- Ensure that operations dependent on previous messages work correctly

If not defined, the default is to return `undefined`, which may limit some Baileys features.

> Tip: Implement an efficient storage system to ensure performance and integrity when fetching messages by key.

### cachedGroupMetadata

The `cachedGroupMetadata` function allows you to provide Baileys with a caching mechanism for group metadata (such as name, participants, description, settings, etc). It is called whenever the socket needs to access detailed group information, avoiding multiple requests to the WhatsApp API and improving application performance.

This function should be asynchronous and receive the group JID as a parameter, returning the group metadata (if cached) or `undefined` if not available locally.

#### Example of usage

```ts
const sock = makeWASocket({
    cachedGroupMetadata: async (jid) => {
        // Example: fetch group metadata from a database or local cache
        return await fetchGroupMetadataFromCache(jid)
    }
})
```

You can use this function to:

- Reduce repeated calls to the WhatsApp API for already known groups
- Integrate with databases, Redis, or other caching systems
- Improve performance and scalability of bots interacting with many groups

If not defined, the default is not to use cache, making a new request whenever necessary.

> Tip: Keep the cache updated whenever there are group update events to ensure consistent information.

### makeSignalRepository

The `makeSignalRepository` function is responsible for creating and providing the Signal repository used by Baileys to manage all end-to-end encryption of messages, groups, and calls. The Signal Protocol is the security standard used by WhatsApp to ensure privacy and integrity of communications.

This function should return a Signal Protocol-compatible implementation, responsible for storing and retrieving keys, sessions, and other cryptographic data needed for the secure operation of the socket.

In most cases, Baileys already provides a default implementation (`makeLibSignalRepository`), but you can customize it to integrate with databases, distributed systems, or high-availability solutions.

#### Example of usage

```ts
const sock = makeWASocket({
    makeSignalRepository: makeLibSignalRepository // Baileys default
})
```

You can customize this function to:

- Integrate key storage with external databases
- Implement backup and recovery strategies for Signal sessions
- Ensure high availability and resilience in distributed environments

If not defined, the default is to use Baileys' internal implementation, which already meets most use cases.

> Tip: Only change this function if you really need advanced control over Signal key storage. For most bots and integrations, the default implementation is sufficient and secure.

## Message Management

Message management is one of the main features of Baileys Socket, allowing you to send, edit, delete, quote, react, and download media programmatically. Below are the most common operations, practical examples, and usage tips.

### Sending Messages

To send messages, use the `sock.sendMessage` method. It accepts the recipient's JID and the message content (text, media, buttons, lists, polls, among others).

#### Example: Sending a text message

```ts
await sock.sendMessage('5511999999999@s.whatsapp.net', { text: 'Hello, world!' })
```

#### Example: Sending an image

```ts
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    image: { url: './Media/cat.jpeg' },
    caption: 'Check out this cat!'
})
```

#### Example: Sending audio

```ts
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    audio: { url: './Media/sonata.mp3' },
    mimetype: 'audio/mp4',
    ptt: true // send as voice note
})
```

#### Notes

- The JID can be a contact, group, or broadcast.
- For media, use `{ url: 'file/path' }` or buffer.
- The method returns the sent message object, including the `key` (used for editing, deletion, quoting, etc).

### Internal Message Management

The `sendMessage` method of Baileys is highly robust and flexible, allowing sending of messages to contacts, groups, status, and even advanced operations like editing, deletion, pinning, polls, and more. Below, I detail how message management works internally, based on the source code (`src/Socket/messages-send.ts`).

#### 1. Message Generation and Sending

- The `sendMessage` method prepares the message using `generateWAMessage`, which assembles the content according to the type (text, media, buttons, etc) and applies the provided options.
- Before sending, the message can be modified by the `patchMessageBeforeSending` function (useful for global customizations).
- The actual sending is done by `relayMessage`, which handles encryption, distribution to multiple devices and participants (in groups), and assembling special attributes (edit, delete, pin, etc).
- The method returns the complete sent message object, including the `key` (used for editing, deletion, quoting, etc).

#### 2. Special Sending Options

- **Edit:** By passing `{ edit: messageKey }` in the options, the message will be edited (if allowed by WhatsApp).
- **Delete:** By passing `{ delete: messageKey }`, the message will be deleted for all possible participants.
- **Pin:** By passing `{ pin: true }`, the message will be pinned in the chat (if supported).
- **Polls:** Sending polls is handled specially, adding specific metadata.

#### 3. Sending to Groups, Contacts, and Status

- Baileys automatically detects if the JID is a group, contact, or status, and adjusts sending as needed.
- For groups, it handles distribution to all participants and management of encryption keys (Signal Protocol).
- For status, it uses the special JID `status@broadcast`.

#### 4. Read and Delivery Receipts

- The `readMessages` method allows marking messages as read, respecting the user's privacy settings.
- The `sendReceipt` method allows sending custom receipts (read, delivered, etc) for specific messages.
- The `sendReceipts` method allows sending receipts in bulk for multiple messages/chats.

#### 5. Sync and Sessions

- Baileys automatically manages sessions and devices, guaranteeing that messages are delivered to all recipient devices (multi-device).
- Utilizes cache and sync to optimize sending and avoid redundancies.

#### 6. Best Practices and Notes

- Always use the return of `sendMessage` to store the message object, making future operations (edit, delete, quote, etc) easier.
- For bulk operations (e.g., marking multiple messages as read), use the bulk methods (`readMessages`, `sendReceipts`).
- Sending to groups is more complex due to the need to distribute keys and ensure delivery to all participants.
- Baileys automatically handles end-to-end encryption, but it is important to keep session and key storage secure.
- Use socket events (`messages.upsert`, `messages.update`, etc) to monitor message status and update your system in real time.

#### 7. Advanced Example: Sending, Editing, and Deleting

```ts
// Sending a message and then editing and deleting it
const msg = await sock.sendMessage(jid, { text: 'Original message' })

// Editing the message
await sock.sendMessage(jid, { text: 'Edited message' }, { edit: msg.key })

// Deleting the message
await sock.sendMessage(jid, { delete: msg.key })
```

#### 8. Example: Marking multiple messages as read

```ts
// Assuming you have an array of WAMessageKey
await sock.readMessages([key1, key2, key3])
```

#### 9. Example: Sending to group with quote

```ts
// Replying to a message in a group
await sock.sendMessage(groupJid, { text: 'Hello, group!' }, { quoted: originalMessage })
```

## Group Management

Baileys offers a complete API for managing WhatsApp groups, allowing you to create, edit, fetch information, manage participants, and control advanced group settings. All operations are asynchronous and follow the socket's event and method pattern.

### Main Methods

#### 1. Fetch Group Metadata

```ts
const metadata = await sock.groupMetadata(jid)
```

Returns detailed group information, such as name, participants, description, settings, etc.

#### 2. Create a Group

```ts
const metadata = await sock.groupCreate('Group Name', ['jid1@s.whatsapp.net', 'jid2@s.whatsapp.net'])
```

Creates a new group with the given name and participants.

#### 3. Leave a Group

```ts
await sock.groupLeave('group-id@g.us')
```

Removes the current user from the group.

#### 4. Update Group Subject

```ts
await sock.groupUpdateSubject('group-id@g.us', 'New Subject')
```

Changes the group name/subject.

#### 5. Update Group Description

```ts
await sock.groupUpdateDescription('group-id@g.us', 'New description')
```

Changes the group description. To remove, just pass `undefined` as the description.

#### 6. Manage Participants

Add, remove, promote, or demote participants:

```ts
await sock.groupParticipantsUpdate('group-id@g.us', ['jid@s.whatsapp.net'], 'add')      // Add
await sock.groupParticipantsUpdate('group-id@g.us', ['jid@s.whatsapp.net'], 'remove')   // Remove
await sock.groupParticipantsUpdate('group-id@g.us', ['jid@s.whatsapp.net'], 'promote')  // Make admin
await sock.groupParticipantsUpdate('group-id@g.us', ['jid@s.whatsapp.net'], 'demote')   // Remove admin
```

#### 7. Fetch All Participating Groups

```ts
const groups = await sock.groupFetchAllParticipating()
```

Returns an object with all groups the user is participating in.

#### 8. Manage Invites

- **Get invite code:**

  ```ts
  const code = await sock.groupInviteCode('group-id@g.us')
  ```

- **Revoke invite code:**

  ```ts
  const newCode = await sock.groupRevokeInvite('group-id@g.us')
  ```

- **Accept invite by code:**

  ```ts
  const groupJid = await sock.groupAcceptInvite('code')
  ```

#### 9. Advanced Modes and Settings

- **Enable/disable disappearing messages:**

  ```ts
  await sock.groupToggleEphemeral('group-id@g.us', 86400) // 24h in seconds
  ```

- **Set group to admins only:**

  ```ts
  await sock.groupSettingUpdate('group-id@g.us', 'announcement')
  ```

- **Unlock group for everyone:**

  ```ts
  await sock.groupSettingUpdate('group-id@g.us', 'not_announcement')
  ```

- **Enable/disable join approval:**

  ```ts
  await sock.groupJoinApprovalMode('group-id@g.us', 'on')
  await sock.groupJoinApprovalMode('group-id@g.us', 'off')
  ```

#### 10. Manage Join Requests

- **List pending requests:**

  ```ts
  const requests = await sock.groupRequestParticipantsList('group-id@g.us')
  ```

- **Approve or reject requests:**

  ```ts
  await sock.groupRequestParticipantsUpdate('group-id@g.us', ['jid@s.whatsapp.net'], 'approve')
  await sock.groupRequestParticipantsUpdate('group-id@g.us', ['jid@s.whatsapp.net'], 'reject')
  ```

#### 11. Group-Related Events

- `groups.upsert`: New groups detected.
- `groups.update`: Updates to existing groups.
- `group-participants.update`: Changes in participants (add, remove, promote, etc).
- `group.join-request`: Group join requests.

Example of listening to events:

```ts
sock.ev.on('groups.update', (updates) => {
    updates.forEach(update => console.log('Group updated:', update))
})
```

### Notes

- All methods return Promises and should be used with `await` or `.then()`.
- Methods accept JIDs in WhatsApp's standard format (`@g.us` for groups).
- See the `GroupMetadata` type for details of the returned fields.

## Chat Management

Baileys allows complete management of WhatsApp chats, including creation, editing, archiving, marking as read/unread, managing contacts, labels, and privacy. Below are the main methods and usage examples.

### Main Methods

#### 1. Modify a Chat (mark as read, archive, etc)

```ts
// Mark as read
await sock.chatModify({ markRead: true }, 'chat-jid@s.whatsapp.net')

// Archive
await sock.chatModify({ archive: true }, 'chat-jid@s.whatsapp.net')
```

#### 2. Manage Contacts

```ts
// Add or edit contact
await sock.addOrEditContact('jid@s.whatsapp.net', { notify: 'Contact Name' })

// Remove contact
await sock.removeContact('jid@s.whatsapp.net')
```

#### 3. Update Profile Photo, Name, and Status

```ts
// Update profile photo
await sock.updateProfilePicture('jid@s.whatsapp.net', { url: './Media/cat.jpeg' })

// Remove profile photo
await sock.removeProfilePicture('jid@s.whatsapp.net')

// Update profile name
await sock.updateProfileName('New Name')

// Update profile status
await sock.updateProfileStatus('New status!')
```

#### 4. Manage Labels

```ts
// Add label to a chat
await sock.addChatLabel('jid@s.whatsapp.net', 'label-id')

// Remove label from a chat
await sock.removeChatLabel('jid@s.whatsapp.net', 'label-id')

// Add label to a message
await sock.addMessageLabel('jid@s.whatsapp.net', 'message-id', 'label-id')

// Remove label from a message
await sock.removeMessageLabel('jid@s.whatsapp.net', 'message-id', 'label-id')
```

#### 5. Manage Privacy

```ts
// Update message privacy
await sock.updateMessagesPrivacy('contacts') // or 'everyone', 'nobody'

// Update call privacy
await sock.updateCallPrivacy('contacts')

// Update last seen privacy
await sock.updateLastSeenPrivacy('nobody')

// Update online privacy
await sock.updateOnlinePrivacy('everyone')

// Update profile picture privacy
await sock.updateProfilePicturePrivacy('contacts')

// Update status privacy
await sock.updateStatusPrivacy('contacts')

// Update read receipts privacy
await sock.updateReadReceiptsPrivacy('everyone')

// Update who can add to groups
await sock.updateGroupsAddPrivacy('contacts')
```

#### 6. Manage Disappearing Mode

```ts
// Set default duration for disappearing messages (in seconds)
await sock.updateDefaultDisappearingMode(86400) // 24h
```

#### 7. Fetch Blocked Contacts List

```ts
const blocked = await sock.fetchBlocklist()
```

#### 8. Block or Unblock Contact

```ts
await sock.updateBlockStatus('jid@s.whatsapp.net', 'block')
await sock.updateBlockStatus('jid@s.whatsapp.net', 'unblock')
```

#### 9. Fetch Business Profile

```ts
const profile = await sock.getBusinessProfile('jid@s.whatsapp.net')
```

#### 10. Fetch Status, Bots, and Disappearing Mode

```ts
const status = await sock.fetchStatus('jid@s.whatsapp.net')
const bots = await sock.getBotListV2()
const disappearingMode = await sock.fetchDisappearingDuration('jid@s.whatsapp.net')
```

#### 11. Chat-Related Events

- `chats.upsert`: New chats detected.
- `chats.update`: Updates to existing chats.
- `chats.delete`: Chat deletion.
- `presence.update`: Presence change (online, typing, etc).
- `contacts.upsert`: New contacts.
- `contacts.update`: Contact update.

Example of listening to events:

```ts
sock.ev.on('chats.update', (updates) => {
    updates.forEach(update => console.log('Chat updated:', update))
})
```

### Notes

- All methods return Promises and should be used with `await` or `.then()`.
- Methods accept JIDs in WhatsApp's standard format (`@s.whatsapp.net` for contacts, `@g.us` for groups).
- See the `ChatModification` type and other types in `src/Types` for details of accepted fields.

## Business Messages

Baileys offers full support for managing WhatsApp business resources, such as product catalog, collections, and orders. Below are the main methods available for business accounts:

### Main Methods

#### 1. Fetch Product Catalog

```ts
const catalog = await sock.getCatalog({ jid: 'jid@whatsapp.net', limit: 10, cursor: '...' })
```

Returns the business account's product catalog. Allows pagination via `limit` and `cursor`.

#### 2. Fetch Catalog Collections

```ts
const collections = await sock.getCollections('jid@whatsapp.net', 20)
```

Returns the product collections registered in the business account.

#### 3. Fetch Order Details

```ts
const details = await sock.getOrderDetails('orderId', 'tokenBase64')
```

Returns the details of an order placed in the business catalog.

#### 4. Create Product in Catalog

```ts
const product = await sock.productCreate({
  name: 'Example Product',
  price: 1000, // in cents
  currency: 'BRL',
  ...otherFields
})
```

Creates a new product in the business account's catalog.

#### 5. Edit Product in Catalog

```ts
const editedProduct = await sock.productUpdate('product-id', {
  name: 'New Name',
  price: 2000,
  ...otherFields
})
```

Edits an existing product in the catalog.

#### 6. Delete Product(s) from Catalog

```ts
const result = await sock.productDelete(['product-id-1', 'product-id-2'])
// result.deleted => number of products deleted
```

Removes one or more products from the business catalog.

### Notes

- All methods return Promises and should be used with `await` or `.then()`.
- Methods accept JIDs in WhatsApp's standard format (`@s.whatsapp.net` for business accounts).
- See the `ProductCreate`, `ProductUpdate`, and `GetCatalogOptions` types in `src/Types` for details of accepted fields.

## Data Sync (USync)

USync is the protocol used by Baileys to sync contacts, groups, messages, and other data between devices efficiently and securely. It allows multiple devices to maintain the same state of information, ensuring consistency and real-time updates.

### How USync Works

USync uses specialized queries (USyncQuery) to fetch, update, and sync different types of data. Each USync protocol defines:

- A unique name
- How to build the query
- How to build the query for each user
- How to parse the result

These protocols are implemented via the `USyncQueryProtocol` interface.

#### Example of USyncQueryProtocol Interface

```ts
interface USyncQueryProtocol {
    name: string
    getQueryElement: () => BinaryNode
    getUserElement: (user: USyncUser) => BinaryNode | null
    parser: (data: BinaryNode) => unknown
}
```

### Main Sync Operations

- **Sync contacts:**

  ```ts
  // Example: fetch contact information
  const result = await sock.onWhatsApp('jid@s.whatsapp.net')
  ```

- **Sync status:**

  ```ts
  const status = await sock.fetchStatus('jid@s.whatsapp.net')
  ```

- **Sync disappearing mode:**

  ```ts
  const disappearingMode = await sock.fetchDisappearingDuration('jid@s.whatsapp.net')
  ```

- **Sync groups, chats, and other data:**
  - USync can be used internally to keep groups, chats, and other data synced between devices.

### Notes

- USync is used automatically by Baileys in multi-device operations.
- For advanced use, you can create custom protocols by implementing the `USyncQueryProtocol` interface.
- See the files `src/WAUSync/` and `src/Types/USync.ts` for implementation details and protocol examples.

## Socket Utilities

Baileys Socket utilities are helper functions that facilitate integration, maintenance, and extension of your bot or system. They cover authentication, event handling, credential storage, message/media processing, and session management.

### Main Utilities and Helpers

#### 1. Authentication and Session Persistence

- **useMultiFileAuthState**: Allows saving and restoring authentication state in multiple files, ideal for persistent bots and applications.

  ```ts
  import { useMultiFileAuthState } from 'baileys'
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
  // Pass 'state' to makeWASocket and save credentials on 'creds.update' event
  ```

  > Tip: Always save credentials after any change to avoid session loss.

#### 2. Event Handling and Buffering

- **makeEventBuffer**: Allows grouping socket events for batch processing, useful for sync and performance.
- **captureEventStream / readAndEmitEventStream**: Record and replay event streams for debugging, testing, or scenario replication.

  ```ts
  import { captureEventStream, readAndEmitEventStream } from 'baileys'
  captureEventStream(sock.ev, 'events.log')
  // ... later
  const ev = readAndEmitEventStream('events.log', 100)
  ev.on('messages.upsert', handler)
  ```

#### 3. Message and Media Helpers

- **downloadMediaMessage**: Easily download received media.
- **generateWAMessage / generateWAMessageFromContent**: Generate messages in WhatsApp's accepted format, useful for advanced customizations.
- **processMessage / decodeWAMessage**: Help process and decode received messages.

  ```ts
  import { downloadMediaMessage } from 'baileys'
  const buffer = await downloadMediaMessage(msg, 'buffer', {})
  ```

#### 4. Encryption and Signal Helpers

- **makeSignalRepository / makeLibSignalRepository**: Create custom repositories to store Signal keys, integrating with databases or distributed systems.
- **addTransactionCapability**: Adds transaction support to SignalKeyStore, important for concurrent environments.

#### 5. Cache and Performance Utilities

- **cachedGroupMetadata**: Implement group metadata cache to reduce repeated calls and improve performance.
- **getMessage**: Allows Baileys to fetch old messages from your local storage.

#### 6. General Helpers

- **Browsers**: Allows customizing the user-agent/emulated browser for the socket.
- **delay**: Utility function to wait for a time (useful in async flows).

### Integration Best Practices

- Always handle critical events like `connection.update` and `creds.update` to ensure resilience and persistence.
- Implement cache and persistence for chats, groups, and messages, especially in medium/large bots.
- Use media helpers to handle files efficiently and safely.
- For advanced integrations, use and customize Signal repositories and cache functions.
- Use the event buffer to process large volumes of updates without losing performance.

### Practical Examples

#### Downloading received media

```ts
import { downloadMediaMessage } from 'baileys'
const buffer = await downloadMediaMessage(msg, 'buffer', { })
// Save or process the buffer as needed
```

#### Session persistence

```ts
import { useMultiFileAuthState } from 'baileys'
const { state, saveCreds } = await useMultiFileAuthState('auth')
const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds)
```

#### Group metadata cache

```ts
const sock = makeWASocket({
  cachedGroupMetadata: async (jid) => {
    return await fetchMetadataFromCache(jid)
  }
})
```

#### Event buffering

```ts
import { makeEventBuffer } from 'baileys'
const ev = makeEventBuffer(logger)
ev.buffer()
// ...batch processing
```
