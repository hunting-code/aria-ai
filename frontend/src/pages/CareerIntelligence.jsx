// What the interview means for the candidate's actual job search: where they
// stand, what to learn, how to describe themselves, where to apply, and
// whether a specific posting is worth their time.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle, ArrowRight, Briefcase, Check, Copy, ExternalLink, FileSearch,
  Loader2, Share2, Sparkles, Target, TrendingUp, X,
} from 'lucide-react'

import { careerApi, extractErrorMessage } from '../services/api'
import { Button, Card, cn } from '../components/ui'
import EmptyState from '../components/ui/EmptyState'
import { PageSkeleton } from '../components/ui/Skeleton'

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

const LEVELS = ['none', 'beginner', 'intermediate', 'advanced', 'expert']

const PRIORITY_TABS = [
  { id: 'critical', label: 'Critical', tone: 'red' },
  { id: 'high', label: 'High Priority', tone: 'amber' },
  { id: 'nice_to_have', label: 'Good to Have', tone: 'green' },
]

const SEVERITY_TONE = { high: 'bg-aria-red', medium: 'bg-aria-amber', low: 'bg-aria-muted' }

const READINESS_LABEL = { entry: 'Entry', mid: 'Mid-level', senior: 'Senior' }

const VERDICT_STYLE = {
  strong_match: { label: 'Strong match', cls: 'border-aria-green/45 bg-aria-green/10 text-aria-green' },
  worth_applying: { label: 'Worth applying', cls: 'border-aria-green/45 bg-aria-green/10 text-aria-green' },
  stretch: { label: 'A stretch', cls: 'border-aria-amber/45 bg-aria-amber/10 text-aria-amber' },
  not_yet: { label: 'Not yet', cls: 'border-aria-red/45 bg-aria-red/10 text-aria-red' },
}

function Section({ icon: Icon, eyebrow, title, children, className }) {
  return (
    <section className={cn('scroll-mt-24', className)}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-aria-blue/10 text-aria-blue">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-aria-muted">
            {eyebrow}
          </p>
          <h2 className="font-display text-lg font-semibold">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  )
}

/** Copy-to-clipboard control that confirms, then resets. */
function CopyButton({ value, label = 'Copy', className }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard is blocked in some contexts; select-and-copy still works.
      return
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
        copied
          ? 'border-aria-green/50 bg-aria-green/10 text-aria-green'
          : 'border-aria-border text-aria-muted hover:border-aria-blue hover:text-aria-text',
        className,
      )}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* 1 - Readiness                                                              */
/* -------------------------------------------------------------------------- */

function Readiness({ data }) {
  const score = data?.score ?? 0
  const tone = score >= 75 ? 'bg-aria-green' : score >= 50 ? 'bg-aria-amber' : 'bg-aria-red'
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = window.setTimeout(() => setWidth(score), 120)
    return () => window.clearTimeout(t)
  }, [score])

  return (
    <Card padding="lg" glow>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-aria-muted">Interview Readiness</p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums">
            {Math.round(score)}
            <span className="text-xl text-aria-muted">/100</span>
          </p>
        </div>
        <span className="rounded-full border border-aria-blue/45 bg-aria-blue/10 px-3 py-1 text-xs font-semibold text-aria-blue">
          {READINESS_LABEL[data?.level] ?? 'Entry'}
        </span>
      </div>

      <div
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-aria-border"
        role="progressbar"
        aria-valuenow={Math.round(score)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Interview readiness"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-1000 ease-out-expo', tone)}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-aria-muted">
        <span>0</span><span>50</span><span>100</span>
      </div>

      {data?.summary ? (
        <p className="mt-4 text-sm leading-relaxed text-aria-text">{data.summary}</p>
      ) : null}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* 2 - Resume vs reality                                                      */
/* -------------------------------------------------------------------------- */

function ResumeReality({ rows }) {
  if (!rows?.length) return null
  return (
    <Section icon={FileSearch} eyebrow="Section 2" title="Resume vs Reality">
      <p className="-mt-2 mb-4 text-sm text-aria-muted">
        What your resume claims, against what your answers actually demonstrated.
      </p>
      <div className="space-y-3">
        {rows.map((row, i) => {
          const confirmed = row.status === 'confirmed'
          return (
            <div key={i} className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-aria-amber/40 bg-aria-amber/10 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-aria-amber">
                  Your resume says
                </p>
                <p className="mt-1.5 text-sm text-aria-text">{row.claim}</p>
              </div>
              <div
                className={cn(
                  'rounded-xl border p-4',
                  confirmed
                    ? 'border-aria-green/40 bg-aria-green/10'
                    : 'border-aria-red/40 bg-aria-red/10',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      'flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider',
                      confirmed ? 'text-aria-green' : 'text-aria-red',
                    )}
                  >
                    {confirmed ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <X className="h-3 w-3" aria-hidden="true" />
                    )}
                    {confirmed ? 'Confirmed' : row.status === 'partial' ? 'Partly shown' : 'Gap'}
                  </p>
                  {!confirmed ? (
                    <span className="flex items-center gap-1.5" title={`${row.severity} severity`}>
                      <span
                        className={cn('h-2 w-2 rounded-full', SEVERITY_TONE[row.severity])}
                        aria-hidden="true"
                      />
                      <span className="text-[10px] capitalize text-aria-muted">
                        {row.severity}
                      </span>
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-sm text-aria-text">{row.evidence}</p>
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 3 - Skill gaps                                                             */
/* -------------------------------------------------------------------------- */

function LevelArrow({ from, to }) {
  const fromIdx = LEVELS.indexOf(from)
  const toIdx = LEVELS.indexOf(to)
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-md border border-aria-border bg-aria-surface px-2 py-0.5 text-[11px] capitalize text-aria-muted">
        {from}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-aria-blue" aria-hidden="true" />
      <span className="rounded-md border border-aria-blue/45 bg-aria-blue/10 px-2 py-0.5 text-[11px] font-medium capitalize text-aria-blue">
        {to}
      </span>
      {toIdx > fromIdx ? (
        <span className="font-mono text-[10px] text-aria-muted">
          +{toIdx - fromIdx} level{toIdx - fromIdx > 1 ? 's' : ''}
        </span>
      ) : null}
    </div>
  )
}

function SkillGaps({ gaps }) {
  const [tab, setTab] = useState('critical')
  // Open on the first tab that actually has something in it.
  useEffect(() => {
    const firstFilled = PRIORITY_TABS.find((t) => gaps.some((g) => g.priority === t.id))
    if (firstFilled) setTab(firstFilled.id)
  }, [gaps])

  const shown = gaps.filter((g) => g.priority === tab)

  return (
    <Section icon={TrendingUp} eyebrow="Section 3" title="Skill Gap Map">
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {PRIORITY_TABS.map((t) => {
          const count = gaps.filter((g) => g.priority === t.id).length
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
                tab === t.id
                  ? 'border-aria-blue bg-aria-blue/10 text-aria-text'
                  : 'border-aria-border text-aria-muted hover:text-aria-text',
              )}
            >
              {t.label}
              <span className="ml-1.5 font-mono text-[10px] text-aria-muted">{count}</span>
            </button>
          )
        })}
      </div>

      {shown.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((g) => (
            <Card key={g.skill} padding="md">
              <h3 className="font-display text-sm font-semibold">{g.skill}</h3>
              <div className="mt-2">
                <LevelArrow from={g.current_level} to={g.required_level} />
              </div>
              {g.why ? <p className="mt-2.5 text-xs text-aria-muted">{g.why}</p> : null}
              <div className="mt-3 space-y-1.5 border-t border-aria-border pt-3">
                {g.resource ? (
                  <p className="text-xs text-aria-text">
                    <span className="text-aria-muted">Resource: </span>
                    {g.resource}
                  </p>
                ) : null}
                {g.time_estimate ? (
                  <p className="font-mono text-[11px] text-aria-blue">~{g.time_estimate}</p>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-aria-muted">Nothing in this band - good news.</p>
      )}
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 4 - LinkedIn                                                               */
/* -------------------------------------------------------------------------- */

function LinkedInOptimizer({ data }) {
  if (!data) return null
  return (
    <Section icon={Share2} eyebrow="Section 4" title="LinkedIn Optimizer">
      <div className="space-y-4">
        {data.headline ? (
          <Card padding="md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wider text-aria-muted">
                Suggested headline
              </p>
              <CopyButton value={data.headline} />
            </div>
            <p className="rounded-lg border border-aria-border bg-aria-surface/70 p-3 text-sm text-aria-text">
              {data.headline}
            </p>
            <p className="mt-1.5 font-mono text-[10px] text-aria-muted">
              {data.headline.length}/220 characters
            </p>
          </Card>
        ) : null}

        {data.missing_keywords?.length ? (
          <Card padding="md">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-aria-muted">
              Keywords your profile is missing
            </p>
            <p className="mb-3 text-xs text-aria-muted">
              Click any keyword to copy it.
            </p>
            <div className="flex flex-wrap gap-2">
              {data.missing_keywords.map((kw) => (
                <CopyButton key={kw} value={kw} label={kw} className="font-normal" />
              ))}
            </div>
          </Card>
        ) : null}

        {data.about ? (
          <Card padding="md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wider text-aria-muted">
                About section
              </p>
              <CopyButton value={data.about} />
            </div>
            <p className="whitespace-pre-wrap rounded-lg border border-aria-border bg-aria-surface/70 p-3 text-sm leading-relaxed text-aria-text">
              {data.about}
            </p>
          </Card>
        ) : null}

        {data.experience_tips?.length ? (
          <Card padding="md">
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-aria-muted">
              Experience section
            </p>
            <ul className="space-y-2">
              {data.experience_tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-aria-text">
                  <Sparkles
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aria-blue"
                    aria-hidden="true"
                  />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 5 - Job search                                                             */
/* -------------------------------------------------------------------------- */

const TIERS = [
  { id: 'stretch', label: 'Stretch', blurb: 'Reach for it', tone: 'border-aria-red/40' },
  { id: 'target', label: 'Target', blurb: 'Where you fit now', tone: 'border-aria-green/50' },
  { id: 'starter', label: 'Starter', blurb: 'Safe ground', tone: 'border-aria-blue/40' },
]

function JobSearch({ data }) {
  if (!data) return null
  const jobUrl = (title) =>
    `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(title)}`

  return (
    <Section icon={Briefcase} eyebrow="Section 5" title="Job Search Guidance">
      <div className="grid gap-4 lg:grid-cols-3">
        {TIERS.map((tier) => {
          const row = data[tier.id]
          if (!row) return null
          return (
            <Card key={tier.id} padding="md" className={cn('border', tier.tone)}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-base font-semibold">{tier.label}</h3>
                <span className="font-mono text-[10px] uppercase tracking-wider text-aria-muted">
                  {tier.blurb}
                </span>
              </div>
              <p className="mt-2 text-sm text-aria-text">{row.description}</p>
              {row.why ? <p className="mt-1.5 text-xs text-aria-muted">{row.why}</p> : null}
              {row.titles?.length ? (
                <div className="mt-3 border-t border-aria-border pt-3">
                  <p className="mb-2 text-[11px] text-aria-muted">Search these titles:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {row.titles.map((title) => (
                      <a
                        key={title}
                        href={jobUrl(title)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-aria-border px-2.5 py-1 text-[11px] text-aria-text transition-colors hover:border-aria-blue hover:text-aria-blue"
                      >
                        {title}
                        <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          )
        })}
      </div>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 6 - 30-day plan                                                            */
/* -------------------------------------------------------------------------- */

function ActionPlan({ weeks }) {
  // Ticks are local and deliberately not persisted - this is a planning aid,
  // not a tracker, and a half-ticked list restored days later reads as stale.
  const [done, setDone] = useState({})
  if (!weeks?.length) return null

  return (
    <Section icon={Target} eyebrow="Section 6" title="30-Day Action Plan">
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 scroll-touch lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
        {weeks.map((w) => (
          <Card
            key={w.week}
            padding="md"
            className="min-w-[15rem] flex-1 snap-start lg:min-w-0"
          >
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-sm font-bold">Week {w.week}</h3>
              <span className="font-mono text-[10px] text-aria-muted">
                Day {(w.week - 1) * 7 + 1}-{w.week * 7}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-aria-blue">{w.focus}</p>
            <ul className="mt-3 space-y-2">
              {w.actions.map((action, i) => {
                const key = `${w.week}-${i}`
                const checked = Boolean(done[key])
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setDone((d) => ({ ...d, [key]: !d[key] }))}
                      aria-pressed={checked}
                      className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse"
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                          checked
                            ? 'border-aria-green bg-aria-green/20 text-aria-green'
                            : 'border-aria-border text-transparent',
                        )}
                      >
                        <Check className="h-2.5 w-2.5" aria-hidden="true" />
                      </span>
                      <span
                        className={cn(
                          'text-xs leading-relaxed',
                          checked ? 'text-aria-muted line-through' : 'text-aria-text',
                        )}
                      >
                        {action}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
        ))}
      </div>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 7 - JD matcher                                                             */
/* -------------------------------------------------------------------------- */

function JdMatcher({ sessionId }) {
  const [jd, setJd] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const run = async () => {
    setError(null)
    setBusy(true)
    try {
      setResult(await careerApi.matchJd({ job_description: jd, session_id: sessionId }))
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not analyse that job description.'))
    } finally {
      setBusy(false)
    }
  }

  const verdict = result ? VERDICT_STYLE[result.verdict] ?? VERDICT_STYLE.stretch : null
  const tooShort = jd.trim().length < 40

  return (
    <Section icon={FileSearch} eyebrow="Section 7" title="Job Description Matcher">
      <Card padding="md">
        <label htmlFor="jd" className="text-xs font-medium uppercase tracking-wider text-aria-muted">
          Paste any job description
        </label>
        <textarea
          id="jd"
          rows={8}
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          placeholder="Paste the full posting here - requirements, responsibilities, everything."
          className="mt-2 w-full resize-y rounded-lg border border-aria-border bg-aria-surface/70 p-3 text-sm text-aria-text placeholder:text-aria-muted/70 focus:border-aria-blue focus:outline-none focus:ring-2 focus:ring-aria-blue/40"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-aria-muted">
            {jd.trim().length} characters
          </span>
          <Button onClick={run} disabled={tooShort || busy} isLoading={busy} loadingLabel="Analysing">
            Analyse Match
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-aria-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </Card>

      {result ? (
        <div className="mt-4 space-y-4">
          <Card padding="md" glow>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {result.role_title ? (
                  <p className="text-xs text-aria-muted">{result.role_title}</p>
                ) : null}
                <p className="font-display text-3xl font-bold tabular-nums">
                  {Math.round(result.match_percentage)}
                  <span className="text-lg text-aria-muted">% match</span>
                </p>
              </div>
              <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold', verdict.cls)}>
                {verdict.label}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-aria-border">
              <div
                className="h-full rounded-full bg-aria-gradient transition-[width] duration-1000 ease-out-expo"
                style={{ width: `${result.match_percentage}%` }}
              />
            </div>
            {result.recommendation ? (
              <p className="mt-3 text-sm leading-relaxed text-aria-text">{result.recommendation}</p>
            ) : null}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card padding="md">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-aria-green">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                You meet ({result.matching.length})
              </p>
              <ul className="space-y-2.5">
                {result.matching.map((m, i) => (
                  <li key={i} className="rounded-lg border border-aria-green/30 bg-aria-green/5 p-2.5">
                    <p className="text-sm font-medium text-aria-text">{m.requirement}</p>
                    <p className="mt-0.5 text-xs text-aria-muted">{m.evidence}</p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card padding="md">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-aria-red">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Gaps ({result.missing.length})
              </p>
              <ul className="space-y-2.5">
                {result.missing.map((m, i) => (
                  <li key={i} className="rounded-lg border border-aria-red/30 bg-aria-red/5 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-aria-text">{m.requirement}</p>
                      <span
                        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_TONE[m.severity])}
                        title={`${m.severity} severity`}
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-aria-muted">{m.gap}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {result.tailoring_tips?.length ? (
            <Card padding="md">
              <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-aria-muted">
                If you apply, do this
              </p>
              <ol className="space-y-2">
                {result.tailoring_tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-aria-text">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-aria-blue/15 font-mono text-[10px] text-aria-blue">
                      {i + 1}
                    </span>
                    {tip}
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      ) : null}
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function CareerIntelligence() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (force = false) => {
      setLoading(true)
      setError(null)
      try {
        setReport(await careerApi.report(sessionId, { force }))
      } catch (err) {
        setError(extractErrorMessage(err, 'Could not build your career report.'))
      } finally {
        setLoading(false)
      }
    },
    [sessionId],
  )

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="mb-6 flex items-center gap-2.5 text-sm text-aria-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Building your career report - this takes a few seconds.
        </p>
        <PageSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={AlertCircle}
          title="Career report unavailable"
          description={error}
          action={
            <div className="flex gap-3">
              <Button onClick={() => load(true)}>Try again</Button>
              <Button variant="outline" onClick={() => navigate('/dashboard')}>
                Back to dashboard
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-aria-blue">
          Career Intelligence
        </p>
        <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight">
          What this interview means for your job search
        </h1>
        <p className="mt-2 text-sm text-aria-muted">
          Built from your AI Meet answers
          {report?.resume_used ? ' and your resume' : ''}.
        </p>
      </header>

      <Readiness data={report?.readiness} />
      <ResumeReality rows={report?.resume_reality} />
      <SkillGaps gaps={report?.skill_gaps ?? []} />
      <LinkedInOptimizer data={report?.linkedin} />
      <JobSearch data={report?.job_search} />
      <ActionPlan weeks={report?.action_plan} />
      <JdMatcher sessionId={sessionId} />

      <div className="flex justify-between gap-3 border-t border-aria-border pt-6">
        <Button variant="outline" onClick={() => navigate(`/analysis/${sessionId}`)}>
          Back to analysis
        </Button>
        <Button variant="ghost" onClick={() => load(true)}>
          Regenerate report
        </Button>
      </div>
    </div>
  )
}
