// Microphone capture with rolling partial transcription.
//
// Audio is captured as raw PCM through the Web Audio API and encoded to WAV
// here, rather than recorded with MediaRecorder. Two reasons:
//
//   1. Chrome's MediaRecorder only produces WebM/Opus, and Gemini does not
//      accept WebM audio at all.
//   2. Every partial upload is then a complete, self-contained WAV. With
//      MediaRecorder only the first chunk carries the container header, so
//      later fragments are not valid audio on their own.

import { useCallback, useEffect, useRef, useState } from 'react'

import { interviewApi, extractErrorMessage } from '../services/api'
import { detectFillers } from '../utils/fillerDetector'
import { TARGET_SAMPLE_RATE, chunksToWav } from '../utils/wavEncoder'
import useToast from '../store/toastStore'

/** How often a partial transcript is requested while recording. */
const PARTIAL_INTERVAL_MS = 4000

/** Buffer size for the capture node. 4096 frames is ~85ms at 48kHz. */
const CAPTURE_BUFFER = 4096

/**
 * Records an answer and keeps a live transcript updated while the candidate
 * speaks.
 *
 * @returns {{
 *   isRecording: boolean, startRecording: Function, stopRecording: Function,
 *   audioBlob: Blob|null, transcript: string, isTranscribing: boolean,
 *   liveTranscript: string, fillerData: object, durationSeconds: number,
 *   error: string|null, isSupported: boolean, reset: Function, getLevel: Function
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

  // ---- Capture graph ---------------------------------------------------- //
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const sourceRef = useRef(null)
  const processorRef = useRef(null)
  const analyserRef = useRef(null)
  const silentGainRef = useRef(null)

  // Raw Float32 windows, in capture order.
  const pcmRef = useRef([])
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE)

  const startedAtRef = useRef(0)
  const tickRef = useRef(null)
  const partialRef = useRef(null)
  const inFlightRef = useRef(false)
  const abortRef = useRef(null)
  // One warning per recording: a long answer uploads many times and each
  // failure would otherwise raise its own toast.
  const warnedRef = useRef(false)
  // Live input level (0..1), read by the waveform through getLevel(). A ref
  // rather than state: the meter repaints at 60fps and re-rendering the whole
  // interview screen that often would be wasteful.
  const levelRef = useRef(0)
  const rafRef = useRef(null)
  // Guards against setting state after unmount mid-upload.
  const aliveRef = useRef(true)

  const isSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof (window.AudioContext || window.webkitAudioContext) !== 'undefined'

  /** Tear down the capture graph and release the microphone. */
  const teardown = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (partialRef.current) {
      clearInterval(partialRef.current)
      partialRef.current = null
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    silentGainRef.current?.disconnect()
    analyserRef.current?.disconnect?.()
    processorRef.current = null
    sourceRef.current = null
    silentGainRef.current = null
    analyserRef.current = null

    audioCtxRef.current?.close?.().catch(() => {})
    audioCtxRef.current = null

    levelRef.current = 0
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
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
      if (!pcmRef.current.length) return null
      // One request at a time: a slow upload would otherwise queue behind
      // itself as the interval keeps firing.
      if (inFlightRef.current && !final) return null

      inFlightRef.current = true
      abortRef.current = new AbortController()

      // Encoded fresh each time, so the upload is always a complete WAV.
      const blob = chunksToWav(pcmRef.current, sampleRateRef.current)
      const elapsed = (Date.now() - startedAtRef.current) / 1000

      if (final) setIsTranscribing(true)

      try {
        const data = await interviewApi.transcribe({
          blob,
          durationSeconds: Number(elapsed.toFixed(2)),
          filename: 'answer.wav',
          signal: abortRef.current.signal,
        })
        if (!aliveRef.current) return null

        // Replace rather than append: each upload transcribes the whole answer
        // so far, so appending would duplicate everything already said.
        setLiveTranscript(data.transcript || '')
        if (final) setTranscript(data.transcript || '')
        setError(null)
        ;(final ? onFinal : onPartial)?.(data)
        return data
      } catch (err) {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return null
        if (!aliveRef.current) return null

        // Transcription failing must never stop the recording: the audio is
        // still being captured and the candidate can still type.
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
          channelCount: 1,
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

    const Ctx = window.AudioContext || window.webkitAudioContext
    let ctx
    try {
      ctx = new Ctx()
      // Autoplay policies can start the context suspended; without this no
      // audio callbacks fire and the recording is silently empty.
      if (ctx.state === 'suspended') await ctx.resume()
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      setError('Could not start the audio engine.')
      return false
    }

    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.7

    // ScriptProcessorNode is deprecated in favour of AudioWorklet, but it needs
    // no separate module file and is supported everywhere this app runs. The
    // callback only copies samples, so the main-thread cost is negligible.
    const processor = ctx.createScriptProcessor(CAPTURE_BUFFER, 1, 1)
    // A processor must be connected to the destination to receive callbacks,
    // but routing the microphone to the speakers would cause feedback - so it
    // goes through a muted gain node.
    const silent = ctx.createGain()
    silent.gain.value = 0

    pcmRef.current = []
    sampleRateRef.current = ctx.sampleRate

    processor.onaudioprocess = (event) => {
      // The event buffer is reused between callbacks, so this must be a copy.
      pcmRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    }

    source.connect(analyser)
    source.connect(processor)
    processor.connect(silent)
    silent.connect(ctx.destination)

    audioCtxRef.current = ctx
    sourceRef.current = source
    analyserRef.current = analyser
    processorRef.current = processor
    silentGainRef.current = silent
    streamRef.current = stream
    startedAtRef.current = Date.now()
    warnedRef.current = false

    setAudioBlob(null)
    setTranscript('')
    setLiveTranscript('')
    setDurationSeconds(0)
    setIsRecording(true)

    // Level meter: RMS of the time-domain buffer, smoothed so the bars ease
    // rather than strobe.
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
      const next = Math.min(1, Math.sqrt(sum / buffer.length) * 3.2)
      levelRef.current = levelRef.current * 0.6 + next * 0.4
      rafRef.current = requestAnimationFrame(sample)
    }
    rafRef.current = requestAnimationFrame(sample)

    tickRef.current = setInterval(() => {
      setDurationSeconds(Math.round((Date.now() - startedAtRef.current) / 100) / 10)
    }, 200)

    partialRef.current = setInterval(() => {
      transcribeSoFar()
    }, PARTIAL_INTERVAL_MS)

    return true
  }, [isSupported, transcribeSoFar])

  const stopRecording = useCallback(async () => {
    if (!audioCtxRef.current) {
      setIsRecording(false)
      return null
    }

    const elapsed = (Date.now() - startedAtRef.current) / 1000
    const rate = sampleRateRef.current
    const chunks = pcmRef.current

    setDurationSeconds(Number(elapsed.toFixed(1)))
    setIsRecording(false)
    teardown()

    const blob = chunks.length ? chunksToWav(chunks, rate) : null
    setAudioBlob(blob)

    // Cancel any partial still in flight so it cannot land after the final one
    // and overwrite the finished transcript with a shorter version.
    abortRef.current?.abort()
    inFlightRef.current = false

    const data = await transcribeSoFar({ final: true })
    // The blob is returned either way: if transcription failed, the caller
    // still has the recording.
    return {
      blob,
      durationSeconds: Number(elapsed.toFixed(2)),
      transcriptionFailed: data === null,
      ...(data ?? {}),
    }
  }, [teardown, transcribeSoFar])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    teardown()
    pcmRef.current = []
    inFlightRef.current = false
    warnedRef.current = false
    setIsRecording(false)
    setIsTranscribing(false)
    setAudioBlob(null)
    setTranscript('')
    setLiveTranscript('')
    setDurationSeconds(0)
    setError(null)
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
    fillerData,
    durationSeconds,
    error,
    isSupported,
    reset,
    getLevel,
  }
}
