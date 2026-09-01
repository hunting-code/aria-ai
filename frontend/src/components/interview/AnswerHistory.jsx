import { Check } from 'lucide-react'

import { cn } from '../ui'
import { scoreTone } from '../ui/scoreColor'

const BAR = {
  green: 'bg-aria-green',
  amber: 'bg-aria-amber',
  red: 'bg-aria-red',
  muted: 'bg-aria-muted',
}

/** Scrollable list of answers already given in this session. */
export default function AnswerHistory({ answers = [] }) {
  if (!answers.length) {
    return (
      <p className="rounded-xl border border-dashed border-aria-border p-4 text-center text-xs text-aria-muted">
        Answered questions will appear here.
      </p>
    )
  }

  return (
    <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
      {answers.map((a) => {
        const tone = scoreTone(a.score)
        return (
          <li
            key={a.questionNumber}
            className="flex items-center gap-3 rounded-lg border border-aria-border bg-aria-surface/50 p-2.5"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-aria-green/15 text-aria-green">
              <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-aria-muted">Q{a.questionNumber}</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-aria-border">
                <div
                  className={cn('h-full rounded-full', BAR[tone])}
                  style={{ width: `${Math.min(100, Math.max(0, a.score ?? 0))}%` }}
                />
              </div>
            </div>
            <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-aria-text">
              {a.score != null ? Math.round(a.score) : '--'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
