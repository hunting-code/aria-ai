// Full interview history: filters, session cards, progress charts and a
// two-session comparison.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  BarChart3,
  Brain,
  Code2,
  FileText,
  RefreshCw,
  Scale,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react'

import { sessionsApi, extractErrorMessage } from '../services/api'
import { Badge, Button, Card, Input, ProgressBar, cn } from '../components/ui'
import Skeleton from '../components/ui/Skeleton'
import { scoreTone } from '../components/ui/scoreColor'
import { gradeFor } from '../utils/scoreCalculator'
import {
  ComparisonChart,
  DimensionRadar,
  ScoreTrendChart,
  SessionsPerWeekChart,
} from '../components/dashboard/ProgressCharts'
import useToast from '../store/toastStore'
import useDebounced from '../hooks/useDebounced'
import EmptyState from '../components/ui/EmptyState'
import { SessionCardSkeleton } from '../components/ui/Skeleton'

const PAGE_SIZE = 12

const ROLES = [
  { value: 'all', label: 'All', icon: null, accent: null },
  { value: 'data_analyst', label: 'Data Analyst', icon: BarChart3, accent: '#2D7DD2' },
  { value: 'software_engineer', label: 'SWE', icon: Code2, accent: '#A855F7' },
  { value: 'hr', label: 'HR', icon: Users, accent: '#EC4899' },
  { value: 'ai_engineer', label: 'AI Engineer', icon: Brain, accent: '#10B981' },
]
const ROLE_BY_VALUE = Object.fromEntries(ROLES.map((r) => [r.value, r]))

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'highest', label: 'Highest Score' },
  { value: 'lowest', label: 'Lowest Score' },
]

const TONE_TEXT = {
  green: 'text-aria-green',
  amber: 'text-aria-amber',
  red: 'text-aria-red',
  muted: 'text-aria-muted',
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** Small segmented control - lighter than a select for 3-5 options. */
function Segmented({ label, options, value, onChange }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-aria-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
              value === o.value
                ? 'border-aria-blue bg-aria-blue/15 text-white'
                : 'border-aria-border text-aria-muted hover:border-aria-blue/50 hover:text-aria-text',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SessionCard({ session, onDelete, isSelected, onToggleSelect, deleting }) {
  const navigate = useNavigate()
  const role = ROLE_BY_VALUE[session.job_role]
  const Icon = role?.icon
  const tone = scoreTone(session.overall_score)

  const metrics = [
    ['Answer', session.answer_score],
    ['Confidence', session.confidence_score],
    ['Communication', session.communication_score],
    ['Fillers', session.filler_word_score],
    ['Overall', session.overall_score],
  ]

  return (
    <Card padding="md" className={cn('flex flex-col', isSelected && 'border-aria-pulse/60 shadow-glow-sm')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
            style={
              role?.accent
                ? { borderColor: `${role.accent}55`, background: `${role.accent}1A`, color: role.accent }
                : undefined
            }
          >
            {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
            {role?.label ?? session.job_role}
          </span>
          <Badge variant="muted" withDot={false} size="sm">
            {session.difficulty}
          </Badge>
          <Badge status={session.status} size="sm" />
        </div>

        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-aria-muted">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(session.id)}
            className="h-3.5 w-3.5 cursor-pointer rounded border-aria-border bg-aria-surface accent-aria-blue"
          />
          Compare
        </label>
      </div>

      <p className="text-sm text-aria-text">
        {dateTimeFmt.format(new Date(session.created_at))}
      </p>
      <p className="mt-0.5 text-xs text-aria-muted">
        {session.duration_minutes ? `${Math.round(session.duration_minutes)} minutes` : 'Duration unknown'}
      </p>

      <div className="mt-4 flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          {metrics.map(([label, value]) => (
            <ProgressBar key={label} label={label} value={value} size="sm" showValue={false} />
          ))}
        </div>
        <div className="shrink-0 text-center">
          <p className={cn('font-mono text-3xl font-bold tabular-nums', TONE_TEXT[tone])}>
            {session.overall_score != null ? Math.round(session.overall_score) : '--'}
          </p>
          <p className="text-xs text-aria-muted">{gradeFor(session.overall_score)}</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2 border-t border-aria-border pt-3">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => navigate(`/report/${session.id}`)}
          leftIcon={<FileText className="h-3.5 w-3.5" />}
        >
          View Report
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(session)}
          isLoading={deleting}
          aria-label={`Delete the ${role?.label ?? session.job_role} session from ${dateTimeFmt.format(new Date(session.created_at))}`}
          className="text-aria-red hover:bg-aria-red/10"
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
        >
          Delete
        </Button>
      </div>
    </Card>
  )
}

export default function Sessions() {
  const toastSuccess = useToast((s) => s.success)
  const toastError = useToast((s) => s.error)

  const [sessions, setSessions] = useState([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const [role, setRole] = useState('all')
  const [range, setRange] = useState('all')
  const [sort, setSort] = useState('newest')
  const [search, setSearch] = useState('')
  // Filtering runs over every loaded session, so it waits for a pause in
  // typing rather than recomputing on each keystroke.
  const debouncedSearch = useDebounced(search, 250)
  const [selected, setSelected] = useState([])
  // "Now" is captured rather than read during render: calling Date.now() in a
  // memo makes the filter result depend on when React happens to re-render.
  // Refreshed whenever the list reloads, which is precise enough for a
  // day-granularity range filter.
  const [now, setNow] = useState(() => Date.now())

  const abortRef = useRef(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setNow(Date.now())
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current
    try {
      const [page, statsData] = await Promise.all([
        sessionsApi.page({ limit: PAGE_SIZE, offset: 0, signal }),
        sessionsApi.stats({ signal }),
      ])
      setSessions(page.items)
      setTotal(page.total)
      setStats(statsData)
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
      setError(extractErrorMessage(err, 'Could not load your history.'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const loadMore = async () => {
    setIsLoadingMore(true)
    try {
      const page = await sessionsApi.page({ limit: PAGE_SIZE, offset: sessions.length })
      // Guard against duplicates if a session was added between requests.
      setSessions((current) => {
        const seen = new Set(current.map((s) => s.id))
        return [...current, ...page.items.filter((s) => !seen.has(s.id))]
      })
      setTotal(page.total)
    } catch (err) {
      toastError('Could not load more', extractErrorMessage(err))
    } finally {
      setIsLoadingMore(false)
    }
  }

  const handleDelete = async (session) => {
    if (!window.confirm('Delete this session? It will be removed from your history.')) return
    setDeletingId(session.id)
    try {
      await sessionsApi.remove(session.id)
      setSessions((current) => current.filter((s) => s.id !== session.id))
      setSelected((current) => current.filter((id) => id !== session.id))
      setTotal((t) => Math.max(0, t - 1))
      toastSuccess('Session deleted')
      // Totals and trends have changed; refresh them.
      sessionsApi.stats().then(setStats).catch(() => {})
    } catch (err) {
      toastError('Could not delete', extractErrorMessage(err))
    } finally {
      setDeletingId(null)
    }
  }

  const toggleSelect = (id) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      // Comparison is strictly pairwise; selecting a third drops the oldest.
      return [...current, id].slice(-2)
    })
  }

  // Filtering and sorting happen over what has been loaded. The API paginates
  // newest-first; filters narrow that page rather than re-querying.
  const visible = useMemo(() => {
    const cutoff = range === 'all' ? null : now - Number(range) * 86400000
    const needle = debouncedSearch.trim().toLowerCase()

    const filtered = sessions.filter((s) => {
      if (role !== 'all' && s.job_role !== role) return false
      if (cutoff && new Date(s.created_at).getTime() < cutoff) return false
      if (needle) {
        const haystack = [
          ROLE_BY_VALUE[s.job_role]?.label ?? s.job_role,
          s.difficulty,
          dateTimeFmt.format(new Date(s.created_at)),
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })

    const score = (s) => (s.overall_score == null ? -1 : s.overall_score)
    return [...filtered].sort((a, b) => {
      if (sort === 'highest') return score(b) - score(a)
      if (sort === 'lowest') return score(a) - score(b)
      return new Date(b.created_at) - new Date(a.created_at)
    })
  }, [sessions, role, range, sort, debouncedSearch, now])

  const comparison = useMemo(() => {
    if (selected.length !== 2) return null
    const picked = selected.map((id) => sessions.find((s) => s.id === id)).filter(Boolean)
    if (picked.length !== 2) return null
    // Older on the left so a positive delta always reads as improvement.
    const [older, newer] = [...picked].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    )
    const metrics = [
      ['Overall', 'overall_score'],
      ['Answer', 'answer_score'],
      ['Confidence', 'confidence_score'],
      ['Communication', 'communication_score'],
      ['Filler Words', 'filler_word_score'],
    ]
    return {
      older,
      newer,
      rows: metrics.map(([label, key]) => {
        const a = older[key]
        const b = newer[key]
        return {
          label,
          older: a,
          newer: b,
          delta: a == null || b == null ? null : Math.round((b - a) * 10) / 10,
        }
      }),
    }
  }, [selected, sessions])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="mt-3 h-4 w-56" />
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <SessionCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Your Interview History
        </h1>
        <p className="mt-1 text-sm text-aria-muted">
          {total} session{total === 1 ? '' : 's'} recorded
          {stats?.most_practiced_role
            ? ` · most practised: ${ROLE_BY_VALUE[stats.most_practiced_role]?.label ?? stats.most_practiced_role}`
            : ''}
        </p>
      </header>

      {error ? (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-aria-red/40 bg-aria-red/10 p-4 text-sm text-aria-red">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="outline" onClick={load} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* ---- Progress charts ------------------------------------------------ */}
      {stats ? (
        <div className="mb-8 grid gap-4 lg:grid-cols-3">
          <Card padding="md" className="lg:col-span-2">
            <h2 className="mb-3 font-display text-base font-semibold">Score trend</h2>
            <ScoreTrendChart points={stats.score_trend} />
          </Card>
          <Card padding="md">
            <h2 className="mb-3 font-display text-base font-semibold">Your shape</h2>
            <DimensionRadar averages={stats.dimension_averages} />
          </Card>
          <Card padding="md" className="lg:col-span-3">
            <h2 className="mb-3 font-display text-base font-semibold">Sessions per week</h2>
            <SessionsPerWeekChart weeks={stats.sessions_per_week} />
          </Card>
        </div>
      ) : null}

      {/* ---- Filters --------------------------------------------------------- */}
      <Card padding="md" className="mb-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Segmented label="Role" options={ROLES} value={role} onChange={setRole} />
          <Segmented label="Date range" options={RANGES} value={range} onChange={setRange} />
          <Segmented label="Sort" options={SORTS} value={sort} onChange={setSort} />
          <Input
            label="Search"
            placeholder="Role or date…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            size="sm"
            rightElement={
              search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="rounded-md p-1 text-aria-muted hover:text-aria-text"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null
            }
          />
        </div>
      </Card>

      {/* ---- Comparison ------------------------------------------------------ */}
      {comparison ? (
        <Card padding="md" glow className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-base font-semibold">
              <Scale className="h-4 w-4 text-aria-pulse" aria-hidden="true" />
              Comparing two sessions
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
          <p className="mb-4 text-xs text-aria-muted">
            {dateTimeFmt.format(new Date(comparison.older.created_at))} &rarr;{' '}
            {dateTimeFmt.format(new Date(comparison.newer.created_at))}
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            <ComparisonChart a={comparison.older} b={comparison.newer} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[320px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-aria-border text-left text-xs uppercase tracking-wider text-aria-muted">
                    <th scope="col" className="pb-2 pr-3 font-medium">Metric</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Older</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Newer</th>
                    <th scope="col" className="pb-2 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((row) => (
                    <tr key={row.label} className="border-b border-aria-border/60 last:border-0">
                      <td className="py-2 pr-3 text-aria-text">{row.label}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-aria-muted">
                        {row.older == null ? '--' : Math.round(row.older)}
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-aria-text">
                        {row.newer == null ? '--' : Math.round(row.newer)}
                      </td>
                      <td
                        className={cn(
                          'py-2 font-mono font-semibold tabular-nums',
                          row.delta == null
                            ? 'text-aria-muted'
                            : row.delta > 0
                              ? 'text-aria-green'
                              : row.delta < 0
                                ? 'text-aria-red'
                                : 'text-aria-muted',
                        )}
                      >
                        {row.delta == null ? '--' : `${row.delta > 0 ? '+' : ''}${row.delta}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : selected.length === 1 ? (
        <p className="mb-6 rounded-xl border border-dashed border-aria-border p-3 text-center text-sm text-aria-muted">
          Select one more session to compare.
        </p>
      ) : null}

      {/* ---- Cards ------------------------------------------------------------ */}
      {visible.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onDelete={handleDelete}
              deleting={deletingId === session.id}
              isSelected={selected.includes(session.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      ) : (
        <Card padding="lg">
          <EmptyState
            variant={sessions.length ? 'search' : 'documents'}
            title={sessions.length ? 'No sessions match these filters' : 'No sessions yet'}
            description={
              sessions.length
                ? 'Try widening the date range or clearing the search.'
                : 'Your completed interviews will be listed here.'
            }
          />
        </Card>
      )}

      {/* ---- Load more (deliberately a button, not infinite scroll) ---------- */}
      {sessions.length < total ? (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={loadMore} isLoading={isLoadingMore}>
            Load more ({total - sessions.length} remaining)
          </Button>
        </div>
      ) : null}
    </div>
  )
}
