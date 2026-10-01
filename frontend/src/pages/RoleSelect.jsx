// Three-step wizard: pick a role, pick a difficulty, run the pre-flight
// checklist. Steps swap in place with a slide transition - no route change, so
// a half-finished setup is never a back-button trap.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Brain,
  Check,
  Code2,
  Headphones,
  Mic,
  MicOff,
  Timer,
  User,
  Users,
  Video,
  Volume2,
  FileCheck2,
  Zap,
} from 'lucide-react'

import useAuth from '../hooks/useAuth'
import useSettings from '../store/settingsStore'
import { resumeApi, sessionsApi, extractErrorMessage } from '../services/api'
import { Button, Card, cn } from '../components/ui'

/* ========================================================================== */
/* Reference data                                                             */
/* ========================================================================== */

// Accent colours are per-card and two of them (purple, pink) sit outside the
// aria palette, so they travel as CSS custom properties rather than Tailwind
// classes - class names cannot be built dynamically at runtime.
const ROLES = [
  {
    value: 'data_analyst',
    title: 'Data Analyst',
    icon: BarChart3,
    accent: '#1A6FD4',
    description: 'SQL, Python, visualization, statistical analysis',
    skills: ['Python', 'SQL', 'Tableau', 'Statistics', 'Machine Learning'],
  },
  {
    value: 'software_engineer',
    title: 'Software Engineer',
    icon: Code2,
    accent: '#A855F7',
    description: 'DSA, system design, OOP, problem solving',
    skills: ['Algorithms', 'System Design', 'OOP', 'Databases', 'APIs'],
  },
  {
    value: 'hr',
    title: 'Human Resources',
    icon: Users,
    accent: '#EC4899',
    description: 'Behavioral, situational, culture fit questions',
    skills: ['Communication', 'Conflict Resolution', 'Hiring', 'Culture', 'Policies'],
  },
  {
    value: 'ai_engineer',
    title: 'AI Engineer',
    icon: Brain,
    accent: '#10B981',
    description: 'ML models, LLMs, deployment, research',
    skills: ['PyTorch', 'Transformers', 'MLOps', 'RAG', 'Fine-tuning'],
  },
]

const DIFFICULTIES = [
  {
    value: 'beginner',
    title: 'Beginner',
    tagline: 'Getting started with interviews',
    questions: 5,
    perAnswer: '60s per answer suggested',
    minutes: 10,
    expect: [
      'Straightforward, single-concept questions',
      'No follow-ups - each answer stands alone',
      'Generous thinking time',
    ],
  },
  {
    value: 'intermediate',
    title: 'Intermediate',
    tagline: 'Solid foundation, needs polish',
    questions: 7,
    perAnswer: '90s per answer suggested',
    minutes: 18,
    expect: [
      'Mixed technical and behavioural questions',
      'Follow-ups are possible',
      'Answers are scored on structure as well as content',
    ],
  },
  {
    value: 'advanced',
    title: 'Advanced',
    tagline: 'Targeting top companies',
    questions: 10,
    perAnswer: '120s per answer suggested',
    minutes: 30,
    expect: [
      'Deep technical probing and real-world scenarios',
      'Follow-ups that challenge your reasoning',
      'Time pressure, as in a real onsite',
    ],
  },
]

const MODES = [
  {
    value: 'practice',
    name: 'Quick Practice',
    tagline: 'Drill questions at your own pace',
    minutes: '10-15 min',
    icon: Zap,
    accent: '#1A6FD4',
    points: [
      'Jump straight into questions',
      'Feedback after every answer',
      'Pause, retry or stop any time',
    ],
  },
  {
    value: 'ai_meet',
    name: 'AI Meet Interview',
    tagline: 'A formal, five-phase interview',
    minutes: '30-35 min',
    icon: Video,
    accent: '#F5A623',
    points: [
      'Warm-up, background, technical, behavioural, wrap-up',
      'Camera on, ARIA speaks her questions aloud',
      'Spoken debrief and a career report at the end',
    ],
  },
]

/** One interview-mode card on step 1. */
function ModeCard({ mode, selected, onSelect }) {
  const Icon = mode.icon
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse focus-visible:ring-offset-2 focus-visible:ring-offset-aria-void',
        selected
          ? 'border-transparent bg-aria-surface shadow-surface'
          : 'border-aria-border bg-aria-surface/60 hover:-translate-y-0.5 hover:border-aria-blue/50',
      )}
      style={selected ? { borderColor: mode.accent } : undefined}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 origin-left transition-transform duration-300"
        style={{
          background: mode.accent,
          transform: selected ? 'scaleX(1)' : 'scaleX(0)',
        }}
      />
      <div className="flex items-start justify-between gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
          style={{ background: `${mode.accent}1A`, color: mode.accent }}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="rounded-full border border-aria-border px-2 py-0.5 font-mono text-[10px] text-aria-muted">
          {mode.minutes}
        </span>
      </div>
      <h3 className="mt-3 font-display text-lg font-semibold text-aria-text">
        {mode.name}
      </h3>
      <p className="mt-0.5 text-sm text-aria-muted">{mode.tagline}</p>
      <ul className="mt-3 space-y-1.5">
        {mode.points.map((point) => (
          <li key={point} className="flex items-start gap-2 text-xs text-aria-muted">
            <Check
              className="mt-0.5 h-3 w-3 shrink-0"
              style={{ color: mode.accent }}
              aria-hidden="true"
            />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}

const STEP_TITLES = [
  'Choose your interview mode',
  'Choose your role',
  'Choose a difficulty',
  'Before you start',
]

/* ========================================================================== */
/* Microphone permission                                                      */
/* ========================================================================== */

/**
 * Tracks microphone access.
 *
 * Deliberately does not prompt on mount: an unexpected permission dialog on
 * page load is hostile, and a denied prompt is sticky. The Permissions API is
 * read passively where available, and the actual request is user-initiated.
 */
function useMicrophone() {
  const [state, setState] = useState('unknown') // unknown | granted | denied | prompt | unsupported | checking
  const [error, setError] = useState(null)
  const streamRef = useRef(null)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!navigator.mediaDevices?.getUserMedia) {
      // Probing browser capabilities is exactly the external-system case the
      // set-state-in-effect rule exempts.
      // oxlint-disable-next-line react/set-state-in-effect
      setState('unsupported')
      return undefined
    }

    // Passive read - never triggers a prompt. Not supported everywhere
    // (notably older Safari), hence the try/catch.
    navigator.permissions
      ?.query({ name: 'microphone' })
      .then((status) => {
        if (cancelled) return
        setState(status.state)
        status.onchange = () => !cancelled && setState(status.state)
      })
      .catch(() => {
        if (!cancelled) setState('prompt')
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Release the microphone when the user leaves this page.
  useEffect(() => stopStream, [stopStream])

  const request = useCallback(async () => {
    setError(null)
    setState('checking')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setState('granted')
      // Hold the stream only long enough to confirm access, then release it so
      // the browser's recording indicator does not stay lit on this screen.
      window.setTimeout(stopStream, 400)
    } catch (err) {
      setState('denied')
      setError(
        err?.name === 'NotFoundError'
          ? 'No microphone was found. Connect one and try again.'
          : 'Microphone access was blocked. Allow it in your browser settings, then re-check.',
      )
    }
  }, [stopStream])

  return { state, error, request }
}

/* ========================================================================== */
/* Pieces                                                                     */
/* ========================================================================== */

function StepIndicator({ step, total }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-aria-pulse">
            Step {step} of {total}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {STEP_TITLES[step - 1]}
          </h1>
        </div>
        <ol className="hidden items-center gap-2 sm:flex" aria-label="Progress">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
            <li key={n} className="flex items-center gap-2">
              <span
                aria-current={n === step ? 'step' : undefined}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-full border font-mono text-xs transition-colors',
                  n < step && 'border-aria-green/50 bg-aria-green/15 text-aria-green',
                  n === step && 'border-aria-pulse bg-aria-pulse/15 text-aria-pulse',
                  n > step && 'border-aria-border text-aria-muted',
                )}
              >
                {n < step ? <Check className="h-4 w-4" aria-hidden="true" /> : n}
                <span className="sr-only">
                  {n < step ? `Step ${n} complete` : n === step ? 'Current step' : `Step ${n}`}
                </span>
              </span>
              {n < total ? (
                <span
                  aria-hidden="true"
                  className={cn('h-px w-6', n < step ? 'bg-aria-green/50' : 'bg-aria-border')}
                />
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {/* Slim bar mirrors the same progress on small screens. */}
      <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-aria-border sm:hidden">
        <div
          className="h-full rounded-full bg-aria-gradient transition-[width] duration-300 ease-out-expo"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    </div>
  )
}

function RoleCard({ role, selected, onSelect }) {
  const { icon: Icon, accent, title, description, skills } = role
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{ '--accent': accent }}
      className={cn(
        'group glass relative overflow-hidden rounded-xl p-5 text-left transition-all duration-200 ease-out-expo',
        'hover:-translate-y-1',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-aria-void',
        selected
          ? 'border-[color:var(--accent)] shadow-[0_0_28px_-4px_var(--accent)]'
          : 'hover:border-[color:var(--accent)] hover:shadow-[0_0_24px_-8px_var(--accent)]',
      )}
    >
      {/* Accent top bar, revealed on selection. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-0 top-0 h-1 transition-opacity duration-200',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
        )}
        style={{ background: accent }}
      />

      {selected ? (
        <span
          aria-hidden="true"
          className="absolute right-4 top-4 grid h-6 w-6 place-items-center rounded-full text-white"
          style={{ background: accent }}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : null}

      <span
        className="mb-4 mt-1 grid h-11 w-11 place-items-center rounded-lg border"
        style={{ borderColor: `${accent}55`, background: `${accent}1A` }}
      >
        <Icon className="h-5 w-5" style={{ color: accent }} aria-hidden="true" />
      </span>

      <h2 className="font-display text-lg font-semibold text-aria-text">{title}</h2>
      <p className="mt-1 text-sm text-aria-muted">{description}</p>

      <ul className="mt-4 flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <li
            key={skill}
            className="rounded-full border border-aria-border bg-aria-surface/60 px-2 py-0.5 text-[11px] text-aria-muted"
          >
            {skill}
          </li>
        ))}
      </ul>
    </button>
  )
}

function DifficultyCard({ level, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'glass relative flex h-full flex-col rounded-xl p-5 text-left transition-all duration-200 ease-out-expo',
        'hover:-translate-y-1 hover:border-aria-blue/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-aria-void',
        selected && 'border-aria-pulse/60 shadow-glow',
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute right-4 top-4 grid h-6 w-6 place-items-center rounded-full bg-aria-pulse text-aria-void"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : null}

      <h2 className="font-display text-lg font-semibold text-aria-text">{level.title}</h2>
      <p className="mt-1 text-sm text-aria-muted">{level.tagline}</p>

      <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <div>
          <dt className="sr-only">Questions</dt>
          <dd className="font-mono font-semibold text-aria-pulse">
            {level.questions}
            <span className="ml-1 font-sans text-xs font-normal text-aria-muted">questions</span>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Estimated duration</dt>
          <dd className="inline-flex items-center gap-1.5 text-aria-muted">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-mono">~{level.minutes} min</span>
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-aria-muted">{level.perAnswer}</p>

      <p className="mt-4 text-xs font-medium uppercase tracking-wider text-aria-muted">
        What to expect
      </p>
      <ul className="mt-2 space-y-1.5">
        {level.expect.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-aria-muted">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aria-green" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}

function ChecklistRow({ icon: Icon, title, children, status, action }) {
  const TONE = {
    ok: 'border-aria-green/40 bg-aria-green/10 text-aria-green',
    bad: 'border-aria-red/40 bg-aria-red/10 text-aria-red',
    idle: 'border-aria-border bg-aria-surface/60 text-aria-muted',
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-aria-border bg-aria-surface/40 p-4 sm:flex-row sm:items-center">
      <span
        className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg border', TONE[status])}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-aria-text">{title}</p>
        <div className="mt-0.5 text-sm text-aria-muted">{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/* ========================================================================== */
/* Page                                                                       */
/* ========================================================================== */

export default function RoleSelect() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const reduceMotion = useReducedMotion()

  const location = useLocation()
  const [step, setStep] = useState(1)
  // 'practice' is the classic drill; 'ai_meet' is the formal phased interview.
  const prefs = useSettings((st) => st.settings)
  const [mode, setMode] = useState(() => prefs.defaultMode)
  const [direction, setDirection] = useState(1) // 1 forward, -1 back
  // The resume page's "Practice This Role" button arrives with a preselection.
  const [role, setRole] = useState(
    () => location.state?.role ?? prefs.defaultRole ?? null,
  )

  // Resume-aware personalization: banner on step 1, specifics under the pick.
  const [resume, setResume] = useState(null)
  useEffect(() => {
    let live = true
    resumeApi
      .myResume()
      .then((data) => live && setResume(data))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const [difficulty, setDifficulty] = useState(() => prefs.defaultDifficulty)

  const [nameConfirmed, setNameConfirmed] = useState(false)
  const [quietConfirmed, setQuietConfirmed] = useState(false)

  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState(null)

  const mic = useMicrophone()
  const displayName = user?.full_name || user?.username || ''

  const go = (next) => {
    setDirection(next > step ? 1 : -1)
    setStep(next)
  }

  const selectedRole = ROLES.find((r) => r.value === role)
  const selectedLevel = DIFFICULTIES.find((d) => d.value === difficulty)

  const readyToStart =
    Boolean(role) && Boolean(difficulty) && nameConfirmed && quietConfirmed && mic.state === 'granted'

  const handleStart = async () => {
    setStartError(null)
    setIsStarting(true)
    try {
      const session = await sessionsApi.create({
        job_role: role,
        difficulty,
        session_type: mode,
        // Linking the resume lets ARIA interview from their real projects.
        resume_id: mode === 'ai_meet' && resume?.id ? resume.id : undefined,
      })
      navigate(
        mode === 'ai_meet' ? `/meet/${session.id}/lobby` : `/interview/${session.id}`,
      )
    } catch (err) {
      setStartError(extractErrorMessage(err, 'Could not start the interview.'))
      setIsStarting(false)
    }
  }

  // Slide horizontally; under reduced motion, cross-fade in place instead.
  const variants = {
    enter: (dir) => ({ x: reduceMotion ? 0 : dir * 40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: reduceMotion ? 0 : dir * -40, opacity: 0 }),
  }

  return (
    <div className="mx-auto max-w-5xl">
      <StepIndicator step={step} total={4} />

      {/* Fixed min-height keeps the footer buttons from jumping between steps. */}
      <div className="relative min-h-[26rem]">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduceMotion ? 0.12 : 0.26, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* ---- Step 1: mode ------------------------------------------ */}
            {step === 1 ? (
              <div>
                {resume ? (
                  <div
                    role="status"
                    className="mb-4 flex items-center gap-2.5 rounded-xl border border-aria-green/40 bg-aria-green/10 p-3 text-sm text-aria-green"
                  >
                    <FileCheck2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      Resume detected - ARIA will personalize your questions based on your
                      experience
                    </span>
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  {MODES.map((m) => (
                    <ModeCard
                      key={m.value}
                      mode={m}
                      selected={mode === m.value}
                      onSelect={() => setMode(m.value)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* ---- Step 2: role ------------------------------------------ */}
            {step === 2 ? (
              <div>
                {resume ? (
                  <div
                    role="status"
                    className="mb-4 flex items-center gap-2.5 rounded-xl border border-aria-green/40 bg-aria-green/10 p-3 text-sm text-aria-green"
                  >
                    <FileCheck2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      Resume detected - ARIA will personalize your questions based on your
                      experience
                    </span>
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  {ROLES.map((r) => (
                    <RoleCard
                      key={r.value}
                      role={r}
                      selected={role === r.value}
                      onSelect={() => setRole(r.value)}
                    />
                  ))}
                </div>
                {resume && role ? (
                  <p className="mt-4 text-sm text-aria-muted">
                    {(() => {
                      const parsed = resume.parsed_data ?? {}
                      const project = parsed.projects?.[0]?.name
                      const skill = parsed.skills?.technical?.[0]
                      const bits = [project, skill].filter(Boolean)
                      const roleTitle = ROLES.find((r) => r.value === role)?.title ?? role
                      return (
                        <>
                          ARIA found <span className="font-semibold text-aria-text">8</span>{' '}
                          questions specific to your{' '}
                          <span className="font-semibold text-aria-text">{roleTitle}</span>{' '}
                          experience.
                          {bits.length
                            ? ` Including questions about ${bits.join(' and ')}.`
                            : ''}
                        </>
                      )
                    })()}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* ---- Step 3: difficulty ------------------------------------ */}
            {step === 3 ? (
              <div className="grid gap-4 lg:grid-cols-3">
                {DIFFICULTIES.map((d) => (
                  <DifficultyCard
                    key={d.value}
                    level={d}
                    selected={difficulty === d.value}
                    onSelect={() => setDifficulty(d.value)}
                  />
                ))}
              </div>
            ) : null}

            {/* ---- Step 4: checklist ------------------------------------- */}
            {step === 4 ? (
              <div className="space-y-4">
                <Card padding="md" glow>
                  <p className="text-sm text-aria-muted">You are about to start</p>
                  <p className="mt-1 font-display text-xl font-semibold">
                    {selectedRole?.title}{' '}
                    <span className="text-aria-muted">·</span>{' '}
                    <span style={{ color: selectedRole?.accent }}>{selectedLevel?.title}</span>
                  </p>
                  <p className="mt-1 text-sm text-aria-muted">
                    {/* An AI Meet always runs its five phases - 12 questions -
                        regardless of the difficulty's practice-mode count. */}
                    {mode === 'ai_meet'
                      ? '5 phases · 12 questions · about 30-35 minutes'
                      : `${selectedLevel?.questions} questions · about ${selectedLevel?.minutes} minutes`}
                  </p>
                  {mode === 'ai_meet' ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-aria-pulse/40 bg-aria-pulse/10 px-2.5 py-1 text-[11px] font-medium text-aria-pulse">
                      <Video className="h-3 w-3" aria-hidden="true" />
                      AI Meet · camera on, ARIA speaks aloud
                    </p>
                  ) : null}
                </Card>

                <ChecklistRow
                  icon={mic.state === 'granted' ? Mic : MicOff}
                  title="Microphone"
                  status={mic.state === 'granted' ? 'ok' : mic.state === 'denied' ? 'bad' : 'idle'}
                  action={
                    mic.state === 'granted' ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={mic.request}
                        isLoading={mic.state === 'checking'}
                      >
                        {mic.state === 'denied' ? 'Re-check' : 'Check microphone'}
                      </Button>
                    )
                  }
                >
                  {mic.state === 'granted' ? (
                    <span className="text-aria-green">Access granted. You are ready to record.</span>
                  ) : mic.state === 'denied' ? (
                    <span className="text-aria-red">{mic.error}</span>
                  ) : mic.state === 'unsupported' ? (
                    <span className="text-aria-red">
                      This browser cannot record audio. Try Chrome, Edge or Safari.
                    </span>
                  ) : (
                    'ARIA needs your microphone to hear and score your answers.'
                  )}
                </ChecklistRow>

                <ChecklistRow
                  icon={quietConfirmed ? Volume2 : Headphones}
                  title="Quiet environment"
                  status={quietConfirmed ? 'ok' : 'idle'}
                >
                  <label className="inline-flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={quietConfirmed}
                      onChange={(e) => setQuietConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-aria-border bg-aria-surface accent-aria-blue"
                    />
                    <span>
                      I am somewhere quiet. Background noise is counted as speech and will skew
                      the pace and filler-word scores.
                    </span>
                  </label>
                </ChecklistRow>

                <ChecklistRow
                  icon={User}
                  title="Your name"
                  status={nameConfirmed ? 'ok' : 'idle'}
                >
                  <label className="inline-flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={nameConfirmed}
                      onChange={(e) => setNameConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-aria-border bg-aria-surface accent-aria-blue"
                    />
                    <span>
                      I will be interviewing as{' '}
                      <strong className="font-medium text-aria-text">{displayName}</strong>. Change
                      it in Settings if that is not right.
                    </span>
                  </label>
                </ChecklistRow>

                {startError ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-aria-red/40 bg-aria-red/10 p-4 text-sm text-aria-red"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{startError}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ---- Footer navigation ------------------------------------------- */}
      <div className="mt-8 flex items-center justify-between gap-4 border-t border-aria-border pt-6">
        <Button
          variant="ghost"
          onClick={() => (step === 1 ? navigate('/dashboard') : go(step - 1))}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          {step === 1 ? 'Cancel' : 'Back'}
        </Button>

        {step < 4 ? (
          <Button
            size="lg"
            onClick={() => go(step + 1)}
            disabled={step === 2 && !role}
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            Continue
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            {!readyToStart ? (
              <p className="hidden text-sm text-aria-muted sm:block">
                Complete the checklist to begin
              </p>
            ) : null}
            <Button
              size="lg"
              onClick={handleStart}
              disabled={!readyToStart}
              isLoading={isStarting}
              loadingLabel="Creating your session"
              className={cn(readyToStart && !isStarting && 'animate-pulse-glow')}
              leftIcon={isStarting ? null : <Mic className="h-4 w-4" />}
            >
              Start Interview
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
