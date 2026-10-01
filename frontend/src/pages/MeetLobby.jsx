// The room before the room. Nobody should discover their camera is off or
// their mic is muted once a formal interview has already started.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle, ArrowRight, Check, FileText, Mic, Video, Volume2, X,
} from 'lucide-react'

import useAuth from '../hooks/useAuth'
import useCamera from '../hooks/useCamera'
import useTTS, { VOICE_OPTIONS } from '../hooks/useTTS'
import { resumeApi } from '../services/api'
import { Button, Card, cn } from '../components/ui'

const MEET_VOICE_KEY = 'aria_meet_voice'

/** Live input level meter, so "mic ready" is something you can see. */
function useMicLevel() {
  const [state, setState] = useState('idle')
  const [level, setLevel] = useState(0)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const ctxRef = useRef(null)

  const start = useCallback(async () => {
    if (streamRef.current) return true
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable')
      return false
    }
    setState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      ctxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i += 1) {
          peak = Math.max(peak, Math.abs(buf[i] - 128) / 128)
        }
        setLevel(peak)
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      setState('granted')
      return true
    } catch (err) {
      setState(err?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
      return false
    }
  }, [])

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ctxRef.current?.close?.().catch(() => {})
      streamRef.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  return { state, level, start, isReady: state === 'granted' }
}

function CheckRow({ ok, warn, label, detail, action, onClick, interactive }) {
  const Icon = ok ? Check : warn ? AlertCircle : X
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border p-3 transition-colors',
        ok
          ? 'border-aria-green/40 bg-aria-green/10'
          : warn
            ? 'border-aria-amber/40 bg-aria-amber/10'
            : 'border-aria-border bg-aria-surface/60',
        interactive && 'cursor-pointer hover:border-aria-blue',
      )}
      onClick={interactive ? onClick : undefined}
      role={interactive ? 'checkbox' : undefined}
      aria-checked={interactive ? ok : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      <span
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-full',
          ok
            ? 'bg-aria-green/20 text-aria-green'
            : warn
              ? 'bg-aria-amber/20 text-aria-amber'
              : 'bg-aria-border/60 text-aria-muted',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-aria-text">{label}</p>
        {detail ? <p className="text-xs text-aria-muted">{detail}</p> : null}
      </div>
      {action}
    </div>
  )
}

export default function MeetLobby() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)

  const camera = useCamera({ auto: true })
  const mic = useMicLevel()
  const [quietConfirmed, setQuietConfirmed] = useState(false)
  const [resume, setResume] = useState(null)
  const [resumeChecked, setResumeChecked] = useState(false)
  const [voiceId, setVoiceId] = useState(() => {
    try {
      return window.localStorage.getItem(MEET_VOICE_KEY) || 'nova'
    } catch {
      return 'nova'
    }
  })
  const [previewing, setPreviewing] = useState(null)
  const tts = useTTS({ voiceId })

  useEffect(() => {
    mic.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let live = true
    resumeApi
      .myResume()
      .then((d) => live && setResume(d))
      .catch(() => {})
      .finally(() => live && setResumeChecked(true))
    return () => {
      live = false
    }
  }, [])

  const chooseVoice = (id) => {
    setVoiceId(id)
    try {
      window.localStorage.setItem(MEET_VOICE_KEY, id)
    } catch {
      /* preference is non-critical */
    }
  }

  const previewVoice = (id) => {
    setPreviewing(id)
    tts.preview(id)
    window.setTimeout(() => setPreviewing(null), 3000)
  }

  const ready = camera.isReady && mic.isReady
  const firstName = (user?.full_name || user?.username || 'there').split(' ')[0]

  return (
    <div className="min-h-screen bg-aria-void">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-aria-blue">
            AI Meet · Interview Room
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            Let&apos;s get you set up, {firstName}.
          </h1>
          <p className="mt-1.5 text-sm text-aria-muted">
            A formal, five-phase interview. Around 30 minutes.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* ---- Camera preview ---- */}
          <Card padding="none" className="overflow-hidden">
            <div className="relative aspect-video w-full bg-black">
              <video
                ref={camera.setVideoEl}
                autoPlay
                playsInline
                muted
                // Mirrored: a preview that does not mirror feels wrong to look at.
                className="h-full w-full -scale-x-100 object-cover"
              />
              {!camera.isReady ? (
                <div className="absolute inset-0 grid place-items-center bg-aria-surface/90 px-6 text-center">
                  <div>
                    <Video className="mx-auto h-8 w-8 text-aria-muted" aria-hidden="true" />
                    <p className="mt-3 text-sm text-aria-text">
                      {camera.state === 'requesting'
                        ? 'Asking for camera access…'
                        : camera.error || 'Camera is off'}
                    </p>
                    {camera.state !== 'requesting' ? (
                      <Button size="sm" className="mt-4" onClick={camera.start}>
                        Enable camera
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Live mic level, overlaid on the preview. */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-lg bg-black/55 px-3 py-2 backdrop-blur-sm">
                <Mic
                  className={cn(
                    'h-4 w-4 shrink-0',
                    mic.isReady ? 'text-aria-green' : 'text-aria-muted',
                  )}
                  aria-hidden="true"
                />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-aria-green transition-[width] duration-75"
                    style={{ width: `${Math.min(100, mic.level * 180)}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-white/70">
                  {mic.isReady ? 'say something' : 'mic off'}
                </span>
              </div>
            </div>
          </Card>

          {/* ---- Checklist + voice ---- */}
          <div className="space-y-5">
            <Card padding="md">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-aria-muted">
                Before we begin
              </p>
              <div className="space-y-2.5">
                <CheckRow
                  ok={camera.isReady}
                  label="Camera ready"
                  detail={camera.isReady ? 'Looking good.' : 'Required to begin.'}
                />
                <CheckRow
                  ok={mic.isReady}
                  label="Microphone ready"
                  detail={
                    mic.isReady ? 'Speak to see the level move.' : 'Required to begin.'
                  }
                />
                <CheckRow
                  ok={quietConfirmed}
                  interactive
                  onClick={() => setQuietConfirmed((v) => !v)}
                  label="I'm in a quiet place"
                  detail="Background noise lowers transcription accuracy."
                />
                <CheckRow
                  ok={Boolean(resume)}
                  warn={resumeChecked && !resume}
                  label={resume ? 'Resume detected' : 'No resume uploaded'}
                  detail={
                    resume
                      ? 'ARIA will ask about your actual projects.'
                      : 'Optional - questions will be role-generic instead.'
                  }
                  action={
                    resumeChecked && !resume ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<FileText className="h-3.5 w-3.5" />}
                        onClick={() => navigate('/resume')}
                      >
                        Upload
                      </Button>
                    ) : null
                  }
                />
              </div>
            </Card>

            <Card padding="md">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-aria-muted">
                ARIA&apos;s voice
              </p>
              <div className="grid grid-cols-2 gap-2">
                {VOICE_OPTIONS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => chooseVoice(v.id)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
                      voiceId === v.id
                        ? 'border-aria-blue bg-aria-blue/10'
                        : 'border-aria-border hover:border-aria-blue/50',
                    )}
                    aria-pressed={voiceId === v.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-aria-text">{v.name}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Preview ${v.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          previewVoice(v.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            previewVoice(v.id)
                          }
                        }}
                        className={cn(
                          'grid h-6 w-6 place-items-center rounded-full transition-colors',
                          previewing === v.id
                            ? 'bg-aria-blue text-white'
                            : 'bg-aria-border/60 text-aria-muted hover:text-aria-text',
                        )}
                      >
                        <Volume2 className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-aria-muted">{v.blurb}</p>
                  </button>
                ))}
              </div>
              {!tts.isSupported ? (
                <p className="mt-3 text-xs text-aria-amber">
                  This browser has no speech synthesis - ARIA&apos;s questions will
                  appear as text only.
                </p>
              ) : null}
            </Card>
          </div>
        </div>

        {/* ---- ARIA's introduction ---- */}
        <Card padding="md" glow className="mt-6">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-aria-gradient font-display text-sm font-bold text-aria-text"
            >
              A
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold text-gradient">ARIA</p>
              <p className="mt-1.5 text-sm leading-relaxed text-aria-text">
                Hi {firstName} — I&apos;ll be conducting your interview today. We&apos;ll
                spend about 30 minutes together across five areas: a short warm-up,
                your background, a technical round, some behavioural questions, and a
                wrap-up where you can ask me anything.{' '}
                {resume
                  ? 'I’ve read your resume, so expect questions about your actual projects.'
                  : 'Answer naturally — there’s no need to rush.'}
              </p>
            </div>
          </div>
        </Card>

        {/* ---- Begin ---- */}
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>
            Cancel
          </Button>
          <div className="flex flex-col items-end gap-1.5">
            <Button
              size="lg"
              disabled={!ready}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              onClick={() => navigate(`/meet/${sessionId}`)}
            >
              Begin Interview
            </Button>
            {!ready ? (
              <p className="text-xs text-aria-muted">
                Camera and microphone are both required.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
