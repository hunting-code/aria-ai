// The live interview. Full-screen and deliberately sparse: the candidate is
// being timed and recorded, so nothing competes with the question.
//
// Answer flow: record -> stopRecording() returns the final transcript and
// metrics from /interview/transcribe -> the transcript goes over the WebSocket
// as `answer_transcript` -> feedback streams back token by token and the
// answer is persisted server-side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  GraduationCap,
  Keyboard,
  CornerDownRight,
  UserCheck,
  Loader2,
  Mic,
  Square,
  SkipForward,
} from 'lucide-react'

import useAudio from '../hooks/useAudio'
import useWebSocket from '../hooks/useWebSocket'
import { AriaLogo, Button, Card, LoadingSpinner, cn } from '../components/ui'
import LiveWaveform from '../components/interview/LiveWaveform'
import QuestionDisplay from '../components/interview/QuestionDisplay'
import MetricsPanel from '../components/interview/MetricsPanel'
import AnswerHistory from '../components/interview/AnswerHistory'
import { detectFillers, highlightFillers } from '../utils/fillerDetector'
import { sessionsApi } from '../services/api'
import useProctoring, { calculateIntegrityScore } from '../hooks/useProctoring'
import { getProctoringSettings, getSetting } from '../store/settingsStore'
import CameraMonitor from '../components/interview/CameraMonitor'
import TabSwitchWarning from '../components/interview/TabSwitchWarning'
import { calculateConfidence, calculateWpm } from '../utils/scoreCalculator'

const MIN_TYPED_CHARS = 10

// How the model's correctness verdict is shown. "unscored" is deliberately
// absent: the heuristic fallback cannot judge correctness, so it claims nothing.
const VERDICT_STYLES = {
  correct: { label: 'Correct', className: 'border-aria-green/40 bg-aria-green/10 text-aria-green' },
  partially_correct: {
    label: 'Partly right',
    className: 'border-aria-amber/40 bg-aria-amber/10 text-aria-amber',
  },
  incorrect: { label: 'Incorrect', className: 'border-aria-red/40 bg-aria-red/10 text-aria-red' },
  off_topic: {
    label: 'Off topic',
    className: 'border-aria-red/40 bg-aria-red/10 text-aria-red',
  },
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function Interview() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  // ---- Interview state ------------------------------------------------- //
  const [question, setQuestion] = useState('')
  const [questionNum, setQuestionNum] = useState(0)
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [phase, setPhase] = useState('answering') // answering | submitted | complete
  const [history, setHistory] = useState([])
  const [serverError, setServerError] = useState(null)
  // Feedback failures belong in the feedback panel, not the page-level banner:
  // the interview is still usable and the answer can simply be resubmitted.
  const [feedbackError, setFeedbackError] = useState(null)
  const [isThinking, setIsThinking] = useState(false)
  const [verdict, setVerdict] = useState(null)
  // The last *scored* delivery figures, so the panel can honestly say
  // "from your last answer" instead of showing a live value that has been reset.
  const [lastScored, setLastScored] = useState(null)
  const [questionTag, setQuestionTag] = useState(null)
  const [isFollowUp, setIsFollowUp] = useState(false)
  const [coachMode, setCoachMode] = useState(true)

  // ---- Answer input ------------------------------------------------------ //
  const [typedMode, setTypedMode] = useState(false)
  typedModeRef.current = typedMode
  const [typedAnswer, setTypedAnswer] = useState('')
  const [elapsed, setElapsed] = useState(0)


  // ---- Proctoring ------------------------------------------------------- //
  // Signals only: they are recorded on the summary and never alter a score.
  const [proctorPrefs] = useState(getProctoringSettings)
  const proctoring = useProctoring({ enabled: proctorPrefs.tabSwitchDetection })
  const [gazeSignals, setGazeSignals] = useState(null)
  const onGazeSignals = useCallback((s) => setGazeSignals(s), [])

  // Snapshot sent with the completion call.
  const proctoringPayload = useCallback(
    () => ({
      integrity_score: calculateIntegrityScore({
        switchCount: proctoring.switchCount,
        totalAwayMs: proctoring.totalAwayMs,
        suspiciousEvents: gazeSignals?.stats?.suspiciousEvents ?? 0,
        attentionRate: gazeSignals?.attentionRate ?? null,
      }),
      tab_switches: proctoring.switchCount,
      total_away_ms: proctoring.totalAwayMs,
      suspicious_events: gazeSignals?.stats?.suspiciousEvents ?? 0,
      attention_rate: gazeSignals?.attentionRate ?? null,
      tracking_available: Boolean(gazeSignals?.trackingAvailable),
      switches: proctoring.switches,
    }),
    [proctoring.switchCount, proctoring.totalAwayMs, proctoring.switches, gazeSignals],
  )

  // Read inside the socket handler, which must not re-subscribe when these
  // change - refs keep the handler identity stable.
  const typedModeRef = useRef(false)
  const audioRef = useRef(null)
  const transcriptBoxRef = useRef(null)
  const answerStartedAt = useRef(null)

  const audio = useAudio()
  audioRef.current = audio
  // Destructured because it is referenced inside the socket message handler:
  // reset is a stable useCallback, whereas the audio object is a new value on
  // every render and would churn the handler identity.
  const { reset: resetAudio } = audio

  // ---- WebSocket --------------------------------------------------------- //
  const handleMessage = useCallback(
    (msg) => {
      switch (msg.type) {
        case 'question':
          setQuestion(msg.content)
          setQuestionNum(msg.question_num)
          setTotalQuestions(msg.total_questions)
          setQuestionTag(msg.tag ?? null)
          setIsFollowUp(Boolean(msg.is_follow_up))
          if (typeof msg.coach_mode === 'boolean') setCoachMode(msg.coach_mode)
          setFeedback('')
          setPhase('answering')
          // Auto-start the mic if the candidate asked for it in Settings. The
          // small delay lets them read the question before recording begins,
          // and typed mode is left alone - there is nothing to record.
          if (getSetting('autoStartMic') && !typedModeRef.current) {
            window.setTimeout(() => {
              if (!audioRef.current?.isRecording) {
                answerStartedAt.current = Date.now()
                setElapsed(0)
                audioRef.current?.startRecording?.().catch(() => {})
              }
            }, 900)
          }
          setElapsed(0)
          answerStartedAt.current = null
          setVerdict(null)
          setFeedbackError(null)
          setIsThinking(false)
          break

        case 'mode_changed':
          setCoachMode(Boolean(msg.coach_mode))
          break

        case 'thinking':
          setIsThinking(true)
          setFeedback('')
          setFeedbackError(null)
          setVerdict(null)
          break

        case 'feedback_token':
          setIsThinking(false)
          setIsStreaming(true)
          setFeedback((f) => f + msg.token)
          break

        case 'feedback_complete':
          setIsStreaming(false)
          setIsThinking(false)
          setVerdict(msg.scores?.verdict ?? null)
          setLastScored({
            confidence: msg.scores?.confidence_score ?? null,
            answerScore: msg.scores?.answer_score ?? null,
          })
          // When a follow-up is coming the server pushes it straight away, so
          // the answer phase continues rather than offering "Next Question".
          setPhase(msg.follow_up_coming ? 'answering' : 'submitted')
          setHistory((h) => [
            ...h.filter((a) => a.questionNumber !== msg.question_num),
            {
              questionNumber: msg.question_num,
              score: msg.scores?.answer_score ?? null,
              confidence: msg.scores?.confidence_score ?? null,
              tag: msg.question_tag ?? null,
            },
          ])
          if (msg.follow_up_coming) {
            resetAudio()
            setTypedAnswer('')
            setElapsed(0)
          }
          break

        case 'interview_complete':
          setPhase('complete')
          // Fire-and-forget: a failed proctoring write must never block the
          // candidate from reaching their results.
          sessionsApi
            .complete(msg.session_id, { proctoring: proctoringPayload() })
            .catch(() => {})
          setIsStreaming(false)
          setIsThinking(false)
          window.setTimeout(() => {
            navigate(`/analysis/${msg.session_id}`, { replace: true })
          }, 1600)
          break

        case 'error':
          setIsStreaming(false)
          setIsThinking(false)
          if (msg.code === 'feedback_failed') {
            // Recoverable: the question stands and the answer can be given again.
            setFeedbackError(msg.message || 'Feedback could not be generated.')
            setPhase('answering')
          } else {
            setServerError(msg.message)
          }
          break

        default:
          break
      }
    },
    [navigate, resetAudio],
  )

  const { send, isOpen, error: socketError, status } = useWebSocket(sessionId, {
    onMessage: handleMessage,
  })
  // The socket retries with backoff on its own; this only surfaces that it is
  // happening, so a candidate mid-answer knows why nothing is responding.
  const isReconnecting = !isOpen && !socketError && Boolean(question)

  // ---- Timer: ticks every second while an answer is in progress ---------- //
  useEffect(() => {
    if (phase !== 'answering') return undefined
    if (!audio.isRecording && !typedMode) return undefined
    if (answerStartedAt.current === null) answerStartedAt.current = Date.now()

    const timer = setInterval(() => {
      setElapsed((Date.now() - answerStartedAt.current) / 1000)
    }, 1000)
    return () => clearInterval(timer)
  }, [phase, audio.isRecording, typedMode])

  // Keep the live transcript pinned to the newest text.
  useEffect(() => {
    const box = transcriptBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [audio.transcript, typedAnswer])

  // ---- Derived live metrics ---------------------------------------------- //
  const currentText = typedMode ? typedAnswer : audio.transcript
  const wordCount = currentText.trim() ? currentText.trim().split(/\s+/).length : 0

  // Recomputed each render, but the inputs only change on transcript updates
  // and the once-a-second timer tick.
  const liveFillers = useMemo(() => detectFillers(currentText, elapsed), [currentText, elapsed])
  // Pace is a property of speech. A typed answer has no meaningful wpm - the
  // raw figure would be typing speed (2000+ when pasted), which would corrupt
  // both the confidence score and the session's average pace.
  const liveWpm = useMemo(
    () => (typedMode ? 0 : calculateWpm(currentText, elapsed)),
    [typedMode, currentText, elapsed],
  )
  // Null until there are words: the formula returns 80 for an empty answer
  // (no fillers, "unknown pace" penalty only), and showing 80% confidence
  // before the candidate has spoken would be meaningless.
  const liveConfidence = useMemo(
    () => (wordCount ? calculateConfidence(liveFillers.count, liveWpm, wordCount) : null),
    [liveFillers.count, liveWpm, wordCount],
  )

  // Only the confirmed text is marked up: highlighting a word that is still
  // being recognised makes it flicker as the recogniser revises it.
  const settledText = typedMode
    ? typedAnswer
    : (audio.finalTranscript || '')
  const highlighted = useMemo(() => highlightFillers(settledText), [settledText])

  const canSubmit =
    phase === 'answering' &&
    !audio.isRecording &&
    !audio.isTranscribing &&
    isOpen &&
    (typedMode ? typedAnswer.trim().length >= MIN_TYPED_CHARS : Boolean(audio.transcript.trim()))

  // ---- Actions ------------------------------------------------------------ //
  const submitAnswer = useCallback(
    (text, durationSeconds, fillerData, wpm) => {
      const ok = send({
        type: 'answer_transcript',
        transcript: text,
        filler_data: {
          count: fillerData.count,
          words: fillerData.words,
          per_minute: fillerData.perMinute,
        },
        wpm,
        duration_seconds: durationSeconds,
      })
      if (!ok) {
        setServerError('Connection lost. Your answer was not submitted.')
        return
      }
      setFeedback('')
      setFeedbackError(null)
      setVerdict(null)
      setIsThinking(true)
      setIsStreaming(true)
    },
    [send],
  )

  const handleMicClick = async () => {
    setServerError(null)
    setFeedbackError(null)
    if (audio.isRecording) {
      const result = await audio.stopRecording()
      const text = result?.transcript ?? audio.transcript
      const duration = result?.durationSeconds ?? elapsed
      if (text?.trim()) {
        submitAnswer(text, duration, detectFillers(text, duration), calculateWpm(text, duration))
      }
      return
    }
    answerStartedAt.current = Date.now()
    setElapsed(0)
    await audio.startRecording()
  }

  const handleTypedSubmit = () => {
    const text = typedAnswer.trim()
    const duration = Math.max(elapsed, 1)
    // wpm is deliberately null: see the note on liveWpm. The server treats a
    // missing pace as unknown rather than as zero.
    submitAnswer(text, duration, detectFillers(text, duration), null)
  }

  const toggleMode = () => {
    const next = !coachMode
    setCoachMode(next)
    send({ type: 'set_mode', coach_mode: next })
  }

  const handleNext = () => {
    audio.reset()
    setTypedAnswer('')
    setElapsed(0)
    send({ type: 'next_question' })
  }

  const handleSkip = () => {
    if (!window.confirm('Skip this question? It will be scored as unanswered.')) return
    audio.reset()
    setTypedAnswer('')
    send({ type: 'next_question' })
  }

  const handleEnd = () => {
    if (!window.confirm('End the interview now? Your answers so far will be scored.')) return
    send({ type: 'end_interview' })
  }

  const isLastQuestion = questionNum > 0 && questionNum >= totalQuestions
  const verdictStyle = verdict ? VERDICT_STYLES[verdict] ?? null : null
  // Live figures are only meaningful while an answer is actually in progress.
  // Before the first word of question 1 there is nothing to report, and the
  // panel must say so rather than showing the formula's empty-input default.
  const isAnswering = wordCount > 0 && phase === 'answering' 
  const error = serverError || socketError || audio.error

  // ---- Connecting ---------------------------------------------------------- //
  if (!question && status !== 'closed' && !socketError) {
    return (
      <div className="grid min-h-screen place-items-center bg-aria-void">
        <div className="flex flex-col items-center gap-4">
          <AriaLogo className="scale-125" />
          <LoadingSpinner size="md" showLabel label="Connecting to your interview" />
        </div>
      </div>
    )
  }

  if (socketError && !question) {
    return (
      <div className="grid min-h-screen place-items-center bg-aria-void px-6">
        <Card padding="lg" className="max-w-md text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-aria-red" aria-hidden="true" />
          <h1 className="mt-4 font-display text-xl font-semibold">
            This interview could not be opened
          </h1>
          <p className="mt-2 text-sm text-aria-muted">{socketError}</p>
          <Button className="mt-6" onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-aria-void">
      {/* ---- Top bar ------------------------------------------------------ */}
      <header className="fixed inset-x-0 top-0 z-[60] h-16 border-b border-aria-border bg-aria-base backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          <AriaLogo className="shrink-0 scale-90" />

          <div className="hidden min-w-0 flex-1 flex-col items-center gap-1 sm:flex">
            <p className="font-mono text-xs text-aria-muted">
              Question {questionNum || '-'} of {totalQuestions || '-'}
            </p>
            <div
              className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-aria-border"
              role="progressbar"
              aria-valuenow={questionNum}
              aria-valuemin={0}
              aria-valuemax={totalQuestions || 1}
              aria-label={`Question ${questionNum} of ${totalQuestions}`}
            >
              <div
                className="h-full rounded-full bg-aria-gradient transition-[width] duration-500 ease-out-expo"
                style={{ width: `${totalQuestions ? (questionNum / totalQuestions) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={toggleMode}
              aria-pressed={coachMode}
              title={
                coachMode
                  ? 'Coach mode: ARIA explains what was missing'
                  : 'Interviewer mode: terse, realistic pressure'
              }
              className={cn(
                'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors sm:inline-flex',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
                coachMode
                  ? 'border-aria-green/40 bg-aria-green/10 text-aria-green'
                  : 'border-aria-blue/40 bg-aria-blue/10 text-aria-pulse',
              )}
            >
              {coachMode ? (
                <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {coachMode ? 'Coach Mode' : 'Interviewer Mode'}
            </button>
            <span
              className={cn(
                'font-mono text-sm tabular-nums',
                audio.isRecording ? 'text-aria-red' : 'text-aria-muted',
              )}
            >
              {formatClock(elapsed)}
            </span>
            <Button size="sm" variant="danger" onClick={handleEnd}>
              End Interview
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-28 pt-20 sm:px-6">
        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-xl border border-aria-red/40 bg-aria-red/10 p-3 text-sm text-aria-red"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {isReconnecting ? (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-aria-amber/40 bg-aria-amber/10 p-3 text-sm text-aria-amber"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-aria-amber" aria-hidden="true" />
            Reconnecting…
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[30%_40%_30%]">
          {/* ---- Left: ARIA ------------------------------------------------ */}
          <section aria-label="Interviewer" className="space-y-4">
            <Card padding="md" glow>
              <div className="mb-3 flex items-center gap-2">
                <span className="font-display text-sm font-bold tracking-tight text-gradient">
                  ARIA
                </span>
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-aria-pulse"
                />
              </div>
              {questionTag || isFollowUp ? (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {isFollowUp ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-aria-amber/40 bg-aria-amber/10 px-2 py-0.5 text-[11px] font-medium text-aria-amber">
                      <CornerDownRight className="h-3 w-3" aria-hidden="true" />
                      Follow-up
                    </span>
                  ) : null}
                  {questionTag ? (
                    <span className="rounded-full border border-aria-border bg-aria-surface/70 px-2 py-0.5 text-[11px] text-aria-muted">
                      {questionTag}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <QuestionDisplay question={question} />
            </Card>

            <Card padding="md">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-aria-muted">
                  Feedback
                </p>
                {verdictStyle ? (
                  <span
                    className={cn(
                      'animate-score-count rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                      verdictStyle.className,
                    )}
                  >
                    {verdictStyle.label}
                  </span>
                ) : null}
              </div>

              {feedbackError ? (
                <div className="flex items-start gap-2 text-sm text-aria-amber">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {feedbackError} Your answer was not lost - submit it again to retry.
                  </span>
                </div>
              ) : feedback ? (
                <p
                  className="whitespace-pre-wrap text-sm leading-relaxed text-aria-text"
                  aria-live="polite"
                >
                  {feedback}
                  {isStreaming ? (
                    <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-aria-pulse align-middle" />
                  ) : null}
                </p>
              ) : isThinking || isStreaming ? (
                <LoadingSpinner size="sm" showLabel label="ARIA is thinking" />
              ) : (
                <p className="text-sm text-aria-muted">Waiting for your answer…</p>
              )}

              {/* The primary way forward sits directly under the feedback the
                  candidate has just read, not only in the fixed bottom bar. */}
              {phase === 'submitted' && !isStreaming ? (
                <Button
                  className="mt-4 w-full"
                  onClick={handleNext}
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                >
                  {isLastQuestion ? 'Finish Interview' : 'Next Question'}
                </Button>
              ) : null}
            </Card>
          </section>

          {/* ---- Centre: the candidate ------------------------------------- */}
          <section aria-label="Your answer" className="space-y-4">
            <Card padding="md">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-aria-muted">
                  {typedMode ? 'Typed answer' : 'Your voice'}
                </p>
                <button
                  type="button"
                  onClick={() => setTypedMode((v) => !v)}
                  disabled={audio.isRecording}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-aria-muted transition-colors hover:bg-black/5 hover:text-aria-text disabled:opacity-40"
                >
                  <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
                  {typedMode ? 'Use microphone' : 'Type instead'}
                </button>
              </div>

              {typedMode ? (
                <textarea
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  placeholder="Type your answer…"
                  rows={7}
                  className="w-full resize-none rounded-lg border border-aria-border bg-aria-surface/70 p-3 text-sm text-aria-text placeholder:text-aria-muted/70 focus:border-aria-blue focus:outline-none focus:ring-2 focus:ring-aria-blue/40"
                />
              ) : (
                <>
                  <LiveWaveform isActive={audio.isRecording} getLevel={audio.getLevel} />

                  <div className="mt-4 flex flex-col items-center">
                    <button
                      type="button"
                      onClick={handleMicClick}
                      disabled={phase !== 'answering' || audio.isTranscribing || !isOpen}
                      aria-label={audio.isRecording ? 'Stop recording and submit' : 'Start recording'}
                      className={cn(
                        // Full-width tap target on a phone, a circle from sm up.
                        'grid h-16 w-full place-items-center rounded-2xl border-2 transition-all duration-200',
                        'sm:h-20 sm:w-20 sm:rounded-full',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse focus-visible:ring-offset-2 focus-visible:ring-offset-aria-void',
                        'disabled:cursor-not-allowed disabled:opacity-40',
                        audio.isRecording
                          ? 'animate-pulse-glow border-aria-red bg-aria-red/20 text-aria-red'
                          : 'border-aria-border bg-aria-surface text-aria-text hover:border-aria-blue hover:bg-aria-blue/10',
                      )}
                    >
                      {audio.isTranscribing ? (
                        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
                      ) : audio.isRecording ? (
                        <Square className="h-6 w-6 fill-current" aria-hidden="true" />
                      ) : (
                        <Mic className="h-8 w-8" aria-hidden="true" />
                      )}
                    </button>
                    <p className="mt-3 text-sm text-aria-muted" aria-live="polite">
                      {audio.isTranscribing
                        ? 'Transcribing your answer…'
                        : audio.isRecording
                          ? 'Recording - tap to stop and submit'
                          : phase === 'submitted'
                            ? 'Answer submitted'
                            : audio.transcript
                              ? 'Tap to add more'
                              : 'Tap to answer'}
                    </p>
                  </div>
                </>
              )}
            </Card>

            <Card padding="md">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-aria-muted">
                Live transcript
              </p>
              <div
                ref={transcriptBoxRef}
                className="max-h-40 overflow-y-auto text-sm leading-relaxed text-aria-text"
              >
                {currentText ? (
                  <p>
                    {/* Confirmed words, with fillers marked. highlightFillers
                        escapes everything it does not mark up, so recognised
                        speech cannot inject markup here. */}
                    <span dangerouslySetInnerHTML={{ __html: highlighted }} />
                    {/* Words still being recognised: faded and italic, so it is
                        obvious they may still change. */}
                    {audio.interimTranscript ? (
                      <span className="italic text-aria-text/60">
                        {' '}
                        {audio.interimTranscript}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-aria-muted">
                    {audio.isRecording && !audio.liveSpeechSupported
                      ? 'Listening… your words will appear once you stop (this browser has no live transcription).'
                      : audio.isRecording
                      ? 'Listening…'
                      : audio.isTranscribing
                        ? 'Transcribing…'
                        : 'Your words will appear here.'}
                  </p>
                )}
              </div>
            </Card>
          </section>

          {/* ---- Right: live metrics --------------------------------------- */}
          {/* Metrics collapse to a horizontal rail on small screens rather than
              pushing the transcript off the bottom of the page. */}
          <section aria-label="Live metrics" className="space-y-4">
            <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 scroll-touch lg:mx-0 lg:block lg:overflow-visible lg:px-0 lg:pb-0">
              <div className="min-w-[15rem] flex-1 snap-start lg:min-w-0">
            <MetricsPanel
              confidence={isAnswering ? liveConfidence : lastScored?.confidence ?? null}
              wpm={isAnswering ? liveWpm : null}
              fillerData={liveFillers}
              isLive={audio.isRecording}
              hasScored={Boolean(lastScored)}
            />
              </div>
              <div className="min-w-[15rem] flex-1 snap-start lg:mt-4 lg:min-w-0">
                <Card padding="md">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wider text-aria-muted">
                    Previous answers
                  </p>
                  <AnswerHistory answers={history} />
                </Card>
              </div>
            </div>
          </section>
        </div>
      </main>

      <CameraMonitor enabled={proctorPrefs.cameraMonitoring} onSignals={onGazeSignals} />
      <TabSwitchWarning
        event={proctoring.lastReturn}
        count={proctoring.switchCount}
        level={proctoring.level}
        onResume={proctoring.acknowledge}
      />

      {/* ---- Completion ------------------------------------------------------ */}
      {phase === 'complete' ? (
        <div
          role="status"
          aria-live="assertive"
          className="fixed inset-0 z-[60] grid place-items-center bg-aria-void/90 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-aria-green" aria-hidden="true" />
            <h2 className="font-display text-2xl font-semibold">Interview complete</h2>
            <p className="text-sm text-aria-muted">Scoring your answers…</p>
            <LoadingSpinner size="sm" />
          </div>
        </div>
      ) : null}

      {/* ---- Bottom bar ---------------------------------------------------- */}
      <footer className="fixed inset-x-0 bottom-0 z-[60] border-t border-aria-border bg-aria-base/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            onClick={handleSkip}
            disabled={phase !== 'answering' || audio.isRecording}
            leftIcon={<SkipForward className="h-4 w-4" />}
          >
            Skip Question
          </Button>

          {phase === 'submitted' ? (
            <Button
              size="lg"
              onClick={handleNext}
              isLoading={isStreaming}
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              {isLastQuestion ? 'Finish Interview' : 'Next Question'}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={typedMode ? handleTypedSubmit : handleMicClick}
              disabled={!canSubmit && !audio.isRecording}
              isLoading={audio.isTranscribing || isStreaming}
              loadingLabel="Submitting your answer"
            >
              {audio.isRecording ? 'Stop & Submit' : 'Submit Answer'}
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
