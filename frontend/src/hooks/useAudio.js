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
import useToast from '../store/toastStore'

const CHUNK_MS = 3000

// Preference order: Opus in WebM is the best supported; Safari needs mp4.
// ---- Live transcription via the browser ---------------------------------- //
// The Web Speech API gives words as they are spoken, with no upload and no
// round trip, which is what makes a live transcript feel live. Groq Whisper
// stays as the fallback for browsers without it (Firefox) or when it errors.
//
// Caveats worth knowing: in Chrome this streams audio to Google's servers, it
// is unavailable in Firefox, and some privacy-hardened browsers block it. All
// three degrade to the Whisper upload path rather than failing.
const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined

export const liveSpeechSupported = Boolean(SpeechRecognition)

// en-IN rather than en-US: this is built for Indian English speakers, and the
// recogniser's language model materially changes accuracy.
const SPEECH_LANG = 'en-IN'

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
  // Words the recogniser has not committed yet. Shown faded and italic.
  const [interimTranscript, setInterimTranscript] = useState('')
  // Whether live recognition actually produced anything this session, so the
  // UI can say which path is in use instead of failing silently.
  const [usingLiveSpeech, setUsingLiveSpeech] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [error, setError] = useState(null)
  // Web Speech recogniser, when the browser has one. `speechTextRef` holds the
  // finalised phrases so an interim result never overwrites settled text.
  const recognitionRef = useRef(null)
  const speechTextRef = useRef('')
  const usingSpeechRef = useRef(false)

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const startedAtRef = useRef(0)
  const tickRef = useRef(null)
  const inFlightRef = useRef(false)
  // One warning per recording: a 60-second answer uploads ~19 times and each
  // one would otherwise raise its own toast.
  const warnedRef = useRef(false)
  const abortRef = useRef(null)
  const mimeRef = useRef(null)
  // Live input level (0..1), read by the waveform through getLevel(). Kept in a
  // ref rather than state: the meter repaints at 60fps and re-rendering the
  // whole interview screen that often would be wasteful.
  const levelRef = useRef(0)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)
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
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    // close() returns a promise; a failure here is not actionable.
    audioCtxRef.current?.close?.().catch(() => {})
    audioCtxRef.current = null
    levelRef.current = 0
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

        // Transcription failing must never stop the recording: the audio is
        // still being captured and the candidate can still type. Warn once and
        // carry on.
        const message = extractErrorMessage(err, 'Could not transcribe your answer.')
        console.warn('Transcription failed:', err?.response?.status, message)

        if (!warnedRef.current) {
          warnedRef.current = true
          useToast
            .getState()
            .warning(
              'Transcription unavailable',
              'Your answer is still being recorded. Use the text input if this persists.',
            )
        }

        if (final) setError(message)
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

    // Start live recognition in parallel with recording. The recorder still
    // runs: it is the fallback if recognition yields nothing, and it is what
    // the Whisper path needs.
    speechTextRef.current = ''
    usingSpeechRef.current = false
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = SPEECH_LANG
        recognition.onresult = (event) => {
          let interim = ''
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const chunk = event.results[i][0]?.transcript ?? ''
            if (event.results[i].isFinal) {
              speechTextRef.current = `${speechTextRef.current} ${chunk}`.trim()
            } else {
              interim += chunk
            }
          }
          usingSpeechRef.current = true
          setUsingLiveSpeech(true)
          setInterimTranscript(interim)
          setLiveTranscript(`${speechTextRef.current} ${interim}`.trim())
        }
        // A recognition failure is not fatal: the Whisper upload still runs on
        // stop, so the answer is never lost because this path misbehaved.
        recognition.onerror = () => {}
        recognition.onend = () => {
          // Chrome ends the session on its own after a pause; restart while the
          // candidate is still recording so a long answer is not truncated.
          if (recorderRef.current?.state === 'recording') {
            try {
              recognition.start()
            } catch {
              /* already starting */
            }
          }
        }
        recognition.start()
        recognitionRef.current = recognition
      } catch {
        recognitionRef.current = null
      }
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
    warnedRef.current = false

    setAudioBlob(null)
    setTranscript('')
    setLiveTranscript('')
    setInterimTranscript('')
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

    // Web Audio meter: RMS of the time-domain buffer, smoothed so the bars
    // ease rather than strobe. Failure here must not stop the recording.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx) {
        const ctx = new Ctx()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.7
        source.connect(analyser)
        audioCtxRef.current = ctx
        analyserRef.current = analyser

        const buffer = new Uint8Array(analyser.fftSize)
        const sample = () => {
          const node = analyserRef.current
          if (!node) return
          node.getByteTimeDomainData(buffer)
          let sum = 0
          for (let i = 0; i < buffer.length; i += 1) {
            const v = (buffer[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buffer.length)
          // Scale up: conversational speech sits well below full deflection.
          const next = Math.min(1, rms * 3.2)
          levelRef.current = levelRef.current * 0.6 + next * 0.4
          rafRef.current = requestAnimationFrame(sample)
        }
        rafRef.current = requestAnimationFrame(sample)
      }
    } catch {
      /* metering is decorative; recording continues without it */
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

    // Wait for the recorder to flush its final buffer before uploading - but
    // never unconditionally. If the microphone is revoked mid-answer, or the OS
    // takes the device, or the tab is throttled, `onstop` never fires and an
    // unbounded await leaves the interview stuck on "ARIA is reviewing..."
    // forever. Two seconds is far longer than a real flush takes.
    const stopped = new Promise((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.stop()
    await Promise.race([
      stopped,
      new Promise((resolve) => window.setTimeout(resolve, 2000)),
    ])

    const elapsed = (Date.now() - startedAtRef.current) / 1000
    setDurationSeconds(Number(elapsed.toFixed(1)))
    setIsRecording(false)
    teardown()

    // Stop live recognition and keep whatever it heard.
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      try {
        recognition.onend = null
        recognition.stop()
      } catch {
        /* already stopped */
      }
    }
    setInterimTranscript('')
    const spokenLive = speechTextRef.current.trim()

    const mimeType = mimeRef.current || 'audio/webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    setAudioBlob(blob)

    // Cancel any partial still in flight so it cannot land after the final one
    // and overwrite the finished transcript with a shorter version.
    abortRef.current?.abort()
    inFlightRef.current = false

    // Live recognition wins when it produced something: it already has the
    // words, so there is no reason to make the candidate wait on an upload.
    // Whisper is still called when it produced nothing, which covers browsers
    // without the API and sessions where recognition silently failed.
    if (spokenLive) {
      setTranscript(spokenLive)
      setLiveTranscript(spokenLive)
      setIsTranscribing(false)
      return {
        blob,
        durationSeconds: Number(elapsed.toFixed(2)),
        transcript: spokenLive,
        transcriptionFailed: false,
        source: 'speech',
      }
    }

    const data = await transcribeSoFar({ final: true })
    // The blob is returned either way: if transcription failed, the caller still
    // has the recording and can decide what to do with it.
    return {
      blob,
      durationSeconds: Number(elapsed.toFixed(2)),
      transcriptionFailed: data === null,
      source: 'whisper',
      ...(data ?? {}),
    }
  }, [teardown, transcribeSoFar])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    try {
      recognitionRef.current?.stop()
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null
    speechTextRef.current = ''
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
    warnedRef.current = false
  }, [teardown])

  /** Current input level, 0..1. Read inside an animation frame. */
  const getLevel = useCallback(() => levelRef.current, [])

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
    // Confirmed text only - excludes whatever is still being recognised.
    finalTranscript: transcript || speechTextRef.current,
    interimTranscript,
    usingLiveSpeech,
    fillerData,
    durationSeconds,
    error,
    isSupported,
    liveSpeechSupported,
    reset,
    getLevel,
  }
}
