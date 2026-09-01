// WebSocket client for the live interview channel.
//
// The server authenticates the socket from a ?token= query parameter, because
// browsers cannot set headers on a WebSocket handshake.

import { API_BASE_URL, getToken } from './api'

/** ws:// or wss:// origin derived from the REST base URL. */
export function websocketOrigin() {
  try {
    const url = new URL(API_BASE_URL, window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.origin.replace(/^http/, 'ws')
  } catch {
    return API_BASE_URL.replace(/^http/, 'ws')
  }
}

/** Full socket URL for one interview session, with the auth token attached. */
export function interviewSocketUrl(sessionId, token = getToken()) {
  const base = `${websocketOrigin()}/ws/${encodeURIComponent(sessionId)}`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

// Close codes the server uses to reject a connection outright. Retrying these
// would loop forever against an auth or ownership failure.
export const FATAL_CLOSE_CODES = new Set([1008, 1003])

export const WS_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSED: 'closed',
  ERROR: 'error',
}
