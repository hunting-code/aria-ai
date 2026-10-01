// Dashboard: greeting, headline stats, progress chart, recent sessions and a
// daily tip. Every figure is derived client-side from GET /sessions/my-sessions
// so the page makes exactly one request.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertCircle,
  ArrowRight,
  BarChart2,
  BrainCircuit,
  CalendarDays,
  Code2,
  Lightbulb,
  Minus,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Compass,
  FileText,
  UploadCloud,
} from 'lucide-react'

import useAuth from '../hooks/useAuth'
import { resumeApi, sessionsApi, extractErrorMessage } from '../services/api'
import StreakCard from '../components/dashboard/StreakCard'
import OnboardingModal, { shouldShowOnboarding } from '../components/onboarding/OnboardingModal'
import { Badge, Button, Card, ScoreRing, cn } from '../components/ui'
import { TONE_TEXT, scoreTone } from '../components/ui/scoreColor'

/* ========================================================================== */
/* Reference data                                                             */
/* ========================================================================== */

const ROLE_META = {
  data_analyst: { label: 'Data Analyst', icon: BarChart2 },
  software_engineer: { label: 'Software Engineer', icon: Code2 },
  hr: { label: 'HR', icon: Users },
  ai_engineer: { label: 'AI Engineer', icon: BrainCircuit },
}

const roleMeta = (role) =>
  ROLE_META[role] ?? { label: role ?? 'Unknown', icon: Sparkles }

// 30 tips, one per day of the month. Rotating by day-of-year keeps the tip
// stable for a whole day rather than changing on every render.
const TIPS = [
  { category: 'Structure', text: 'Answer behavioural questions with STAR: Situation, Task, Action, Result. Spend most of your time on Action.' },
  { category: 'Speaking', text: 'A two-second pause reads as considered. A filled "um" reads as unsure. Trade one for the other.' },
  { category: 'Confidence', text: 'State your answer first, then justify it. Burying the conclusion makes strong reasoning sound tentative.' },
  { category: 'Body Language', text: 'Put the camera at eye level. Looking down at an interviewer reads as disengaged, even when you are not.' },
  { category: 'Structure', text: 'Ask a clarifying question before a technical answer. It buys thinking time and shows you scope before you build.' },
  { category: 'Speaking', text: 'Aim for 130-150 words per minute. Faster than that and detail stops landing.' },
  { category: 'Confidence', text: '"I have not used it, but here is how I would approach it" beats bluffing every time.' },
  { category: 'Structure', text: 'Quantify results. "Cut load time by 40%" is remembered; "improved performance" is not.' },
  { category: 'Body Language', text: 'Keep your hands visible. Gesturing while you explain genuinely helps you find words.' },
  { category: 'Speaking', text: 'End sentences downward. Upward inflection turns statements into questions.' },
  { category: 'Structure', text: 'Prepare three stories flexible enough to answer ten questions, rather than ten rigid ones.' },
  { category: 'Confidence', text: 'When you do not know, say so and then reason aloud. Interviewers score the reasoning.' },
  { category: 'Speaking', text: 'Cut "just", "kind of" and "I think" from technical claims. They shrink work you actually did.' },
  { category: 'Body Language', text: 'Sit forward slightly. Leaning back reads as disinterest on camera.' },
  { category: 'Structure', text: 'Signpost long answers: "There were three problems." The listener can then follow you.' },
  { category: 'Speaking', text: 'Rehearse aloud, not in your head. The gap between the two is where filler words live.' },
  { category: 'Confidence', text: 'Own the failure in a failure story. Blaming the team is the answer that loses offers.' },
  { category: 'Structure', text: 'Close with the outcome and what you would change. It shows reflection without prompting.' },
  { category: 'Body Language', text: 'Smile at the start and end. Neutral is fine in between; permanently neutral reads as cold.' },
  { category: 'Speaking', text: 'Slow down for numbers and names. Those are the words listeners most often lose.' },
  { category: 'Confidence', text: 'Do not apologise for taking a moment to think. Announce it: "Let me think about that."' },
  { category: 'Structure', text: 'For system design, state assumptions and constraints before drawing anything.' },
  { category: 'Speaking', text: 'Replace "obviously" and "simply". If it were obvious, they would not be asking.' },
  { category: 'Body Language', text: 'Look at the camera when you make your key point, and at the face the rest of the time.' },
  { category: 'Confidence', text: 'Have two questions ready for them. Having none reads as indifference to the role.' },
  { category: 'Structure', text: 'Match answer length to question weight. Ninety seconds for a warm-up wastes your best material.' },
  { category: 'Speaking', text: 'Breathe from the diaphragm between answers. Shallow breathing is what makes voices shake.' },
  { category: 'Confidence', text: 'Bring one number about yourself to every interview: users served, latency cut, revenue moved.' },
  { category: 'Body Language', text: 'Check your lighting faces you. A backlit silhouette costs you every non-verbal signal.' },
  { category: 'Structure', text: 'If you ramble, stop and say "Short version:" then give it. Recovering well is itself a good signal.' },
]

const TIP_TONE = {
  Speaking: 'blue',
  Structure: 'green',
  Confidence: 'amber',
  'Body Language': 'muted',
}

/** Day-of-year, so the tip changes once a day and is the same for everyone. */
function tipOfTheDay(now = new Date()) {
  const start = new Date(now.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((now - start) / 86400000)
  return TIPS[dayOfYear % TIPS.length]
}

/* ========================================================================== */
/* Formatting helpers                                                         */
/* ========================================================================== */

function greeting(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const longDateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** Whole days between a timestamp and now, comparing calendar days not hours. */
function daysAgo(iso) {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startOfDay(new Date()) - startOfDay(then)) / 86400000)
}

function lastSessionPhrase(sessions) {
  if (!sessions.length) return 'This will be your first session.'
  const days = daysAgo(sessions[0].created_at)
  if (days === null) return 'Ready when you are.'
  if (days <= 0) return 'Your last session was today.'
  if (days === 1) return 'Your last session was yesterday.'
  return `Your last session was ${days} days ago.`
}

/* ========================================================================== */
/* Derived statistics                                                         */
/* ========================================================================== */

function buildStats(sessions) {
  // Only scored sessions count towards averages; an abandoned run with a null
  // score must not drag the average to zero.
  const scored = sessions.filter(
    (s) => typeof s.overall_score === 'number' && !Number.isNaN(s.overall_score),
  )
  const scores = scored.map((s) => s.overall_score)

  const average = scores.length
    ? scores.reduce((sum, n) => sum + n, 0) / scores.length
    : null
  const best = scores.length ? Math.max(...scores) : null

  // scored[0] is the newest (the API returns newest first).
  const latest = scored[0]?.overall_score ?? null
  const previous = scored[1]?.overall_score ?? null
  const trend = latest !== null && previous !== null ? latest - previous : null

  const weekAgo = Date.now() - 7 * 86400000
  const thisWeek = sessions.filter((s) => {
    const t = new Date(s.created_at).getTime()
    return !Number.isNaN(t) && t >= weekAgo
  }).length

  return { total: sessions.length, average, best, trend, thisWeek, scoredCount: scored.length }
}

/** Oldest-first series for the chart, only sessions that have a score. */
function buildChartData(sessions) {
  return sessions
    .filter((s) => typeof s.overall_score === 'number')
    .slice()
    .reverse()
    .map((s, i) => ({
      index: i + 1,
      date: dateFmt.format(new Date(s.created_at)),
      fullDate: longDateFmt.format(new Date(s.created_at)),
      role: roleMeta(s.job_role).label,
      score: Math.round(s.overall_score),
    }))
}

/* ========================================================================== */
/* Small presentational pieces                                                */
/* ========================================================================== */

function Skeleton({ className }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gradient-to-r from-aria-surface via-aria-border to-aria-surface',
        'bg-[length:200%_100%]',
        className,
      )}
    />
  )
}

function StatCard({ icon: Icon, label, value, suffix, tone = 'text-aria-text', delay = 0, children }) {
  return (
    <Card
      padding="md"
      className="animate-slide-up"
      // Staggered entrance: 0.1s between cards.
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-aria-border bg-aria-surface/70">
          <Icon className="h-4 w-4 text-aria-pulse" aria-hidden="true" />
        </span>
        {children}
      </div>
      <p className={cn('mt-4 font-mono text-3xl font-bold tabular-nums', tone)}>
        {value}
        {suffix ? <span className="ml-0.5 text-base text-aria-muted">{suffix}</span> : null}
      </p>
      <p className="mt-1 text-sm text-aria-muted">{label}</p>
    </Card>
  )
}

function TrendPill({ delta }) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-aria-border px-2 py-0.5 text-xs text-aria-muted">
        <Minus className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">No change data</span>
        —
      </span>
    )
  }
  const up = delta >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        up
          ? 'border-aria-green/30 bg-aria-green/10 text-aria-green'
          : 'border-aria-red/30 bg-aria-red/10 text-aria-red',
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {up ? '+' : ''}
      {Math.round(delta)}
      <span className="sr-only">
        {up ? 'up' : 'down'} {Math.abs(Math.round(delta))} points versus the previous session
      </span>
    </span>
  )
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="glass rounded-lg px-3 py-2 text-xs shadow-surface">
      <p className="font-medium text-aria-text">{point.fullDate}</p>
      <p className="mt-0.5 text-aria-muted">{point.role}</p>
      <p className={cn('mt-1 font-mono text-sm font-bold', TONE_TEXT[scoreTone(point.score)])}>
        {point.score}
        <span className="text-aria-muted">/100</span>
      </p>
    </div>
  )
}

/** CSS-drawn rising chart for the "not enough data yet" state. */
function GrowingChartArt() {
  const bars = [28, 42, 38, 58, 72, 90]
  return (
    <div className="relative mx-auto flex h-32 w-48 items-end justify-center gap-2" aria-hidden="true">
      <div className="absolute inset-x-0 bottom-0 h-px bg-aria-border" />
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-5 animate-slide-up rounded-t bg-gradient-to-t from-aria-blue/20 to-aria-pulse/70"
          style={{ height: `${h}%`, animationDelay: `${i * 0.09}s` }}
        />
      ))}
      {/* Trend arrow riding over the bars. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 192 128"
        fill="none"
      >
        <path
          d="M8 104 L44 88 L80 92 L116 62 L152 38 L184 14"
          stroke="#F5A623"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
        <circle cx="184" cy="14" r="4" fill="#F5A623" />
      </svg>
    </div>
  )
}

/* ========================================================================== */
/* Page                                                                       */
/* ========================================================================== */

export default function Home() {
  const user = useAuth((s) => s.user)
  const navigate = useNavigate()

  // First-run introduction. Read once on mount: finishing it writes to
  // localStorage, and re-reading would make the modal close and reopen.
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding)

  const [sessions, setSessions] = useState([])
  // Named to distinguish it from the client-derived `stats` below.
  const [serverStats, setServerStats] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  // `showLoading` is false for the initial fetch: isLoading already starts
  // true, so setting it again inside the mount effect would be a redundant
  // render. Retries pass it through to get the skeletons back.
  const load = useCallback(async (signal, { showLoading = true } = {}) => {
    if (showLoading) {
      setIsLoading(true)
      setError(null)
    }
    try {
      const data = await sessionsApi.mySessions({ signal })
      setSessions(Array.isArray(data) ? data : [])
      // The streak comes from the stats endpoint; a failure there must not
      // take the whole dashboard down with it.
      try {
        setServerStats(await sessionsApi.stats({ signal }))
      } catch {
        setServerStats(null)
      }
    } catch (err) {
      // An aborted request is the effect cleaning up, not a failure.
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
      setError(extractErrorMessage(err, 'Could not load your sessions.'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // Fetching on mount is the "synchronising with an external system" case
    // that the set-state-in-effect rule explicitly exempts.
    // oxlint-disable-next-line react/set-state-in-effect
    load(controller.signal, { showLoading: false })
    return () => controller.abort()
  }, [load])

  const stats = useMemo(() => buildStats(sessions), [sessions])
  const chartData = useMemo(() => buildChartData(sessions), [sessions])
  const recent = useMemo(() => sessions.slice(0, 5), [sessions])
  const tip = useMemo(() => tipOfTheDay(), [])

  // Latest completed AI Meet, for the career insights card. undefined = loading,
  // null = the user has not finished one yet.
  const [careerMeet, setCareerMeet] = useState(undefined)
  useEffect(() => {
    let live = true
    sessionsApi
      .mySessions()
      .then(async (data) => {
        if (!live) return
        const rows = Array.isArray(data) ? data : (data?.sessions ?? [])
        const meet = rows.find(
          (row) => row.session_type === 'ai_meet' && row.status === 'completed',
        )
        if (!meet) return setCareerMeet(null)
        // Only read what is already stored - opening the dashboard must never
        // trigger a minutes-long report generation.
        try {
          const full = await sessionsApi.get(meet.id)
          live && setCareerMeet({ ...meet, guidance: full?.career_guidance ?? null })
        } catch {
          live && setCareerMeet({ ...meet, guidance: null })
        }
      })
      .catch(() => live && setCareerMeet(null))
    return () => {
      live = false
    }
  }, [])

  // Resume analysis summary - null means none uploaded, undefined still loading.
  const [resume, setResume] = useState(undefined)
  useEffect(() => {
    let live = true
    resumeApi
      .myResume()
      .then((data) => live && setResume(data))
      .catch(() => live && setResume(null))
    return () => {
      live = false
    }
  }, [])

  const firstName = user?.full_name?.split(' ')[0] || user?.username || 'there'

  return (
    <div className="mx-auto max-w-7xl">
      <OnboardingModal
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        firstName={(user?.full_name || user?.username || '').split(' ')[0]}
      />

      {/* ---- 1. Welcome header ------------------------------------------- */}
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {greeting()}, <span className="text-gradient">{firstName}</span>.
          </h1>
          <p className="mt-1.5 text-sm text-aria-muted">
            {isLoading ? 'Loading your history…' : `Ready to practice? ${lastSessionPhrase(sessions)}`}
          </p>
        </div>

        <Button
          size="lg"
          className="shrink-0 animate-pulse-glow"
          onClick={() => navigate('/select-role')}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          Start Interview
        </Button>
      </header>

      {/* Error banner. The page still renders its empty states beneath. */}
      {error ? (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-aria-red/40 bg-aria-red/10 p-4 text-sm text-aria-red"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load()}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {serverStats ? (
            <StreakCard
              streak={serverStats.current_streak}
              longest={serverStats.longest_streak}
              badge={serverStats.streak_badge}
              nextBadgeIn={serverStats.next_badge_in}
              className="animate-slide-up"
            />
          ) : null}
          {/* ---- 2. Stats row -------------------------------------------- */}
          <section aria-label="Your statistics">
            {isLoading ? (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Card key={i} padding="md">
                    <Skeleton className="h-9 w-9 rounded-lg" />
                    <Skeleton className="mt-4 h-8 w-20" />
                    <Skeleton className="mt-2 h-4 w-24" />
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  icon={BarChart2}
                  label="Total sessions"
                  value={stats.total}
                  delay={0}
                />
                <StatCard
                  icon={Sparkles}
                  label="Average score"
                  value={stats.average === null ? '--' : Math.round(stats.average)}
                  suffix={stats.average === null ? undefined : '%'}
                  tone={stats.average === null ? 'text-aria-muted' : TONE_TEXT[scoreTone(stats.average)]}
                  delay={0.1}
                >
                  <TrendPill delta={stats.trend} />
                </StatCard>
                <StatCard
                  icon={Trophy}
                  label="Best score"
                  value={stats.best === null ? '--' : Math.round(stats.best)}
                  suffix={stats.best === null ? undefined : '%'}
                  // Gold, reserved for the personal best.
                  tone={stats.best === null ? 'text-aria-muted' : 'text-aria-amber'}
                  delay={0.2}
                />
                <StatCard
                  icon={CalendarDays}
                  label="This week"
                  value={stats.thisWeek}
                  delay={0.3}
                />
              </div>
            )}
          </section>

          {/* ---- 3. Progress chart --------------------------------------- */}
          <Card padding="md" className="animate-slide-up" style={{ animationDelay: '0.35s' }}>
            <h2 className="font-display text-lg font-semibold">Your Progress Over Time</h2>

            {isLoading ? (
              <Skeleton className="mt-4 h-64 w-full rounded-lg" />
            ) : chartData.length < 2 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <GrowingChartArt />
                <p className="mt-5 font-medium text-aria-text">
                  Complete 2+ interviews to see your progress
                </p>
                <p className="mt-1 max-w-xs text-sm text-aria-muted">
                  Scores from each session plot here, so you can watch the trend rather than
                  guess at it.
                </p>
              </div>
            ) : (
              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#D4891A" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#D4891A" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#D9CFC4" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="#7A6E62"
                      tick={{ fill: '#7A6E62', fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: '#D9CFC4' }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      stroke="#7A6E62"
                      tick={{ fill: '#7A6E62', fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#F5A623', strokeWidth: 1 }} />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="#D4891A"
                      strokeWidth={2.5}
                      fill="url(#scoreFill)"
                      dot={{ fill: '#F5A623', r: 3, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#F5A623' }}
                      name="Overall score"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* ---- 4. Recent sessions -------------------------------------- */}
          <Card padding="md" className="animate-slide-up" style={{ animationDelay: '0.4s' }}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="font-display text-lg font-semibold">Recent Sessions</h2>
              <Link
                to="/sessions"
                className="text-sm font-medium text-aria-pulse underline-offset-4 hover:underline"
              >
                View All
              </Link>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="hidden h-4 w-24 sm:block" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-8 w-24 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div className="py-10 text-center">
                <p className="font-medium text-aria-text">No sessions yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-aria-muted">
                  Your completed interviews will be listed here with their scores.
                </p>
                <Button className="mt-5" onClick={() => navigate('/select-role')}>
                  Start your first interview
                </Button>
              </div>
            ) : (
              // Wide tables scroll inside their own container so the page body
              // never scrolls sideways on a phone.
              <div className="-mx-2 overflow-x-auto px-2">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <caption className="sr-only">Your five most recent interview sessions</caption>
                  <thead>
                    <tr className="border-b border-aria-border text-left text-xs uppercase tracking-wider text-aria-muted">
                      <th scope="col" className="pb-3 pr-4 font-medium">Role</th>
                      <th scope="col" className="pb-3 pr-4 font-medium">Date</th>
                      <th scope="col" className="pb-3 pr-4 font-medium">Overall Score</th>
                      <th scope="col" className="pb-3 pr-4 font-medium">Status</th>
                      <th scope="col" className="pb-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((s) => {
                      const { label, icon: RoleIcon } = roleMeta(s.job_role)
                      const hasScore = typeof s.overall_score === 'number'
                      return (
                        <tr
                          key={s.id}
                          className="border-b border-aria-border/60 transition-colors last:border-0 hover:bg-black/5"
                        >
                          <td className="py-3 pr-4">
                            <span className="inline-flex items-center gap-2.5">
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-aria-border bg-aria-surface/70">
                                <RoleIcon className="h-4 w-4 text-aria-pulse" aria-hidden="true" />
                              </span>
                              <span className="font-medium text-aria-text">{label}</span>
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-aria-muted">
                            {longDateFmt.format(new Date(s.created_at))}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={cn(
                                'font-mono font-bold tabular-nums',
                                hasScore ? TONE_TEXT[scoreTone(s.overall_score)] : 'text-aria-muted',
                              )}
                            >
                              {hasScore ? `${Math.round(s.overall_score)}%` : '--'}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge status={s.status} />
                          </td>
                          <td className="py-3">
                            {/* An unfinished session has no report to open, so
                                it offers to resume instead of leading nowhere. */}
                            {s.status === 'active' ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => navigate(`/interview/${s.id}`)}
                                aria-label={`Resume the ${label} session started on ${longDateFmt.format(new Date(s.created_at))}`}
                              >
                                Resume
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(`/report/${s.id}`)}
                                aria-label={`View report for the ${label} session on ${longDateFmt.format(new Date(s.created_at))}`}
                              >
                                View Report
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ---- 5. Tips panel --------------------------------------------- */}
        <aside className="min-w-0 space-y-6" aria-label="Resume and interview tip">
          {/* ---- Career insights ----------------------------------------- */}
          {careerMeet ? (
            <Card padding="md" className="animate-slide-up" style={{ animationDelay: '0.35s' }}>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Compass className="h-4 w-4 text-aria-blue" aria-hidden="true" />
                Career Insights
              </p>
              {careerMeet.guidance?.readiness ? (
                <>
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <span className="font-display text-2xl font-bold tabular-nums">
                      {Math.round(careerMeet.guidance.readiness.score)}
                      <span className="text-sm text-aria-muted">/100</span>
                    </span>
                    <span className="rounded-full border border-aria-blue/45 bg-aria-blue/10 px-2 py-0.5 text-[11px] font-semibold capitalize text-aria-blue">
                      {careerMeet.guidance.readiness.level === 'mid'
                        ? 'Mid-level'
                        : careerMeet.guidance.readiness.level}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-aria-border">
                    <div
                      className="h-full rounded-full bg-aria-gradient"
                      style={{ width: `${careerMeet.guidance.readiness.score}%` }}
                    />
                  </div>
                  {careerMeet.guidance.skill_gaps?.length ? (
                    <p className="mt-3 text-xs text-aria-muted">
                      <span className="text-aria-text">Top gap: </span>
                      {careerMeet.guidance.skill_gaps[0].skill}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-xs text-aria-muted">
                  Your AI Meet is scored - open your career report to see where you
                  stand and what to work on.
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                fullWidth
                className="mt-4"
                onClick={() => navigate(`/career/${careerMeet.id}`)}
              >
                View career report
              </Button>
            </Card>
          ) : null}

          {/* ---- Resume summary ------------------------------------------ */}
          {resume === undefined ? null : resume ? (
            <Card padding="md" className="animate-slide-up" style={{ animationDelay: '0.4s' }}>
              <div className="flex items-center gap-4">
                <ScoreRing value={resume.resume_score} size="sm" animate={false} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <FileText className="h-4 w-4 text-aria-blue" aria-hidden="true" />
                    Resume Score
                  </p>
                  <p className="mt-0.5 text-xs text-aria-muted">
                    Last analysed{' '}
                    {new Date(resume.last_analysed_at).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </div>
              </div>
              {resume.score_breakdown?.critical_issues?.[0] ? (
                <p className="mt-3 text-xs leading-relaxed text-aria-muted">
                  <span className="font-semibold text-aria-amber">Top issue:</span>{' '}
                  {resume.score_breakdown.critical_issues[0]}
                </p>
              ) : null}
              <Link
                to="/resume"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-aria-blue hover:underline"
              >
                View Full Analysis <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Card>
          ) : (
            <Card padding="md" glow className="animate-slide-up" style={{ animationDelay: '0.4s' }}>
              <div className="mb-2 flex items-center gap-2">
                <UploadCloud className="h-4 w-4 text-aria-blue" aria-hidden="true" />
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-aria-muted">
                  Personalize ARIA
                </h2>
              </div>
              <p className="text-sm font-medium">
                Upload your resume to unlock personalized interview questions
              </p>
              <p className="mt-1 text-xs leading-relaxed text-aria-muted">
                ARIA will generate questions from your actual projects and experience.
              </p>
              <Button size="sm" className="mt-3 w-full" onClick={() => navigate('/resume')}>
                Upload Resume
              </Button>
            </Card>
          )}

          <Card
            padding="md"
            glow
            className="animate-slide-up xl:sticky xl:top-24"
            style={{ animationDelay: '0.45s' }}
          >
            <div className="mb-3 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-aria-amber" aria-hidden="true" />
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-aria-muted">
                Today&apos;s Interview Tip
              </h2>
            </div>

            <Badge variant={TIP_TONE[tip.category] ?? 'muted'} withDot={false}>
              {tip.category}
            </Badge>

            <p className="mt-3 text-sm leading-relaxed text-aria-text">{tip.text}</p>

            <p className="mt-4 border-t border-aria-border pt-3 text-xs text-aria-muted">
              A new tip appears each day.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
