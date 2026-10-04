// The interview room. Full screen, no app chrome - for 30 minutes this is the
// only thing on screen, the way a real video interview is.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, Loader2, Mic, PhoneOff, Video, X } from 'lucide-react'

import useAIMeet from '../hooks/useAIMeet'
import useAuth from '../hooks/useAuth'
import useCamera from '../hooks/useCamera'
import { Button, cn } from '../components/ui'
import { detectFillers } from '../utils/fillerDetector'
import { sessionsApi } from '../services/api'
import useProctoring, { calculateIntegrityScore } from '../hooks/useProctoring'
import { getProctoringSettings } from '../store/settingsStore'
import TabSwitchWarning from '../components/interview/TabSwitchWarning'
import useEyeTracking, { GAZE } from '../hooks/useEyeTracking'

const MEET_VOICE_KEY = 'aria_meet_voice'

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** ARIA's presence: pulsing while speaking, steady while listening, dots while thinking. */
function AriaAvatar({ speaking, processing }) {
  return (
    <div className="relative grid place-items-center">
      {/* Halo rings only animate while she is actually speaking. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute rounded-full border-2 border-aria-pulse/30',
          speaking ? 'h-56 w-56 animate-ping' : 'h-44 w-44 opacity-40',
        )}
        style={speaking ? { animationDuration: '2.4s' } : undefined}
      />
      <span
        aria-hidden="true"
        className={cn(
          'absolute rounded-full border border-aria-pulse/40 transition-all duration-500',
          speaking ? 'h-48 w-48' : 'h-40 w-40',
        )}
      />
      <div
        className={cn(
          'relative grid h-32 w-32 place-items-center rounded-full bg-aria-gradient transition-all duration-500',
          speaking ? 'scale-105 shadow-glow-lg' : 'shadow-glow',
        )}
      >
        {processing ? (
          <span className="flex gap-1.5" aria-label="ARIA is thinking">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 animate-pulse-dot rounded-full bg-aria-text"
                style={{ animationDelay: `${i * 0.16}s` }}
              />
            ))}
          </span>
        ) : (
          <span className="font-display text-4xl font-bold text-aria-text">A</span>
        )}
      </div>
    </div>
  )
}

export default function AIMeet() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const camera = useCamera({ auto: true })

  const voiceId = (() => {
    try {
      return window.localStorage.getItem(MEET_VOICE_KEY) || 'nova'
    } catch {
      return 'nova'
    }
  })()

  const meet = useAIMeet(sessionId, { voiceId })
  // ---- Proctoring ------------------------------------------------------- //
  // The meet room already shows a full-size camera feed, so gaze is tracked on
  // that element rather than mounting a second CameraMonitor over it.
  const [proctorPrefs] = useState(getProctoringSettings)
  const proctoring = useProctoring({ enabled: proctorPrefs.tabSwitchDetection })
  const gaze = useEyeTracking(camera.videoRef?.current ?? null, {
    enabled: camera.isActive && proctorPrefs.eyeTracking,
  })

  const [elapsed, setElapsed] = useState(0)
  const [fillerToast, setFillerToast] = useState(null)
  // Seconds the candidate has had the floor. Drives the "Done Answering"
  // reveal and the silence nudge, so both run off one clock.
  const [listenSeconds, setListenSeconds] = useState(0)
  // Which completed phase the candidate has opened for review, if any.
  const [openPhase, setOpenPhase] = useState(null)
  const seenFillers = useRef(0)

  // Start the interview as soon as the socket is up.
  useEffect(() => {
    if (meet.isConnected && !meet.hasStarted) meet.begin()
  }, [meet.isConnected, meet.hasStarted, meet])

  // Session clock.
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  // Time since the floor passed to the candidate.
  useEffect(() => {
    if (!meet.listeningSince) {
      setListenSeconds(0)
      return undefined
    }
    setListenSeconds(0)
    const t = window.setInterval(() => {
      setListenSeconds(Math.floor((Date.now() - meet.listeningSince) / 1000))
    }, 500)
    return () => window.clearInterval(t)
  }, [meet.listeningSince])

  // Filler-word nudge: fires once per newly detected filler, clears after 2s.
  useEffect(() => {
    if (!meet.isListening) {
      seenFillers.current = 0
      return
    }
    const found = detectFillers(meet.liveTranscript || '', 0)
    if (found.count > seenFillers.current) {
      const latest = found.words?.[found.words.length - 1]
      seenFillers.current = found.count
      if (latest) setFillerToast(latest)
    }
  }, [meet.liveTranscript, meet.isListening])

  useEffect(() => {
    if (!fillerToast) return undefined
    const t = window.setTimeout(() => setFillerToast(null), 2000)
    return () => window.clearTimeout(t)
  }, [fillerToast])

  // When the server says it is over, go read the debrief.
  useEffect(() => {
    if (meet.meetComplete) {
      // Fire-and-forget: a failed proctoring write must not block the debrief.
      sessionsApi
        .complete(sessionId, {
          proctoring: {
            integrity_score: calculateIntegrityScore({
              switchCount: proctoring.switchCount,
              totalAwayMs: proctoring.totalAwayMs,
              suspiciousEvents: gaze.stats.suspiciousEvents,
              attentionRate: gaze.attentionRate,
            }),
            tab_switches: proctoring.switchCount,
            total_away_ms: proctoring.totalAwayMs,
            suspicious_events: gaze.stats.suspiciousEvents,
            attention_rate: gaze.attentionRate,
            tracking_available: gaze.isReady,
            switches: proctoring.switches,
          },
        })
        .catch(() => {})
      navigate(`/meet/${sessionId}/debrief`, {
        replace: true,
        state: { result: meet.meetComplete },
      })
    }
  }, [meet.meetComplete, navigate, sessionId])

  const handleEnd = () => {
    if (!window.confirm('End the interview now? Your answers so far will be scored.')) return
    meet.endMeet()
  }

  const firstName = (user?.full_name || user?.username || 'You').split(' ')[0]

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-aria-void">
      {/* ---- TOP BAR ---- */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-aria-border bg-aria-base px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 animate-pulse rounded-full bg-aria-red"
            />
            <span className="font-mono text-xs uppercase tracking-wider text-aria-red">
              Recording
            </span>
          </span>
          {meet.questionNumber > 0 ? (
            <span className="hidden font-mono text-xs text-aria-muted sm:inline">
              Question {meet.questionNumber} of {meet.totalQuestions}
              {meet.isFollowUp ? (
                <span className="ml-1.5 text-aria-amber">· follow-up</span>
              ) : null}
            </span>
          ) : null}
        </div>

        {/* Phase rail */}
        <div className="hidden items-center gap-2 sm:flex" aria-label="Interview progress">
          {meet.phases.map((p, i) => {
            const done = i < meet.phaseIndex
            const active = i === meet.phaseIndex
            return (
              <div key={p.id} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => setOpenPhase(openPhase === p.id ? null : p.id)}
                  aria-label={
                    done ? `Review your ${p.name} answers` : `${p.name} phase`
                  }
                  className={cn(
                    'flex flex-col items-center gap-1 rounded px-1 py-0.5',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
                    done ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
                  )}
                >
                  <span
                    className={cn(
                      'h-2.5 w-2.5 rounded-full transition-all duration-300',
                      done && 'bg-aria-green',
                      active && 'scale-125 animate-pulse bg-aria-pulse shadow-glow-sm',
                      !done && !active && 'bg-aria-border',
                    )}
                    aria-current={active ? 'step' : undefined}
                  />
                  <span
                    className={cn(
                      'hidden text-[10px] lg:block',
                      active ? 'text-aria-text' : 'text-aria-muted',
                    )}
                  >
                    {p.name}
                  </span>
                </button>
                {i < meet.phases.length - 1 ? (
                  <span
                    className={cn(
                      'h-px w-5 lg:w-8',
                      done ? 'bg-aria-green/60' : 'bg-aria-border',
                    )}
                  />
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums text-aria-muted">
            {clock(elapsed)}
          </span>
          <Button
            size="sm"
            variant="danger"
            onClick={handleEnd}
            leftIcon={<PhoneOff className="h-3.5 w-3.5" />}
          >
            End
          </Button>
        </div>
      </header>

      {/* A completed phase, opened from its dot. */}
      {openPhase ? (
        <div
          role="dialog"
          aria-label="Phase summary"
          className="absolute inset-x-0 top-14 z-50 mx-auto max-w-2xl animate-fade-in rounded-b-2xl border border-aria-border bg-aria-base p-5 shadow-surface"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-display text-sm font-semibold">
              {meet.phases.find((p) => p.id === openPhase)?.name} — your answers
            </h3>
            <button
              type="button"
              onClick={() => setOpenPhase(null)}
              className="rounded p-1 text-aria-muted hover:text-aria-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse"
              aria-label="Close summary"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {meet.turnHistory.filter((t) => t.phase === openPhase).length ? (
            <ul className="max-h-64 space-y-3 overflow-y-auto">
              {meet.turnHistory
                .filter((t) => t.phase === openPhase)
                .map((t, i) => (
                  <li key={i} className="border-l-2 border-aria-border pl-3">
                    <p className="text-xs font-medium text-aria-muted">
                      {t.question || 'Question'}
                    </p>
                    <p className="mt-1 text-sm text-aria-text">
                      {t.answer || <span className="italic text-aria-muted">Skipped</span>}
                    </p>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-aria-muted">No answers recorded in this phase.</p>
          )}
        </div>
      ) : null}

      {/* ---- STAGE ---- */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* LEFT: ARIA */}
        <section
          aria-label="Interviewer"
          className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-8 p-6 lg:w-[60%] lg:flex-[0_0_60%]"
        >
          {meet.transitionMessage ? (
            <div
              role="status"
              className="absolute top-5 animate-fade-in rounded-full border border-aria-pulse/40 bg-aria-pulse/10 px-4 py-1.5 text-xs font-medium text-aria-pulse"
            >
              {meet.phaseName} · {meet.transitionMessage}
            </div>
          ) : null}

          <AriaAvatar speaking={meet.isAriaSpeaking} processing={meet.isProcessing} />

          {/* Subtitles */}
          <div className="min-h-[5.5rem] w-full max-w-2xl">
            {meet.ariaSubtitles ? (
              <p
                aria-live="polite"
                className="text-center text-lg leading-relaxed text-aria-text"
              >
                {meet.ariaSubtitles}
                {meet.isAriaSpeaking ? (
                  <span className="ml-1 inline-block h-5 w-0.5 animate-pulse bg-aria-pulse align-middle" />
                ) : null}
              </p>
            ) : meet.isProcessing ? (
              <p className="text-center text-sm text-aria-muted">
                ARIA is thinking…
              </p>
            ) : null}
          </div>

          {/* When live recognition is unavailable - Brave blocks it, Firefox has
              none - the answer still works via upload, but only after you stop
              speaking. Saying so turns "nothing is happening" into a known
              trade-off. */}
          {meet.isListening && !meet.liveSpeechSupported ? (
            <p className="w-full max-w-2xl rounded-lg border border-aria-amber/40 bg-aria-amber/10 px-3 py-2 text-xs text-aria-amber">
              Live transcription is not available in this browser, so your words
              appear after you finish. Chrome or Edge shows them as you speak.
            </p>
          ) : null}

          {/* Live transcript while the candidate speaks: confirmed words solid,
              words still being recognised faded. Without this they cannot tell
              whether anything is being picked up at all. */}
          {meet.isListening ? (
            <div className="min-h-[3.5rem] w-full max-w-2xl rounded-xl border border-aria-border bg-aria-surface/60 p-3">
              {meet.liveTranscript || meet.interimTranscript ? (
                <p className="text-sm leading-relaxed text-aria-text">
                  {meet.finalTranscript}
                  {meet.interimTranscript ? (
                    <span className="italic text-aria-text/60">
                      {' '}
                      {meet.interimTranscript}
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="text-sm text-aria-muted">Listening…</p>
              )}
            </div>
          ) : null}

          {meet.lastHeard && !meet.isListening ? (
            <div className="w-full max-w-2xl rounded-xl border border-aria-border bg-aria-surface/60 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-aria-muted">
                We heard
              </p>
              <p className="mt-1 text-sm leading-relaxed text-aria-text">
                {meet.lastHeard}
              </p>
            </div>
          ) : null}

          {meet.error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-aria-red/40 bg-aria-red/10 p-3 text-sm text-aria-red"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{meet.error}</span>
            </div>
          ) : null}
        </section>

        {/* RIGHT: candidate */}
        <section
          aria-label="You"
          className="relative min-h-[14rem] shrink-0 border-t border-aria-border bg-black lg:min-h-0 lg:w-[40%] lg:flex-[0_0_40%] lg:border-l lg:border-t-0"
        >
          <video
            ref={camera.setVideoEl}
            autoPlay
            playsInline
            muted
            className="h-full w-full -scale-x-100 object-cover"
          />
          {!camera.isReady ? (
            <div className="absolute inset-0 grid place-items-center bg-aria-surface/90">
              <div className="text-center">
                <Video className="mx-auto h-7 w-7 text-aria-muted" aria-hidden="true" />
                <p className="mt-2 text-xs text-aria-muted">
                  {camera.error || 'Camera off'}
                </p>
              </div>
            </div>
          ) : null}

          {/* Gaze indicator: green while the mic is open, i.e. while it matters. */}
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 backdrop-blur-sm">
            <span
              aria-hidden="true"
              className={cn(
                'h-2 w-2 rounded-full',
                gaze.status === GAZE.ON_SCREEN
                  ? 'animate-pulse bg-aria-green'
                  : gaze.status === GAZE.SUSPICIOUS
                    ? 'animate-pulse bg-aria-red'
                    : gaze.status === GAZE.LOOKING_AWAY
                      ? 'bg-aria-amber'
                      : 'bg-white/35',
              )}
            />
            <span className="font-mono text-[10px] text-white/70">
              {gaze.status === GAZE.ON_SCREEN
                ? 'eye contact'
                : gaze.status === GAZE.LOOKING_AWAY
                  ? 'looking away'
                  : gaze.status === GAZE.SUSPICIOUS
                    ? 'away a while'
                    : meet.isListening
                      ? 'listening'
                      : 'idle'}
            </span>
          </div>

          <span className="absolute bottom-3 left-3 rounded-md bg-black/55 px-2.5 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
            {firstName}
          </span>

          {fillerToast ? (
            <div
              role="status"
              className="absolute bottom-3 right-3 animate-fade-in rounded-lg border border-aria-amber/50 bg-aria-amber/20 px-3 py-1.5 text-xs font-medium text-aria-amber backdrop-blur-sm"
            >
              filler: “{fillerToast}”
            </div>
          ) : null}
        </section>
      </main>

      <TabSwitchWarning
        event={proctoring.lastReturn}
        count={proctoring.switchCount}
        level={proctoring.level}
        onResume={proctoring.acknowledge}
      />

      {/* ---- BOTTOM BAR: three states ---- */}
      <footer className="flex h-24 shrink-0 items-center justify-center border-t border-aria-border bg-aria-base px-4 sm:px-6">
        {meet.isAriaSpeaking ? (
          <div className="flex items-center gap-3" aria-live="polite">
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-pulse rounded-full bg-aria-blue"
            />
            <span className="text-sm text-aria-muted">ARIA is speaking…</span>
            <span className="ml-2 rounded-md border border-aria-border px-2 py-1 text-[11px] text-aria-muted">
              mic off
            </span>
            <button
              type="button"
              onClick={meet.skipQuestion}
              className="ml-3 rounded px-1 text-xs text-aria-muted underline-offset-4 transition-colors hover:text-aria-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse"
            >
              Skip and continue →
            </button>
          </div>
        ) : meet.isListening ? (
          <div className="flex w-full max-w-2xl items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 animate-pulse rounded-full bg-aria-red"
                />
                <span className="text-sm font-medium text-aria-text">
                  Your turn — speak now
                </span>
              </span>
              {/* A nudge, not an auto-submit: silence may just be thinking. */}
              {listenSeconds >= 8 && !meet.liveTranscript ? (
                <span className="text-xs text-aria-amber">
                  Still there? Click Done Answering when ready.
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={meet.sendAnswer}
              aria-label="Done answering"
              className={cn(
                'grid h-16 w-16 place-items-center rounded-full border-2 border-aria-red bg-aria-red/20 text-aria-red',
                'animate-pulse-glow transition-transform hover:scale-105',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
              )}
            >
              <Mic className="h-7 w-7" aria-hidden="true" />
            </button>
            <div className="flex flex-col items-end gap-1.5">
              {/* Held back briefly so it is not fired before a word is said. */}
            {listenSeconds >= 3 ? (
              <Button onClick={meet.sendAnswer}>Done Answering</Button>
            ) : (
              <Button disabled>Done Answering</Button>
            )}
              <button
                type="button"
                onClick={meet.skipQuestion}
                className="rounded px-1 text-xs text-aria-muted underline-offset-4 transition-colors hover:text-aria-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse"
              >
                Skip and continue →
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-aria-muted" aria-hidden="true" />
            <span className="text-sm text-aria-muted">
              {meet.isTranscribing
                ? 'Transcribing your answer…'
                : meet.hasSpoken
                  ? 'ARIA is reviewing…'
                  : 'Connecting to your interview…'}
            </span>
            {meet.hasSpoken ? (
              <button
                type="button"
                onClick={meet.skipQuestion}
                className="ml-3 rounded px-1 text-xs text-aria-muted underline-offset-4 transition-colors hover:text-aria-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse"
              >
                Skip and continue →
              </button>
            ) : null}
          </div>
        )}
      </footer>
    </div>
  )
}
