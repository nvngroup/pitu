/// <reference types="node-fetch" />
import type { RequestInit } from 'node-fetch'
declare global {
 type FetchRequestInit = RequestInit & {
  dispatcher?: any
 }
 type FetchHeadersInit = import('node-fetch').HeadersInit
}

export { }
