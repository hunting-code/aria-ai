import { Flame } from 'lucide-react'

import { Card, cn } from '../ui'

// Badge tiers mirror STREAK_BADGES in backend/app/api/routes/session.py.
const BADGE_STYLES = {
  '3-day': 'border-aria-blue/40 bg-aria-blue/10 text-aria-pulse',
  '7-day': 'border-aria-green/40 bg-aria-green/10 text-aria-green',
  '14-day': 'border-aria-amber/40 bg-aria-amber/10 text-aria-amber',
  '30-day': 'border-aria-red/40 bg-aria-red/10 text-aria-red',
}

const FLAME = {
  0: 'text-aria-muted',
  3: 'text-aria-pulse',
  7: 'text-aria-green',
  14: 'text-aria-amber',
  30: 'text-aria-red',
}

function flameTone(streak) {
  const tier = [30, 14, 7, 3, 0].find((t) => streak >= t)
  return FLAME[tier] ?? FLAME[0]
}

/** Consecutive days with at least one completed interview. */
export default function StreakCard({ streak = 0, longest = 0, badge, nextBadgeIn, className }) {
  const message =
    streak === 0
      ? 'Complete an interview today to start a streak.'
      : nextBadgeIn
        ? `You're on a ${streak}-day streak! ${nextBadgeIn} more day${nextBadgeIn === 1 ? '' : 's'} for your next badge.`
        : `You're on a ${streak}-day streak - your longest is ${longest}.`

  return (
    <Card padding="md" className={className}>
      <div className="flex items-start gap-4">
        <span
          className={cn(
            'grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-aria-border bg-aria-surface/70',
            streak > 0 && 'animate-pulse-glow',
          )}
        >
          <Flame className={cn('h-6 w-6', flameTone(streak))} aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="font-mono text-3xl font-bold tabular-nums text-aria-text">{streak}</p>
            <p className="text-sm text-aria-muted">
              day{streak === 1 ? '' : 's'} in a row
            </p>
            {badge ? (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  BADGE_STYLES[badge] ?? BADGE_STYLES['3-day'],
                )}
              >
                {badge} badge
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-aria-muted">{message}</p>
        </div>
      </div>
    </Card>
  )
}
