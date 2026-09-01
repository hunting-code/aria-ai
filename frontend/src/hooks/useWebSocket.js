// Connects to the interview WebSocket and surfaces its messages.
//
// Reconnects with backoff on an unexpected drop, but never after a policy
// close (1008) - that means the token was rejected or the session is not the
// caller's, and retrying would spin forever.

import { useCallback, useEffect, useRef, useState } from 'react'

import { FATAL_CLOSE_CODES, WS_STATUS, interviewSocketUrl } from '../services/websocket'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 800

export default function useWebSocket(sessionId, { onMessage, enabled = true } = {}) {
  const [status, setStatus] = useState(WS_STATUS.IDLE)
  const [error, setError] = useState(null)

  const socketRef = useRef(null)
  const retriesRef = useRef(0)
  // Reconnect goes through a ref so connect() never references itself while it
  // is still being initialised.
  const connectRef = useRef(null)
  const timerRef = useRef(null)
  const closedByUsRef = useRef(false)
  // Keep the latest handler without making it a dependency of connect(), so a
  // re-render cannot tear down a live socket.
  const handlerRef = useRef(onMessage)
  useEffect(() => {
    handlerRef.current = onMessage
  }, [onMessage])

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const connect = useCallback(() => {
    if (!sessionId || !enabled) return

    clearTimer()
    closedByUsRef.current = false
    setStatus(WS_STATUS.CONNECTING)

    let socket
    try {
      socket = new WebSocket(interviewSocketUrl(sessionId))
    } catch {
      setStatus(WS_STATUS.ERROR)
      setError('Could not open the interview connection.')
      return
    }
    socketRef.current = socket

    socket.onopen = () => {
      retriesRef.current = 0
      setStatus(WS_STATUS.OPEN)
      setError(null)
    }

    socket.onmessage = (event) => {
      let payload
      try {
        payload = JSON.parse(event.data)
      } catch {
        return // the server only ever sends JSON
      }
      handlerRef.current?.(payload)
    }

    socket.onerror = () => {
      // onerror carries no detail by design; onclose decides what happens next.
      setStatus(WS_STATUS.ERROR)
    }

    socket.onclose = (event) => {
      socketRef.current = null
      setStatus(WS_STATUS.CLOSED)

      if (closedByUsRef.current) return

      if (FATAL_CLOSE_CODES.has(event.code)) {
        setError(
          event.reason ||
            'This interview could not be opened. It may have finished already.',
        )
        return
      }

      if (retriesRef.current >= MAX_RETRIES) {
        setError('Lost connection to the interview. Reload to resume.')
        return
      }

      const delay = BASE_DELAY_MS * 2 ** retriesRef.current
      retriesRef.current += 1
      timerRef.current = setTimeout(() => connectRef.current?.(), delay)
    }
  }, [sessionId, enabled])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    // Opening a socket is the canonical "synchronise with an external system"
    // case that the set-state-in-effect rule exempts.
    // oxlint-disable-next-line react/set-state-in-effect
    connect()
    return () => {
      closedByUsRef.current = true
      clearTimer()
      const socket = socketRef.current
      socketRef.current = null
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, 'Leaving')
    }
  }, [connect])

  /** Send a JSON frame. Returns false when the socket is not open. */
  const send = useCallback((payload) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(payload))
    return true
  }, [])

  const close = useCallback(() => {
    closedByUsRef.current = true
    clearTimer()
    socketRef.current?.close(1000, 'Done')
  }, [])

  return { status, error, send, close, isOpen: status === WS_STATUS.OPEN }
}
