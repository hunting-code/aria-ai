// The closing. ARIA reads her assessment aloud while the report is assembled -
// the same thing a real interviewer does before you leave the room.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Check, Loader2, Pause, Play } from 'lucide-react'

import useTTS from '../hooks/useTTS'
import { sessionsApi } from '../services/api'
import { Button, Card, ScoreRing, cn } from '../components/ui'

const MEET_VOICE_KEY = 'aria_meet_voice'

const STAGES = [
  { id: 'scoring', label: 'Scoring answers' },
  { id: 'communication', label: 'Analysing communication' },
  { id: 'report', label: 'Building career report' },
]

export default function MeetDebrief() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // The meet room hands the result over directly; a refresh refetches it.
  const [result, setResult] = useState(location.state?.result ?? null)
  const [session, setSession] = useState(null)
  const [stage, setStage] = useState(0)
  const [reportReady, setReportReady] = useState(false)
  const [audioDone, setAudioDone] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [error, setError] = useState(null)

  const voiceId = (() => {
    try {
      return window.localStorage.getItem(MEET_VOICE_KEY) || 'nova'
    } catch {
      return 'nova'
    }
  })()
  const tts = useTTS({ voiceId })
  const { speak, cancel } = tts
  const spokenRef = useRef(false)

  const debrief = result?.verbal_debrief || session?.verbal_debrief || ''
  const phaseScores = result?.phase_scores || session?.phase_scores || {}
  const overall =
    result?.summary?.overall_score ?? session?.overall_score ?? null

  // ---- Fetch the finished session (and poll briefly if it is still writing) //
  useEffect(() => {
    let live = true
    let attempts = 0
    const load = async () => {
      try {
        const data = await sessionsApi.get(sessionId, { force: true })
        if (!live) return
        setSession(data)
        if (data?.verbal_debrief && data?.career_guidance) {
          setReportReady(true)
          return
        }
        // The socket writes these at completion; give it a moment.
        attempts += 1
        if (attempts < 8) window.setTimeout(load, 1500)
        else setReportReady(true)
      } catch (err) {
        if (!live) return
        attempts += 1
        if (attempts < 5) window.setTimeout(load, 2000)
        else {
          setError('The report could not be loaded.')
          setReportReady(true)
        }
      }
    }
    load()
    return () => {
      live = false
    }
  }, [sessionId])

  // ---- Walk the progress stages while the debrief plays ------------------ //
  useEffect(() => {
    if (reportReady) {
      setStage(STAGES.length)
      return undefined
    }
    const t = window.setInterval(
      () => setStage((s) => Math.min(STAGES.length - 1, s + 1)),
      2200,
    )
    return () => window.clearInterval(t)
  }, [reportReady])

  // ---- Speak the debrief once, when it arrives --------------------------- //
  // A watchdog races the utterance: if speech synthesis never fires `onend`
  // (muted tab, no installed voices, a browser bug) the promise never settles,
  // and without this the candidate would be stuck on a disabled button with no
  // way forward. The cap is a generous read-aloud estimate of the text.
  useEffect(() => {
    if (!debrief || spokenRef.current) return undefined
    spokenRef.current = true
    const words = debrief.split(/\s+/).length
    const capMs = Math.max(15000, (words / 2.2) * 1000 + 6000)
    const timer = window.setTimeout(() => setAudioDone(true), capMs)
    // Shorter probe for the common silent case: if nothing is actually being
    // spoken a couple of seconds in, there is no audio to wait for and the
    // full read-aloud cap would strand the candidate on a disabled button.
    const probe = window.setTimeout(() => {
      const speaking =
        window.speechSynthesis?.speaking || window.speechSynthesis?.pending
      if (!speaking) setAudioDone(true)
    }, 2500)
    speak(debrief).then(() => {
      window.clearTimeout(timer)
      window.clearTimeout(probe)
      setAudioDone(true)
    })
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(probe)
    }
  }, [debrief, speak])

  useEffect(() => () => cancel(), [cancel])

  const toggle = useCallback(() => {
    if (!tts.isSupported) return
    if (isPaused) {
      window.speechSynthesis.resume()
      setIsPaused(false)
    } else {
      window.speechSynthesis.pause()
      setIsPaused(true)
    }
  }, [isPaused, tts.isSupported])

  const canContinue = reportReady && (audioDone || !tts.isSupported || !debrief)
  const subtitle = tts.spokenText || debrief

  return (
    <div className="min-h-screen bg-aria-void">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <header className="mb-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-aria-blue">
            Interview complete
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            ARIA&apos;s assessment
          </h1>
        </header>

        {/* ---- Avatar + playback ---- */}
        <div className="flex flex-col items-center gap-6">
          <div className="relative grid place-items-center">
            <span
              aria-hidden="true"
              className={cn(
                'absolute rounded-full border-2 border-aria-pulse/30',
                tts.isSpeaking ? 'h-44 w-44 animate-ping' : 'h-36 w-36 opacity-40',
              )}
              style={tts.isSpeaking ? { animationDuration: '2.4s' } : undefined}
            />
            <div
              className={cn(
                'relative grid h-28 w-28 place-items-center rounded-full bg-aria-gradient transition-all duration-500',
                tts.isSpeaking ? 'scale-105 shadow-glow-lg' : 'shadow-glow',
              )}
            >
              <span className="font-display text-3xl font-bold text-aria-text">A</span>
            </div>
          </div>

          {debrief && tts.isSupported ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={toggle}
              leftIcon={
                isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />
              }
            >
              {isPaused ? 'Resume' : 'Pause'}
            </Button>
          ) : null}
        </div>

        {/* ---- Debrief subtitles ---- */}
        <Card padding="lg" glow className="mt-8">
          {subtitle ? (
            <p
              aria-live="polite"
              className="whitespace-pre-wrap text-center text-base leading-relaxed text-aria-text"
            >
              {subtitle}
              {tts.isSpeaking ? (
                <span className="ml-1 inline-block h-5 w-0.5 animate-pulse bg-aria-pulse align-middle" />
              ) : null}
            </p>
          ) : (
            <div className="flex items-center justify-center gap-3 py-6">
              <Loader2 className="h-4 w-4 animate-spin text-aria-muted" aria-hidden="true" />
              <span className="text-sm text-aria-muted">
                Writing your debrief…
              </span>
            </div>
          )}
        </Card>

        {/* ---- Score summary ---- */}
        {overall != null ? (
          <div className="mt-8 flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
            <ScoreRing value={overall} size="md" label="Overall" />
            <div className="grid w-full max-w-md gap-2">
              {Object.entries(phaseScores).map(([phase, data]) =>
                data?.score == null ? null : (
                  <div key={phase} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs capitalize text-aria-muted">
                      {phase.replace('_', ' ')}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-aria-border">
                      <div
                        className="h-full rounded-full bg-aria-gradient transition-[width] duration-1000 ease-out-expo"
                        style={{ width: `${data.score}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-aria-text">
                      {Math.round(data.score)}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        ) : null}

        {/* ---- Progress stages ---- */}
        <div className="mt-10 flex flex-col items-center gap-2.5">
          {STAGES.map((s, i) => {
            const done = reportReady || i < stage
            const active = !reportReady && i === stage
            return (
              <div key={s.id} className="flex items-center gap-2.5 text-sm">
                <span
                  className={cn(
                    'grid h-5 w-5 place-items-center rounded-full transition-colors',
                    done
                      ? 'bg-aria-green/20 text-aria-green'
                      : active
                        ? 'bg-aria-blue/20 text-aria-blue'
                        : 'bg-aria-border/60 text-transparent',
                  )}
                >
                  {done ? (
                    <Check className="h-3 w-3" aria-hidden="true" />
                  ) : active ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-aria-muted/50" />
                  )}
                </span>
                <span className={done || active ? 'text-aria-text' : 'text-aria-muted'}>
                  {s.label}
                </span>
              </div>
            )
          })}
        </div>

        {error ? (
          <p role="alert" className="mt-6 text-center text-sm text-aria-amber">
            {error}
          </p>
        ) : null}

        {/* ---- Continue ---- */}
        <div className="mt-10 flex justify-center">
          <Button
            size="lg"
            disabled={!canContinue}
            isLoading={!reportReady}
            loadingLabel="Preparing your report"
            rightIcon={<ArrowRight className="h-4 w-4" />}
            onClick={() => navigate(`/analysis/${sessionId}`)}
          >
            View Full Analysis
          </Button>
        </div>
        {!canContinue && reportReady ? (
          <p className="mt-3 text-center text-xs text-aria-muted">
            Finishing the debrief…
          </p>
        ) : null}
      </div>
    </div>
  )
}
