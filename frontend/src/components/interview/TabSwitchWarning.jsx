// Shown when the candidate comes back to a tab they left mid-interview.
//
// The tone matters: it reports what happened and lets them carry on. It does
// not accuse, and it never blocks - the only button continues the interview.

import { AlertTriangle, ArrowRight, Clock } from 'lucide-react'

import { Button, cn } from '../ui'

function duration(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return `${m}m ${String(rest).padStart(2, '0')}s`
}

/**
 * @param event  {at, durationMs} for the trip just ended, or null to hide
 * @param count  how many switches have happened in total
 * @param level  'none' | 'warning' | 'critical'
 */
export default function TabSwitchWarning({ event, count, level, onResume }) {
  if (!event) return null
  const critical = level === 'critical'

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="tab-switch-title"
      className="fixed inset-0 z-[100] grid place-items-center bg-aria-void/92 px-6 backdrop-blur-sm animate-fade-in"
    >
      <div className="w-full max-w-md rounded-2xl border border-aria-border bg-aria-base p-6 text-center shadow-surface">
        <span
          className={cn(
            'mx-auto grid h-12 w-12 place-items-center rounded-full',
            critical ? 'bg-aria-red/15 text-aria-red' : 'bg-aria-amber/15 text-aria-amber',
          )}
        >
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </span>

        <h2 id="tab-switch-title" className="mt-4 font-display text-xl font-semibold">
          You left the interview
        </h2>
        <p className="mt-2 text-sm text-aria-muted">
          This is recorded on your session summary. It does not affect your answer
          scores.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-aria-border bg-aria-surface/60 p-3">
            <p className="font-display text-2xl font-bold tabular-nums">{count}</p>
            <p className="text-[11px] text-aria-muted">
              time{count === 1 ? '' : 's'} away
            </p>
          </div>
          <div className="rounded-xl border border-aria-border bg-aria-surface/60 p-3">
            <p className="flex items-center justify-center gap-1.5 font-display text-2xl font-bold tabular-nums">
              <Clock className="h-4 w-4 text-aria-muted" aria-hidden="true" />
              {duration(event.durationMs)}
            </p>
            <p className="text-[11px] text-aria-muted">just now</p>
          </div>
        </div>

        {critical ? (
          <p className="mt-4 rounded-lg border border-aria-red/40 bg-aria-red/10 p-2.5 text-xs text-aria-red">
            Repeated absences will show prominently on your integrity summary.
          </p>
        ) : null}

        <Button
          fullWidth
          size="lg"
          className="mt-5"
          onClick={onResume}
          rightIcon={<ArrowRight className="h-4 w-4" />}
          autoFocus
        >
          Resume interview
        </Button>
      </div>
    </div>
  )
}
