import cn from './cn'
import { TONE_BG, TONE_TEXT, scoreTone } from './scoreColor'

const SIZES = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' }

/**
 * Horizontal meter for a single metric.
 *
 * Colour follows the same thresholds as ScoreRing unless `tone` overrides it.
 * The numeric value is rendered alongside the bar rather than relying on
 * width and colour alone.
 */
export default function ProgressBar({
  value = 0,
  max = 100,
  label,
  showValue = true,
  tone,
  size = 'md',
  animate = true,
  className,
  ...props
}) {
  const hasValue = value !== null && value !== undefined && !Number.isNaN(value)
  const clamped = hasValue ? Math.min(Math.max(value, 0), max) : 0
  const pct = max > 0 ? (clamped / max) * 100 : 0
  const resolvedTone = tone ?? scoreTone(hasValue ? pct : null)

  return (
    <div className={cn('w-full', className)} {...props}>
      {label || showValue ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label ? (
            <span className="truncate text-sm text-aria-muted">{label}</span>
          ) : (
            <span />
          )}
          {showValue ? (
            <span
              className={cn(
                'shrink-0 font-mono text-sm font-medium tabular-nums',
                hasValue ? TONE_TEXT[resolvedTone] : 'text-aria-muted',
              )}
            >
              {hasValue ? Math.round(clamped) : '--'}
              <span className="text-aria-muted">/{max}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          'w-full overflow-hidden rounded-full bg-aria-border',
          SIZES[size] ?? SIZES.md,
        )}
        role="progressbar"
        aria-valuenow={hasValue ? Math.round(clamped) : undefined}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ? `${label}: ${hasValue ? Math.round(clamped) : 'not scored'} of ${max}` : undefined}
      >
        <div
          className={cn(
            'h-full rounded-full',
            TONE_BG[resolvedTone] ?? TONE_BG.muted,
            animate && 'transition-[width] duration-1000 ease-out-expo',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
