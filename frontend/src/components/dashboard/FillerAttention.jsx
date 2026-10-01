import { AlertTriangle } from 'lucide-react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'

import { Card, cn } from '../ui'

// Thresholds from the spec: "like" is called out earlier because it is the
// most common crutch and the easiest to hear.
const LIKE_THRESHOLD = 8
const GENERAL_THRESHOLD = 5
const RECOMMENDED_MAX = 3

/**
 * Flags a filler word the candidate leans on, with its history.
 *
 * `history[word]` is newest-first, matching the stats endpoint.
 */
export default function FillerAttention({ fillerHistory = {}, className }) {
  const flagged = Object.entries(fillerHistory)
    .map(([word, counts]) => ({ word, counts, current: counts?.[0] ?? 0 }))
    .filter(({ word, current }) =>
      word === 'like' ? current >= LIKE_THRESHOLD : current >= GENERAL_THRESHOLD,
    )
    .sort((a, b) => b.current - a.current)

  if (!flagged.length) return null

  const worst = flagged[0]
  const previous = worst.counts.slice(1).filter((n) => n !== null && n !== undefined)
  // Oldest first for the chart so it reads left to right like every other trend.
  const chartData = [...worst.counts]
    .reverse()
    .map((count, i, arr) => ({ label: i === arr.length - 1 ? 'This' : `-${arr.length - 1 - i}`, count }))

  return (
    <Card padding="md" className={cn('border-l-4 border-l-aria-amber', className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-aria-amber" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold text-aria-text">Attention</h2>
          <p className="mt-1 text-sm leading-relaxed text-aria-text">
            You said <strong className="text-aria-amber">&ldquo;{worst.word}&rdquo;</strong>{' '}
            {worst.current} times in this session.
            {previous.length
              ? ` In your previous ${previous.length} session${previous.length === 1 ? '' : 's'}: ${previous.join(', ')}.`
              : ''}{' '}
            {worst.current > RECOMMENDED_MAX
              ? `This is still above the recommended <${RECOMMENDED_MAX} per interview.`
              : 'You are within the recommended range.'}
          </p>

          <div className="mt-3 h-24 w-full max-w-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <XAxis dataKey="label" stroke="#7A6E62" tick={{ fill: '#7A6E62', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #D9CFC4', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#1A1F2E' }}
                  cursor={{ fill: 'rgba(245,158,11,0.08)' }}
                />
                <Bar dataKey="count" name={worst.word} radius={[3, 3, 0, 0]} maxBarSize={28}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.count > RECOMMENDED_MAX ? '#B07408' : '#178A5B'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {flagged.length > 1 ? (
            <p className="mt-2 text-xs text-aria-muted">
              Also frequent: {flagged.slice(1, 4).map((f) => `"${f.word}" (${f.current})`).join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
