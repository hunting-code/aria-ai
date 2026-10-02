// Drives one AI Meet: the socket, ARIA's voice, and the candidate's mic.
//
// The turn-taking rule is the whole point. ARIA speaks, and only when her
// speech has actually finished playing does the mic open - otherwise the
// microphone records ARIA through the speakers and the candidate talks over
// their interviewer.

import { useCallback, useEffect, useRef, useState } from 'react'

import useAudio from './useAudio'
import useTTS from './useTTS'
import { getToken } from '../services/api'
import { websocketOrigin } from '../services/websocket'
import { detectFillers } from '../utils/fillerDetector'
import { calculateWpm } from '../utils/scoreCalculator'

// Mirrors AI_MEET_PHASES on the server. Kept here so the progress rail can
// render before the first phase_change frame arrives.
export const MEET_PHASES = [
  { id: 'warmup', name: 'Warm-up', questions: 2 },
  { id: 'background', name: 'Background', questions: 3 },
  { id: 'technical', name: 'Technical', questions: 4 },
  { id: 'behavioral', name: 'Behavioral', questions: 2 },
  { id: 'wrap_up', name: 'Wrap-up', questions: 1 },
]
const TOTAL_QUESTIONS = MEET_PHASES.reduce((n, p) => n + p.questions, 0)

export default function useAIMeet(sessionId, { voiceId = 'nova', enabled = true } = {}) {
  const [phase, setPhase] = useState('warmup')
  const [questionNumber, setQuestionNumber] = useState(0)
  const [phaseQuestionsAnswered, setPhaseQuestionsAnswered] = useState(0)
  const [isAriaSpeaking, setIsAriaSpeaking] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [ariaSubtitles, setAriaSubtitles] = useState('')
  const [transitionMessage, setTransitionMessage] = useState(null)
  const [meetComplete, setMeetComplete] = useState(null)
  const [debriefText, setDebriefText] = useState('')
  const [error, setError] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  // True only once ARIA has actually taken her first turn, so the bottom bar
  // does not claim she is "reviewing" before the interview has begun.
  const [hasSpoken, setHasSpoken] = useState(false)
  const [isFollowUp, setIsFollowUp] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)

  const audio = useAudio()
  const tts = useTTS({ voiceId })
  const { speak, cancel: cancelSpeech } = tts

  const socketRef = useRef(null)
  // deliverTurn changes identity when the voice list loads; the socket effect
  // reads it through this ref so it never re-subscribes.
  const deliverRef = useRef(null)
  // Mirrors questionNumber for the socket handler, which must not re-subscribe.
  const questionNumberRef = useRef(0)
  // Streamed tokens accumulate here; the frame's own `text` wins when present.
  const bufferRef = useRef('')
  const answerStartedAt = useRef(null)
  const liveRef = useRef(true)
  const { startRecording, stopRecording, reset: resetAudio } = audio

  const send = useCallback((payload) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(payload))
    return true
  }, [])

  // ---- ARIA finished a turn: speak it, then open the mic ----------------- //
  const deliverTurn = useCallback(
    async (text, isQuestion) => {
      if (!text) return
      setHasSpoken(true)
      setIsProcessing(false)
      setIsAriaSpeaking(true)
      setAriaSubtitles('')
      const words = text.split(/\s+/).length
      const watchdogMs = Math.max(8000, (words / 2.2) * 1000 + 4000)
      await Promise.race([
        speak(text, { onWord: setAriaSubtitles }),
        new Promise((resolve) => window.setTimeout(resolve, watchdogMs)),
      ])
      if (!liveRef.current) return
      setIsAriaSpeaking(false)
      setAriaSubtitles(text)
      // Only a question hands the floor over. A plain acknowledgement is
      // followed by another server turn, so the mic stays shut.
      if (isQuestion) {
        answerStartedAt.current = Date.now()
        setIsListening(true)
        startRecording().catch(() => {
          setError('The microphone could not be started.')
          setIsListening(false)
        })
      }
    },
    [speak, startRecording],
  )

  deliverRef.current = deliverTurn
  questionNumberRef.current = questionNumber

  // ---- Socket ------------------------------------------------------------ //
  useEffect(() => {
    if (!sessionId || !enabled) return undefined
    liveRef.current = true
    const token = getToken()
    const url = `${websocketOrigin()}/ws/meet/${encodeURIComponent(sessionId)}${
      token ? `?token=${encodeURIComponent(token)}` : ''
    }`
    const socket = new WebSocket(url)
    socketRef.current = socket

    socket.onopen = () => {
      if (!liveRef.current || socketRef.current !== socket) return
      setIsConnected(true)
      // Send on the socket that actually opened. A second `ready` is ignored
      // server-side, so a StrictMode double-mount cannot double-start.
      socket.send(JSON.stringify({ type: 'ready' }))
      setHasStarted(true)
    }

    socket.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (!liveRef.current) return

      // Frame trace. Dev only: in production this would log a candidate's
      // answers to the console. Token frames are summarised, not spammed.
      if (import.meta.env.DEV && msg.type !== 'aria_token') {
        // eslint-disable-next-line no-console
        console.log(
          `%c[meet] ${msg.type}`,
          'color:#D4891A;font-weight:600',
          msg.type === 'aria_complete'
            ? { is_question: msg.is_question, phase: msg.phase, q: msg.question_number }
            : msg.type === 'phase_change'
              ? { from: msg.from, to: msg.to }
              : msg,
        )
      }

      switch (msg.type) {
        case 'aria_speaking':
          // A scripted turn (opening, wrap-up, debrief) carries its full text;
          // a generated one arrives empty and fills via aria_token.
          bufferRef.current = msg.text || ''
          setIsProcessing(!msg.text)
          break

        case 'aria_token':
          bufferRef.current += msg.token
          break

        case 'aria_complete': {
          const text = bufferRef.current.trim()
          bufferRef.current = ''
          if (msg.is_question && msg.question_number !== questionNumberRef.current) {
            setIsFollowUp(false)
          }
          if (msg.phase) setPhase(msg.phase)
          // The server owns the count: a follow-up re-asks the same slot and
          // deliberately does not advance it. Deriving the count here instead
          // would double-count every follow-up.
          if (msg.question_number) setQuestionNumber(msg.question_number)
          deliverRef.current?.(text, Boolean(msg.is_question))
          break
        }

        case 'phase_change':
          setPhase(msg.to)
          setPhaseQuestionsAnswered(0)
          setTransitionMessage(msg.message || null)
          window.setTimeout(
            () => liveRef.current && setTransitionMessage(null),
            4000,
          )
          break

        case 'follow_up':
          // Already delivered as an aria_complete turn; this frame only marks
          // that the same slot is being re-asked, which the counter reflects
          // by not having advanced.
          setIsFollowUp(true)
          break

        case 'meet_complete':
          setMeetComplete(msg)
          setDebriefText(msg.verbal_debrief || '')
          setIsListening(false)
          setIsProcessing(false)
          // The debrief page speaks the text; stop any in-flight speech here.
          cancelSpeech()
          break

        case 'error':
          setError(msg.message || 'The interview hit a problem.')
          setIsProcessing(false)
          setIsListening(false)
          break

        default:
          break
      }
    }

    socket.onerror = () =>
      liveRef.current && setError('Lost the connection to the interview.')
    socket.onclose = () => {
      if (!liveRef.current || socketRef.current !== socket) return
      setIsConnected(false)
    }

    return () => {
      liveRef.current = false
      // Closing while still CONNECTING throws; wait for open, then close.
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener('open', () => socket.close(1000, 'left'))
      } else if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'left')
      }
      socketRef.current = null
    }
    // Intentionally only [sessionId, enabled]: everything else is read through
    // refs so one session keeps one socket for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, enabled])

  // Speech must stop when the component goes away, or ARIA keeps talking.
  useEffect(() => () => cancelSpeech(), [cancelSpeech])

  /** Tell the server we are ready; triggers the opening script. */
  const begin = useCallback(() => {
    if (hasStarted) return
    // Only latch `started` when the frame actually left, so a send that failed
    // against a closing socket can still be retried.
    if (send({ type: 'ready' })) setHasStarted(true)
  }, [hasStarted, send])

  /** Stop recording, transcribe, and submit the answer. */
  const sendAnswer = useCallback(async () => {
    if (!isListening) return
    setIsListening(false)
    setIsProcessing(true)
    // stopRecording can stall on a revoked microphone or a slow upload. Cap it,
    // so a stuck transcription cannot leave the interview on "ARIA is
    // reviewing..." with no way out.
    const result = await Promise.race([
      stopRecording(),
      new Promise((resolve) => window.setTimeout(() => resolve(null), 15000)),
    ])
    const text = (result?.transcript ?? audio.transcript ?? '').trim()

    // Nothing was heard: tell the candidate and hand the mic back rather than
    // submitting silence and letting them wonder what happened.
    if (!text) {
      setError(
        'Could not transcribe that - please try again. Check your microphone is not muted.',
      )
      setIsProcessing(false)
      setIsListening(true)
      answerStartedAt.current = Date.now()
      startRecording().catch(() => {
        setIsListening(false)
        setError('The microphone could not be restarted. Reload to continue.')
      })
      return
    }
    const seconds =
      result?.durationSeconds ??
      (answerStartedAt.current ? (Date.now() - answerStartedAt.current) / 1000 : 0)

    const fillers = detectFillers(text, seconds)
    const ok = send({
      type: 'answer_transcript',
      transcript: text,
      metrics: {
        filler_data: {
          count: fillers.count,
          words: fillers.words,
          per_minute: fillers.perMinute,
        },
        wpm: calculateWpm(text, seconds) || null,
        duration_seconds: seconds,
      },
    })
    if (!ok) {
      setError('Connection lost. Your answer was not submitted.')
      setIsProcessing(false)
      return
    }
    resetAudio()
  }, [isListening, stopRecording, startRecording, audio.transcript, send, resetAudio])

  /** Ask ARIA a question during the wrap-up. */
  const askAria = useCallback(
    (text) => {
      if (!text?.trim()) return
      setIsProcessing(true)
      send({ type: 'candidate_question', text: text.trim() })
    },
    [send],
  )

  /** Move past the current question without answering it. */
  const skipQuestion = useCallback(() => {
    cancelSpeech()
    setIsListening(false)
    setError(null)
    setIsProcessing(true)
    // Discard whatever was captured: it is not being submitted.
    stopRecording().catch(() => {})
    resetAudio()
    if (!send({ type: 'skip_question' })) {
      setError('Connection lost. Could not skip.')
      setIsProcessing(false)
    }
  }, [send, cancelSpeech, stopRecording, resetAudio])

  const endMeet = useCallback(() => {
    cancelSpeech()
    setIsListening(false)
    setIsProcessing(true)
    send({ type: 'end_meet' })
  }, [send, cancelSpeech])

  // A submitted answer that gets no reply within 30s is a dead end: surface it
  // and let the candidate retry, rather than spinning indefinitely.
  useEffect(() => {
    if (!isProcessing) return undefined
    const timer = window.setTimeout(() => {
      setIsProcessing(false)
      setError('ARIA did not respond in time. Your answer was saved - try again.')
    }, 30000)
    return () => window.clearTimeout(timer)
  }, [isProcessing])

  // ---- Progress ---------------------------------------------------------- //
  const phaseIndex = Math.max(0, MEET_PHASES.findIndex((p) => p.id === phase))
  const current = MEET_PHASES[phaseIndex] ?? MEET_PHASES[0]
  const phaseProgress = Math.min(
    1,
    current.questions ? phaseQuestionsAnswered / current.questions : 0,
  )
  const overallProgress = Math.min(1, questionNumber / TOTAL_QUESTIONS)

  return {
    // phase
    phase,
    phaseIndex,
    phaseName: current.name,
    phases: MEET_PHASES,
    phaseProgress,
    overallProgress,
    questionNumber,
    totalQuestions: TOTAL_QUESTIONS,
    transitionMessage,
    // aria
    isAriaSpeaking,
    ariaSubtitles,
    ttsSupported: tts.isSupported,
    // candidate
    isListening,
    isProcessing,
    hasSpoken,
    isFollowUp,
    isTranscribing: audio.isTranscribing,
    liveTranscript: audio.transcript,
    getLevel: audio.getLevel,
    // control
    begin,
    sendAnswer,
    skipQuestion,
    askAria,
    endMeet,
    hasStarted,
    // outcome
    meetComplete,
    debriefText,
    isConnected,
    error,
  }
}
