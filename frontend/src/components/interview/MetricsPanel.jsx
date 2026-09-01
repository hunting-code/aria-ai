import { Check, Gauge, MessageSquareWarning } from 'lucide-react'

import { Card, ScoreRing, cn } from '../ui'
import { wpmTone } from '../../utils/scoreCalculator'

const TONE_TEXT = {
  green: 'text-aria-green',
  amber: 'text-aria-amber',
  red: 'text-aria-red',
  muted: 'text-aria-muted',
}

/** Live delivery metrics: confidence, pace and filler words. */
export default function MetricsPanel({ confidence, wpm, fillerData, isLive }) {
  const tone = wpmTone(wpm)
  const flagged = Object.entries(fillerData?.flaggedWords ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-4">
      <Card padding="md" className="flex flex-col items-center">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-aria-muted">
          Confidence
        </p>
        <ScoreRing value={confidence} size="md" animate={false} />
        <p className="mt-2 text-center text-xs text-aria-muted">
          {isLive ? 'Updating as you speak' : 'From your last answer'}
        </p>
      </Card>

      <Card padding="md">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-aria-muted" aria-hidden="true" />
          <p className="text-xs font-medium uppercase tracking-wider text-aria-muted">
            Words per minute
          </p>
        </div>
        <p
          className={cn('mt-2 font-mono text-4xl font-bold tabular-nums', TONE_TEXT[tone])}
          aria-live="off"
        >
          {wpm ? Math.round(wpm) : '--'}
        </p>
        <p className="mt-1 text-xs text-aria-muted">ideal: 120-140 WPM</p>
      </Card>

      <Card padding="md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="h-4 w-4 text-aria-muted" aria-hidden="true" />
            <p className="text-xs font-medium uppercase tracking-wider text-aria-muted">
              Filler words
            </p>
          </div>
          <span
            className={cn(
              'font-mono text-2xl font-bold tabular-nums',
              fillerData?.count ? 'text-aria-red' : 'text-aria-green',
            )}
          >
            {fillerData?.count ?? 0}
          </span>
        </div>

        {flagged.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {flagged.map(([word, n]) => (
              <li
                key={word}
                // animate-score-count gives each badge a small pop as it appears.
                className="animate-score-count rounded-full border border-aria-red/30 bg-aria-red/10 px-2 py-0.5 text-[11px] text-aria-red"
              >
                {word}
                {n > 1 ? <span className="ml-1 font-mono opacity-70">x{n}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-aria-green">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            None detected yet
          </p>
        )}
      </Card>
    </div>
  )
}
