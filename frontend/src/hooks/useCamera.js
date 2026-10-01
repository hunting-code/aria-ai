// Camera preview for the AI Meet lobby and interview room.
//
// Owns one MediaStream and tears it down on unmount - a camera left running
// keeps the hardware light on, which reads as the app spying on you.

import { useCallback, useEffect, useRef, useState } from 'react'

/** 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' */
export default function useCamera({ auto = false } = {}) {
  const [state, setState] = useState('idle')
  const [error, setError] = useState(null)
  const streamRef = useRef(null)
  const videoRef = useRef(null)
  // Guards against a late getUserMedia resolution after unmount.
  const liveRef = useRef(true)

  const attach = useCallback((stream) => {
    streamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      // Autoplay only works muted; the mic is captured separately anyway.
      videoRef.current.muted = true
      videoRef.current.play?.().catch(() => {})
    }
  }, [])

  const start = useCallback(async () => {
    if (streamRef.current) return true
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable')
      setError('This browser cannot access a camera.')
      return false
    }
    setState('requesting')
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      if (!liveRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return false
      }
      attach(stream)
      setState('granted')
      return true
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
      setState(denied ? 'denied' : 'unavailable')
      setError(
        denied
          ? 'Camera access was blocked. Allow it in your browser settings to continue.'
          : 'No camera was found. You can still take the interview with audio only.',
      )
      return false
    }
  }, [attach])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setState('idle')
  }, [])

  // Re-attach when the <video> mounts after the stream was already acquired
  // (the lobby and the meet room each render their own element).
  const setVideoEl = useCallback((el) => {
    videoRef.current = el
    if (el && streamRef.current) {
      el.srcObject = streamRef.current
      el.muted = true
      el.play?.().catch(() => {})
    }
  }, [])

  useEffect(() => {
    liveRef.current = true
    if (auto) start()
    return () => {
      liveRef.current = false
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [auto, start])

  return {
    state,
    error,
    isReady: state === 'granted',
    start,
    stop,
    setVideoEl,
    stream: streamRef.current,
    // Aliases used by the proctoring components, so both call sites can read
    // naturally without one of them having to translate.
    isActive: state === 'granted',
    permissionDenied: state === 'denied',
    startCamera: start,
    stopCamera: stop,
    videoRef,
  }
}
