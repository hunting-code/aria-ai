// Gaze attention from the webcam, via MediaPipe FaceMesh.
//
// This is an attention signal, not a lie detector. It reports where the head
// and eyes are pointing; it cannot tell why. Everything downstream says
// "looking away", never "cheating", and the interview never blocks on it.
//
// The model and WASM load from a CDN. If either is unavailable the hook
// reports 'not_detected' forever and the interview carries on unaffected -
// proctoring must never be the reason someone cannot finish.

import { useCallback, useEffect, useRef, useState } from 'react'

const WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

// 10fps: enough to catch a glance away, a tenth of the CPU of a 60fps loop.
const FRAME_MS = 100
// How long a continuous look away becomes noteworthy.
const SUSPICIOUS_AFTER_MS = 4000
// Head rotation beyond this reads as "not looking at the screen". Derived from
// the horizontal offset of the nose between the ear landmarks.
const YAW_LIMIT = 0.23
const PITCH_LIMIT = 0.20

export const GAZE = {
  ON_SCREEN: 'on_screen',
  LOOKING_AWAY: 'looking_away',
  SUSPICIOUS: 'suspicious',
  NOT_DETECTED: 'not_detected',
}

/**
 * @param videoEl   a playing <video> element, or null
 * @param enabled   false stops all work and releases the model
 */
export default function useEyeTracking(videoEl, { enabled = true } = {}) {
  const [status, setStatus] = useState(GAZE.NOT_DETECTED)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState(null)
  // Cumulative tally for the integrity summary.
  const [stats, setStats] = useState({
    awayCount: 0,
    awayMs: 0,
    suspiciousEvents: 0,
    notDetectedMs: 0,
    samples: 0,
    onScreenSamples: 0,
  })

  const landmarkerRef = useRef(null)
  const rafRef = useRef(null)
  const timerRef = useRef(null)
  const liveRef = useRef(true)
  // When the current away-streak began; null while on screen.
  const awaySinceRef = useRef(null)
  const countedRef = useRef(false)
  const lastTickRef = useRef(0)

  // ---- Load the model once ---------------------------------------------- //
  useEffect(() => {
    if (!enabled) return undefined
    liveRef.current = true
    let cancelled = false

    ;(async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision')
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_CDN)
        const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
        })
        if (cancelled) {
          landmarker.close?.()
          return
        }
        landmarkerRef.current = landmarker
        setIsReady(true)
      } catch (err) {
        // Blocked CDN, no WebGL, unsupported browser - all non-fatal.
        if (!cancelled) {
          setError('Attention tracking is unavailable in this browser.')
          setIsReady(false)
        }
      }
    })()

    return () => {
      cancelled = true
      landmarkerRef.current?.close?.()
      landmarkerRef.current = null
    }
  }, [enabled])

  // ---- Sample the video at 10fps ---------------------------------------- //
  useEffect(() => {
    if (!enabled || !isReady || !videoEl) return undefined
    liveRef.current = true

    const classify = (landmarks) => {
      // Landmark indices from FaceMesh's canonical 478-point model.
      const nose = landmarks[1]
      const leftEar = landmarks[234]
      const rightEar = landmarks[454]
      const forehead = landmarks[10]
      const chin = landmarks[152]
      if (!nose || !leftEar || !rightEar || !forehead || !chin) return GAZE.LOOKING_AWAY

      // Yaw: where the nose sits between the ears. Centred is ~0.
      const span = Math.abs(rightEar.x - leftEar.x) || 1
      const yaw = (nose.x - (leftEar.x + rightEar.x) / 2) / span

      // Pitch: nose height between forehead and chin, re-centred on 0.
      const height = Math.abs(chin.y - forehead.y) || 1
      const pitch = (nose.y - (forehead.y + chin.y) / 2) / height

      return Math.abs(yaw) > YAW_LIMIT || Math.abs(pitch) > PITCH_LIMIT
        ? GAZE.LOOKING_AWAY
        : GAZE.ON_SCREEN
    }

    const tick = () => {
      if (!liveRef.current) return
      const now = performance.now()
      const elapsed = now - (lastTickRef.current || now)
      lastTickRef.current = now

      let next = GAZE.NOT_DETECTED
      try {
        if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
          const result = landmarkerRef.current?.detectForVideo(videoEl, now)
          const face = result?.faceLandmarks?.[0]
          next = face?.length ? classify(face) : GAZE.NOT_DETECTED
        }
      } catch {
        next = GAZE.NOT_DETECTED
      }

      const offScreen = next !== GAZE.ON_SCREEN
      if (offScreen) {
        if (awaySinceRef.current === null) {
          awaySinceRef.current = now
          countedRef.current = false
        }
        const awayFor = now - awaySinceRef.current
        // A sustained look away is escalated; a glance is not.
        if (awayFor >= SUSPICIOUS_AFTER_MS && next === GAZE.LOOKING_AWAY) {
          next = GAZE.SUSPICIOUS
          if (!countedRef.current) {
            countedRef.current = true
            setStats((s) => ({ ...s, suspiciousEvents: s.suspiciousEvents + 1 }))
          }
        }
      } else if (awaySinceRef.current !== null) {
        awaySinceRef.current = null
        countedRef.current = false
        setStats((s) => ({ ...s, awayCount: s.awayCount + 1 }))
      }

      setStats((s) => ({
        ...s,
        samples: s.samples + 1,
        onScreenSamples: s.onScreenSamples + (offScreen ? 0 : 1),
        awayMs: s.awayMs + (next === GAZE.NOT_DETECTED ? 0 : offScreen ? elapsed : 0),
        notDetectedMs: s.notDetectedMs + (next === GAZE.NOT_DETECTED ? elapsed : 0),
      }))
      setStatus(next)

      timerRef.current = window.setTimeout(
        () => {
          rafRef.current = requestAnimationFrame(tick)
        },
        FRAME_MS,
      )
    }

    lastTickRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      liveRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [enabled, isReady, videoEl])

  const reset = useCallback(() => {
    awaySinceRef.current = null
    countedRef.current = false
    setStats({
      awayCount: 0,
      awayMs: 0,
      suspiciousEvents: 0,
      notDetectedMs: 0,
      samples: 0,
      onScreenSamples: 0,
    })
    setStatus(GAZE.NOT_DETECTED)
  }, [])

  // Share of sampled time the candidate was facing the screen. Null until
  // there is enough signal for the number to mean anything.
  const attentionRate =
    stats.samples > 20 ? stats.onScreenSamples / stats.samples : null

  return { status, isReady, error, stats, attentionRate, reset }
}
