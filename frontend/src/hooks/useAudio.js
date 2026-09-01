// Microphone capture with rolling partial transcription.
//
// A note on chunking: MediaRecorder writes the container header into the FIRST
// blob only. Chunks 2..n are continuation fragments and are NOT valid audio
// files on their own - uploading one alone makes Whisper reject it. So every
// interval we upload the accumulated blob (header + everything so far) and
// REPLACE the live transcript with the result, rather than uploading the latest
// fragment and appending. Same visible behaviour, but the audio is always valid.

import { useCallback, useEffect, useRef, useState } from 'react'

import { interviewApi, extractErrorMessage } from '../services/api'
import { detectFillers } from '../utils/fillerDetector'

const CHUNK_MS = 3000

// Preference order: Opus in WebM is the best supported; Safari needs mp4.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? null
}

const extensionFor = (mimeType = '') => {
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

/**
 * Records an answer and keeps a live transcript updated while the candidate
 * speaks.
 *
 * @returns {{
 *   isRecording: boolean, startRecording: Function, stopRecording: Function,
 *   audioBlob: Blob|null, transcript: string, isTranscribing: boolean,
 *   liveTranscript: string, fillerData: object, durationSeconds: number,
 *   error: string|null, isSupported: boolean, reset: Function
 * }}
 */
export default function useAudio({ onPartial, onFinal } = {}) {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [audioBlob, setAudioBlob] = useState(null)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [transcript, setTranscript] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [error, setError] = useState(null)

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const startedAtRef = useRef(0)
  const tickRef = useRef(null)
  const inFlightRef = useRef(false)
  const abortRef = useRef(null)
  const mimeRef = useRef(null)
  // Guards against setting state after unmount mid-upload.
  const aliveRef = useRef(true)

  const isSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'

  /** Stop tracks and clear timers. Safe to call repeatedly. */
  const teardown = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      abortRef.current?.abort()
      teardown()
    }
  }, [teardown])

  /** Upload everything recorded so far and refresh the live transcript. */
  const transcribeSoFar = useCallback(
    async ({ final = false } = {}) => {
      if (!chunksRef.current.length) return null
      // One request at a time: chunks arrive every 3s and a slow upload would
      // otherwise queue up behind itself.
      if (inFlightRef.current && !final) return null

      inFlightRef.current = true
      abortRef.current = new AbortController()
      const mimeType = mimeRef.current || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const elapsed = (Date.now() - startedAtRef.current) / 1000

      if (final) setIsTranscribing(true)

      try {
        const data = await interviewApi.transcribe({
          blob,
          durationSeconds: Number(elapsed.toFixed(2)),
          filename: `answer.${extensionFor(mimeType)}`,
          signal: abortRef.current.signal,
        })
        if (!aliveRef.current) return null

        // Replace, never append - see the note at the top of the file.
        setLiveTranscript(data.transcript || '')
        if (final) setTranscript(data.transcript || '')
        setError(null)
        ;(final ? onFinal : onPartial)?.(data)
        return data
      } catch (err) {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return null
        if (!aliveRef.current) return null
        // A failed partial is not worth interrupting the recording for; a
        // failed final is, because it is the answer being submitted.
        if (final) setError(extractErrorMessage(err, 'Could not transcribe your answer.'))
        else console.warn('Partial transcription failed:', err?.message)
        return null
      } finally {
        inFlightRef.current = false
        if (final && aliveRef.current) setIsTranscribing(false)
      }
    },
    [onFinal, onPartial],
  )

  const startRecording = useCallback(async () => {
    setError(null)

    if (!isSupported) {
      setError('This browser cannot record audio. Try Chrome, Edge or Safari.')
      return false
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (err) {
      const message =
        err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
          ? 'Microphone access was blocked. Allow it in your browser settings and try again.'
          : err?.name === 'NotFoundError'
            ? 'No microphone was found. Connect one and try again.'
            : err?.name === 'NotReadableError'
              ? 'Your microphone is in use by another application.'
              : 'Could not start recording.'
      setError(message)
      return false
    }

    const mimeType = pickMimeType()
    mimeRef.current = mimeType || 'audio/webm'

    let recorder
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      setError('This browser cannot record in a supported audio format.')
      return false
    }

    chunksRef.current = []
    streamRef.current = stream
    recorderRef.current = recorder
    startedAtRef.current = Date.now()

    setAudioBlob(null)
    setTranscript('')
    setLiveTranscript('')
    setDurationSeconds(0)

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data)
        // Skip the first interval: 3s of audio rarely yields a useful partial
        // and it doubles the cost of every short answer.
        if (chunksRef.current.length > 1) transcribeSoFar()
      }
    }

    recorder.onerror = () => {
      setError('Recording stopped unexpectedly.')
      setIsRecording(false)
      teardown()
    }

    recorder.start(CHUNK_MS)
    setIsRecording(true)

    tickRef.current = setInterval(() => {
      setDurationSeconds(Math.round((Date.now() - startedAtRef.current) / 100) / 10)
    }, 200)

    return true
  }, [isSupported, teardown, transcribeSoFar])

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      setIsRecording(false)
      return null
    }

    // Wait for the recorder to flush its final buffer before uploading.
    const stopped = new Promise((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.stop()
    await stopped

    const elapsed = (Date.now() - startedAtRef.current) / 1000
    setDurationSeconds(Number(elapsed.toFixed(1)))
    setIsRecording(false)
    teardown()

    const mimeType = mimeRef.current || 'audio/webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    setAudioBlob(blob)

    // Cancel any partial still in flight so it cannot land after the final one
    // and overwrite the finished transcript with a shorter version.
    abortRef.current?.abort()
    inFlightRef.current = false

    const data = await transcribeSoFar({ final: true })
    return { blob, durationSeconds: Number(elapsed.toFixed(2)), ...(data ?? {}) }
  }, [teardown, transcribeSoFar])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    teardown()
    chunksRef.current = []
    inFlightRef.current = false
    setIsRecording(false)
    setIsTranscribing(false)
    setAudioBlob(null)
    setTranscript('')
    setLiveTranscript('')
    setDurationSeconds(0)
    setError(null)
  }, [teardown])

  // Live filler feedback, recomputed locally as the transcript grows.
  const fillerData = detectFillers(liveTranscript || transcript, durationSeconds)

  return {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    transcript: transcript || liveTranscript,
    isTranscribing,
    liveTranscript,
    fillerData,
    durationSeconds,
    error,
    isSupported,
    reset,
  }
}
