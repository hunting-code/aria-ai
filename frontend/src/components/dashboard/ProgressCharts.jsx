// Standalone progress charts, shared by the dashboard and the history page.
// All three use the aria-blue / aria-pulse scheme against the dark surfaces.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// Chart chrome is not themable through Tailwind classes - recharts takes SVG
// attributes - so the palette values are repeated here deliberately.
const AXIS = '#7A6E62'
const GRID = '#D9CFC4'
const BLUE = '#D4891A'
const PULSE = '#F5A623'

const TOOLTIP_STYLE = {
  background: '#FFFFFF',
  border: '1px solid #D9CFC4',
  borderRadius: 8,
  fontSize: 12,
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

function EmptyState({ children }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <p className="max-w-xs text-sm text-aria-muted">{children}</p>
    </div>
  )
}

/** Overall score over time. `points` is [{date, value}], oldest first. */
export function ScoreTrendChart({ points = [], height = 240 }) {
  const data = points
    .filter((p) => p.value !== null && p.value !== undefined)
    .map((p) => ({ ...p, label: shortDate.format(new Date(p.date)), score: Math.round(p.value) }))

  if (data.length < 2) {
    return (
      <div style={{ height }}>
        <EmptyState>Complete two interviews to see your score trend.</EmptyState>
      </div>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={BLUE} />
              <stop offset="100%" stopColor={PULSE} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#1A1F2E' }} />
          <Line
            type="monotone"
            dataKey="score"
            name="Overall score"
            stroke="url(#scoreStroke)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: PULSE, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: PULSE }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Average score across the five dimensions.
 *
 * A radar shows the *shape* of a performance: a consistently low confidence
 * score reads as a dent rather than as one number among five.
 */
export function DimensionRadar({ averages = {}, height = 260 }) {
  const data = [
    { dimension: 'Answer', value: averages.answer },
    { dimension: 'Confidence', value: averages.confidence },
    { dimension: 'Communication', value: averages.communication },
    { dimension: 'Fillers', value: averages.filler },
    { dimension: 'Overall', value: averages.overall },
  ].map((d) => ({ ...d, value: d.value == null ? 0 : Math.round(d.value) }))

  if (data.every((d) => d.value === 0)) {
    return (
      <div style={{ height }}>
        <EmptyState>Scores appear here once you have completed an interview.</EmptyState>
      </div>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {/* 62% leaves room for the axis labels; at 72% "Confidence" and
            "Communication" clip against the edge on a narrow phone. */}
        <RadarChart data={data} outerRadius="62%">
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="dimension" tick={{ fill: AXIS, fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} angle={90} tick={{ fill: AXIS, fontSize: 9 }} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#1A1F2E' }} />
          <Radar name="Average" dataKey="value" stroke={PULSE} fill={BLUE} fillOpacity={0.35} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Sessions completed per week, last four weeks. */
export function SessionsPerWeekChart({ weeks = [], height = 220 }) {
  if (!weeks.length) {
    return (
      <div style={{ height }}>
        <EmptyState>No sessions in the last four weeks.</EmptyState>
      </div>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weeks} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="weekBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PULSE} />
              <stop offset="100%" stopColor={BLUE} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis allowDecimals={false} stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#1A1F2E' }} cursor={{ fill: 'rgba(212,137,26,0.08)' }} />
          <Bar dataKey="sessions" name="Sessions" fill="url(#weekBar)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Two sessions side by side, with the delta per metric. */
export function ComparisonChart({ a, b, height = 260 }) {
  const metrics = [
    ['Overall', 'overall_score'],
    ['Answer', 'answer_score'],
    ['Confidence', 'confidence_score'],
    ['Communication', 'communication_score'],
    ['Fillers', 'filler_word_score'],
  ]
  const data = metrics.map(([label, key]) => ({
    metric: label,
    first: a?.[key] ?? null,
    second: b?.[key] ?? null,
  }))

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="metric" stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis domain={[0, 100]} stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#1A1F2E' }} cursor={{ fill: 'rgba(212,137,26,0.08)' }} />
          <Legend wrapperStyle={{ fontSize: 11, color: AXIS }} />
          <Bar dataKey="first" name="Older" fill={AXIS} radius={[3, 3, 0, 0]} maxBarSize={26} />
          <Bar dataKey="second" name="Newer" fill={PULSE} radius={[3, 3, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
