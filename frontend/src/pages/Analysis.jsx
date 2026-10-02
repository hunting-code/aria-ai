// Post-interview deep dive: headline scores, the LLM verdict, a per-question
// breakdown, and a comparison against the previous session.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Clock,
  Compass,
  FileText,
  Lightbulb,
  MessagesSquare,
  RefreshCw,
  Repeat,
  Share2,
  Wrench,
} from 'lucide-react'

import { sessionsApi, extractErrorMessage } from '../services/api'
import { Badge, Button, Card, LoadingSpinner, ScoreRing, cn } from '../components/ui'
import FailureDNA from '../components/analysis/FailureDNA'
import RecruiterReplay from '../components/analysis/RecruiterReplay'
import QuestionBreakdown from '../components/interview/QuestionBreakdown'
import FillerAttention from '../components/dashboard/FillerAttention'
import useToast from '../store/toastStore'

const CELEBRATION_THRESHOLD = 70
const STAGGER_S = 0.08

const ROLE_LABELS = {
  data_analyst: 'Data Analyst',
  software_engineer: 'Software Engineer',
  hr: 'Human Resources',
  ai_engineer: 'AI Engineer',
}

const SUGGESTION_CATEGORIES = [
  { category: 'Technical', icon: Wrench, tone: 'text-aria-pulse' },
  { category: 'Communication', icon: MessagesSquare, tone: 'text-aria-green' },
  { category: 'Structure', icon: Lightbulb, tone: 'text-aria-amber' },
]

/** Staggered entrance: elements arrive 0.08s apart, top to bottom. */
const stagger = (index) => ({ animationDelay: `${index * STAGGER_S}s` })

/* -------------------------------------------------------------------------- */
/* Celebration                                                                */
/* -------------------------------------------------------------------------- */

// Fixed particle set so the burst is identical on every render rather than
// re-randomising and re-animating whenever the page updates.
const PARTICLES = Array.from({ length: 28 }, (_, i) => {
  const angle = (i / 28) * Math.PI * 2
  const distance = 90 + ((i * 37) % 70)
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance - 40,
    delay: (i % 7) * 0.06,
    color: ['#F5A623', '#2D7A8C', '#178A5B', '#A855F7'][i % 4],
    size: 4 + (i % 3) * 2,
  }
})

function Celebration({ show }) {
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  )
  // A burst of particles is decorative and exactly what reduced-motion asks to
  // suppress, so it is skipped entirely rather than merely shortened.
  if (!show || reduced) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-visible"
      aria-hidden="true"
    >
      <div className="relative mx-auto h-full w-0">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="absolute left-0 top-16 block rounded-full"
            style={{
              width: p.size,
              height: p.size,
              background: p.color,
              animation: `aria-burst 1.1s cubic-bezier(0.16, 1, 0.3, 1) ${p.delay}s both`,
              '--burst-x': `${p.x}px`,
              '--burst-y': `${p.y}px`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Analysis() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const toastSuccess = useToast((s) => s.success)
  const toastError = useToast((s) => s.error)

  const [session, setSession] = useState(null)
  const [previous, setPrevious] = useState(null)
  const [stats, setStats] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    try {
      let data = await sessionsApi.get(sessionId, { signal })

      // The socket aggregates the numbers when the interview ends but leaves the
      // written verdict to this endpoint, which is idempotent - so asking for it
      // here costs nothing on a revisit.
      if (!data.final_feedback) {
        data = await sessionsApi.complete(sessionId, { signal })
      }
      setSession(data)

      // Find the previous completed session for the comparison chart.
      try {
        setStats(await sessionsApi.stats({ signal }))
      } catch {
        setStats(null)
      }
      const all = await sessionsApi.mySessions({ signal })
      const earlier = all
        .filter(
          (s) =>
            s.id !== sessionId &&
            s.status === 'completed' &&
            typeof s.overall_score === 'number',
        )
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]

      if (earlier) {
        // The list endpoint returns SessionSummary, which carries only
        // overall_score - the other four metrics come back undefined and the
        // comparison line would collapse to a single point. Fetch the full
        // record for the one session actually being charted.
        try {
          setPrevious(await sessionsApi.get(earlier.id, { signal }))
        } catch {
          // A missing comparison is not worth failing the page over.
          setPrevious(null)
        }
      } else {
        setPrevious(null)
      }
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
      setError(extractErrorMessage(err, 'Could not load your results.'))
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const feedback = session?.final_feedback ?? {}
  const answers = useMemo(
    () => [...(session?.answers ?? [])].sort((a, b) => a.question_number - b.question_number),
    [session],
  )

  const comparison = useMemo(() => {
    if (!session || !previous) return null
    const metrics = [
      ['Overall', 'overall_score'],
      ['Answer', 'answer_score'],
      ['Confidence', 'confidence_score'],
      ['Communication', 'communication_score'],
      ['Fillers', 'filler_word_score'],
    ]
    return metrics.map(([label, key]) => ({
      metric: label,
      previous: previous[key] ?? null,
      current: session[key] ?? null,
    }))
  }, [session, previous])

  // Performance by question type, from this session's own answers.
  const tagBreakdown = useMemo(() => {
    const buckets = {}
    for (const a of answers) {
      if (!a.question_tag || a.answer_score == null) continue
      ;(buckets[a.question_tag] ??= []).push(a.answer_score)
    }
    const rows = Object.entries(buckets).map(([tag, values]) => ({
      tag,
      score: Math.round((values.reduce((x, y) => x + y, 0) / values.length) * 10) / 10,
      count: values.length,
    }))
    return rows.sort((x, y) => y.score - x.score)
  }, [answers])

  const handleShare = async () => {
    const lines = [
      `ARIA AI interview - ${ROLE_LABELS[session.job_role] ?? session.job_role} (${session.difficulty})`,
      `Overall: ${session.overall_score ?? '--'}/100`,
      `Answer quality: ${session.answer_score ?? '--'} | Confidence: ${session.confidence_score ?? '--'}`,
      `Communication: ${session.communication_score ?? '--'} | Filler words: ${session.total_filler_count ?? 0}`,
      feedback.overall_verdict ? `\n${feedback.overall_verdict}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    try {
      // navigator.clipboard needs a secure context and can be denied outright.
      await navigator.clipboard.writeText(lines)
      toastSuccess('Summary copied', 'Your results are on the clipboard.')
    } catch {
      toastError('Could not copy', 'Your browser blocked clipboard access.')
    }
  }

  /* ---- Loading and error ------------------------------------------------- */
  if (isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LoadingSpinner size="md" showLabel label="Scoring your interview" />
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-aria-red" aria-hidden="true" />
        <h1 className="mt-4 font-display text-xl font-semibold">
          Could not load your results
        </h1>
        <p className="mt-2 text-sm text-aria-muted">{error}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={load} leftIcon={<RefreshCw className="h-4 w-4" />}>
            Try again
          </Button>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            Dashboard
          </Button>
        </div>
      </div>
    )
  }

  const overall = session.overall_score
  const celebrate = typeof overall === 'number' && overall > CELEBRATION_THRESHOLD

  const rings = [
    { label: 'Answer Quality', value: session.answer_score },
    { label: 'Confidence', value: session.confidence_score },
    { label: 'Communication', value: session.communication_score },
    { label: 'Filler Words', value: session.filler_word_score },
  ]

  return (
    <div className="mx-auto max-w-6xl">
      {/* ---- Header --------------------------------------------------------- */}
      <header className="relative mb-10 text-center">
        <Celebration show={celebrate} />

        <p className="animate-slide-up font-mono text-xs uppercase tracking-widest text-aria-pulse" style={stagger(0)}>
          Interview Complete
        </p>
        <h1 className="mt-2 animate-slide-up font-display text-3xl font-bold tracking-tight sm:text-4xl" style={stagger(1)}>
          {celebrate ? 'Strong session.' : 'Here is how it went.'}
        </h1>

        <div className="mt-4 flex animate-slide-up flex-wrap items-center justify-center gap-2" style={stagger(2)}>
          <Badge variant="blue" withDot={false}>
            {ROLE_LABELS[session.job_role] ?? session.job_role}
          </Badge>
          <Badge variant="muted" withDot={false}>
            {session.difficulty}
          </Badge>
          <span className="inline-flex items-center gap-1.5 text-sm text-aria-muted">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {session.duration_minutes ? `${session.duration_minutes} min` : 'Duration unknown'}
          </span>
        </div>

        {/* Overall centred and larger, the four components either side. */}
        <div className="mt-8 flex animate-slide-up flex-wrap items-center justify-center gap-6 sm:gap-8" style={stagger(3)}>
          {rings.slice(0, 2).map((r) => (
            <ScoreRing
              key={r.label}
              value={r.value}
              label={r.label}
              size="sm"
              duration={1500}
              labelPlacement="below"
            />
          ))}
          <ScoreRing value={overall} label="Overall" size="lg" duration={1500} />
          {rings.slice(2).map((r) => (
            <ScoreRing
              key={r.label}
              value={r.value}
              label={r.label}
              size="sm"
              duration={1500}
              labelPlacement="below"
            />
          ))}
        </div>
      </header>

      {/* ---- Strengths and weaknesses --------------------------------------- */}
      <div className="mb-8 grid animate-slide-up gap-4 md:grid-cols-2" style={stagger(4)}>
        <Card padding="md" className="border-l-4 border-l-aria-green">
          <h2 className="mb-3 font-display text-lg font-semibold">Strengths</h2>
          {feedback.strengths?.length ? (
            <ul className="space-y-2.5">
              {feedback.strengths.slice(0, 3).map((item, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-aria-text">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-aria-green" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-aria-muted">
              No strengths were identified for this session.
            </p>
          )}
        </Card>

        <Card padding="md" className="border-l-4 border-l-aria-amber">
          <h2 className="mb-3 font-display text-lg font-semibold">Areas to Improve</h2>
          {feedback.weaknesses?.length ? (
            <ul className="space-y-2.5">
              {feedback.weaknesses.slice(0, 3).map((item, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-aria-text">
                  <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-aria-amber" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-aria-muted">Nothing specific was flagged.</p>
          )}
        </Card>
      </div>

      {feedback.overall_verdict ? (
        <Card padding="md" className="mb-8 animate-slide-up" style={stagger(5)} glow>
          <h2 className="mb-2 font-display text-lg font-semibold">Verdict</h2>
          <p className="text-sm leading-relaxed text-aria-text">{feedback.overall_verdict}</p>
          {feedback.source === 'heuristic' ? (
            <p className="mt-3 border-t border-aria-border pt-3 text-xs text-aria-amber">
              Generated without the language model, so it reflects delivery metrics
              rather than the substance of your answers.
            </p>
          ) : null}
        </Card>
      ) : null}      <FailureDNA
        data={session?.failure_dna}
        className="animate-slide-up"
        style={stagger(4)}
      />
      <RecruiterReplay
        data={session?.recruiter_replay}
        className="animate-slide-up"
        style={stagger(5)}
      />



      {/* ---- Question by question ------------------------------------------- */}
      <section className="mb-8 animate-slide-up" style={stagger(6)}>
        <h2 className="mb-3 font-display text-lg font-semibold">
          Question by question
        </h2>
        {answers.length ? (
          <div className="space-y-2">
            {answers.map((answer, i) => (
              <QuestionBreakdown key={answer.id} answer={answer} defaultOpen={i === 0} />
            ))}
          </div>
        ) : (
          <Card padding="md">
            <p className="text-sm text-aria-muted">
              No answers were recorded in this session.
            </p>
          </Card>
        )}
      </section>

      {/* ---- Attention: a filler word being leaned on ------------------------- */}
      {stats?.filler_history ? (
        <FillerAttention
          fillerHistory={stats.filler_history}
          className="mb-8 animate-slide-up"
        />
      ) : null}

      {/* ---- Performance by question type ------------------------------------ */}
      {tagBreakdown.length > 1 ? (
        <Card padding="md" className="mb-8 animate-slide-up">
          <h2 className="mb-1 font-display text-lg font-semibold">By question type</h2>
          <p className="mb-4 text-xs text-aria-muted">
            {(() => {
              const best = tagBreakdown[0]
              const worst = tagBreakdown[tagBreakdown.length - 1]
              if (best.tag === worst.tag) return 'Average score per question type.'
              const advice =
                worst.tag === 'Behavioral'
                  ? ' Practise the STAR method.'
                  : worst.tag === 'Technical'
                    ? ' Work through the fundamentals for this role.'
                    : ''
              return `You score ${Math.round(best.score)} on ${best.tag} but only ${Math.round(worst.score)} on ${worst.tag}.${advice}`
            })()}
          </p>
          <div className="space-y-3">
            {tagBreakdown.map((row) => (
              <div key={row.tag}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-aria-text">
                    {row.tag}
                    <span className="ml-1.5 text-xs text-aria-muted">
                      ({row.count} question{row.count === 1 ? '' : 's'})
                    </span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-aria-text">
                    {Math.round(row.score)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-aria-border">
                  <div
                    className="h-full rounded-full bg-aria-gradient"
                    style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ---- Suggestions ----------------------------------------------------- */}
      {feedback.top_suggestions?.length ? (
        <section className="mb-8 animate-slide-up" style={stagger(7)}>
          <h2 className="mb-3 font-display text-lg font-semibold">What to do next</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {feedback.top_suggestions.slice(0, 3).map((suggestion, i) => {
              const { category, icon: Icon, tone } = SUGGESTION_CATEGORIES[i % 3]
              return (
                <Card key={i} padding="md">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className={cn('h-4 w-4', tone)} aria-hidden="true" />
                    <span className="text-xs font-medium uppercase tracking-wider text-aria-muted">
                      {category}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-aria-text">{suggestion}</p>
                </Card>
              )
            })}
          </div>
          {feedback.recommended_resources?.length ? (
            <Card padding="md" className="mt-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-aria-muted">
                Worth studying
              </h3>
              <ul className="space-y-1.5">
                {feedback.recommended_resources.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-aria-text">
                    <span aria-hidden="true" className="text-aria-pulse">
                      &rarr;
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </section>
      ) : null}

      {/* ---- Comparison with the previous session ---------------------------- */}
      {comparison ? (
        <Card padding="md" className="mb-8 animate-slide-up" style={stagger(8)}>
          <h2 className="mb-1 font-display text-lg font-semibold">Versus last session</h2>
          <p className="mb-4 text-xs text-aria-muted">
            Compared with your previous completed interview.
          </p>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparison} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="metric"
                  stroke="#7A6E62"
                  tick={{ fill: '#7A6E62', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#D9CFC4' }}
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="#7A6E62"
                  tick={{ fill: '#7A6E62', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: '#FFFFFF',
                    border: '1px solid #D9CFC4',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#1A1F2E' }}
                />
                <Line
                  type="monotone"
                  dataKey="previous"
                  name="Last session"
                  stroke="#7A6E62"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3, fill: '#7A6E62' }}
                />
                <Line
                  type="monotone"
                  dataKey="current"
                  name="This session"
                  stroke="#F5A623"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#F5A623' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      {/* ---- Proctoring summary ----------------------------------------------- */}
      {session?.proctoring_data ? (
        <Card padding="md" className="animate-slide-up" style={stagger(8)}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Session Integrity</h2>
              <p className="mt-0.5 text-sm text-aria-muted">
                Focus signals recorded during the interview. These do not affect
                your scores.
              </p>
            </div>
            {session.integrity_score != null ? (
              <div className="flex items-center gap-2.5">
                <span className="font-display text-2xl font-bold tabular-nums">
                  {Math.round(session.integrity_score)}
                  <span className="text-sm text-aria-muted">/100</span>
                </span>
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-semibold',
                    session.integrity_score >= 90
                      ? 'border-aria-green/45 bg-aria-green/10 text-aria-green'
                      : session.integrity_score >= 70
                        ? 'border-aria-amber/45 bg-aria-amber/10 text-aria-amber'
                        : 'border-aria-red/45 bg-aria-red/10 text-aria-red',
                  )}
                >
                  {session.integrity_score >= 90
                    ? 'Clean'
                    : session.integrity_score >= 70
                      ? 'Minor flags'
                      : 'Needs review'}
                </span>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-aria-border bg-aria-surface/60 p-3">
              <p className="font-display text-xl font-bold tabular-nums">
                {session.proctoring_data.tab_switches ?? 0}
              </p>
              <p className="text-xs text-aria-muted">Tab switches</p>
            </div>
            <div className="rounded-xl border border-aria-border bg-aria-surface/60 p-3">
              <p className="font-display text-xl font-bold tabular-nums">
                {Math.round((session.proctoring_data.total_away_ms ?? 0) / 1000)}s
              </p>
              <p className="text-xs text-aria-muted">Time away from tab</p>
            </div>
            <div className="rounded-xl border border-aria-border bg-aria-surface/60 p-3">
              <p className="font-display text-xl font-bold tabular-nums">
                {session.proctoring_data.attention_rate != null
                  ? `${Math.round(session.proctoring_data.attention_rate * 100)}%`
                  : '--'}
              </p>
              <p className="text-xs text-aria-muted">
                {session.proctoring_data.tracking_available
                  ? 'Facing the screen'
                  : 'Attention not measured'}
              </p>
            </div>
          </div>

          {session.proctoring_data.switches?.length ? (
            <ul className="mt-3 space-y-1.5 border-t border-aria-border pt-3">
              {session.proctoring_data.switches.slice(0, 5).map((sw, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 text-xs text-aria-muted"
                >
                  <span>
                    Left the tab at{' '}
                    {new Date(sw.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="font-mono tabular-nums">
                    {Math.round(sw.durationMs / 1000)}s
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 text-xs text-aria-muted">
            These are attention signals, not proof of anything. They describe
            where the tab and camera were pointing, not what you were doing.
          </p>
        </Card>
      ) : null}

      {/* ---- Actions ---------------------------------------------------------- */}
      <div
        className="flex animate-slide-up flex-col gap-3 border-t border-aria-border pt-6 sm:flex-row sm:justify-between"
        style={stagger(9)}
      >
        <Button
          variant="outline"
          onClick={() => navigate('/select-role')}
          leftIcon={<Repeat className="h-4 w-4" />}
        >
          Practice Again
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="ghost"
            onClick={handleShare}
            leftIcon={<Share2 className="h-4 w-4" />}
          >
            Share Results
          </Button>
          {/* Career intelligence is only generated for AI Meet interviews. */}
          {session?.session_type === 'ai_meet' ? (
            <Button
              variant="outline"
              onClick={() => navigate(`/career/${sessionId}`)}
              leftIcon={<Compass className="h-4 w-4" />}
            >
              View Career Report
            </Button>
          ) : null}
          <Button
            onClick={() => navigate(`/report/${sessionId}`)}
            leftIcon={<FileText className="h-4 w-4" />}
          >
            View Full Report
          </Button>
        </div>
      </div>
    </div>
  )
}
