import { useEffect, useState } from 'react'

import cn from './cn'
import { TONE_HEX, TONE_TEXT, scoreTone } from './scoreColor'

const SIZES = {
  sm: { px: 72, stroke: 6, value: 'text-lg', suffix: 'text-[10px]', label: 'text-[10px]' },
  md: { px: 120, stroke: 8, value: 'text-3xl', suffix: 'text-xs', label: 'text-xs' },
  lg: { px: 168, stroke: 10, value: 'text-5xl', suffix: 'text-sm', label: 'text-sm' },
}

/** True when the OS asks for reduced motion. Read once per mount. */
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Circular score gauge.
 *
 * The arc sweeps from empty to `value` on mount and the number counts up to
 * match; both are skipped when the OS asks for reduced motion. Colour is
 * derived from the score (green > 75, amber 50-75, red < 50) but never carries
 * meaning on its own - the number is always present, and the ring exposes
 * progressbar semantics with a text label.
 */
export default function ScoreRing({
  value = 0,
  max = 100,
  size = 'md',
  label,
  showSuffix = true,
  animate = true,
  className,
  ...props
}) {
  const { px, stroke, value: valueClass, suffix, label: labelClass } =
    SIZES[size] ?? SIZES.md

  const hasScore = value !== null && value !== undefined && !Number.isNaN(value)
  const clamped = hasScore ? Math.min(Math.max(value, 0), max) : 0
  const pct = max > 0 ? (clamped / max) * 100 : 0
  const tone = scoreTone(hasScore ? (clamped / max) * 100 : null)

  const radius = (px - stroke) / 2
  const circumference = 2 * Math.PI * radius

  // Read once at mount via a lazy initialiser: matchMedia must not be called
  // during every render, and the value cannot change mid-animation.
  const [reducedMotion] = useState(prefersReducedMotion)
  const shouldAnimate = animate && !reducedMotion

  // Start empty, then flip to the real offset after mount so the CSS
  // transition on stroke-dashoffset has something to animate between. When not
  // animating these are unused and the values are derived from props instead.
  const [progress, setProgress] = useState(0)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!shouldAnimate) return undefined
    const raf = requestAnimationFrame(() => setProgress(pct))

    // Count the number up on the same 1s curve as the arc.
    const duration = 1000
    const start = performance.now()
    let frame = 0
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1)
      // easeOutExpo, matching the stroke transition.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      setDisplay(Math.round(clamped * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(frame)
    }
  }, [pct, clamped, shouldAnimate])

  // Derived, not stored, when animation is off - nothing to synchronise.
  const shownPct = shouldAnimate ? progress : pct
  const shownValue = shouldAnimate ? display : Math.round(clamped)
  const offset = circumference - (shownPct / 100) * circumference
  const accessibleLabel = label
    ? `${label}: ${hasScore ? Math.round(clamped) : 'not scored'}${hasScore ? ` out of ${max}` : ''}`
    : hasScore
      ? `Score ${Math.round(clamped)} out of ${max}`
      : 'Not yet scored'

  return (
    <div
      className={cn('score-ring', className)}
      style={{ '--ring-size': `${px}px`, '--ring-stroke': `${stroke}px` }}
      role="progressbar"
      aria-valuenow={hasScore ? Math.round(clamped) : undefined}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={accessibleLabel}
      {...props}
    >
      <svg viewBox={`0 0 ${px} ${px}`} aria-hidden="true" focusable="false">
        <circle
          className="score-ring__track"
          cx={px / 2}
          cy={px / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="score-ring__value"
          cx={px / 2}
          cy={px / 2}
          r={radius}
          strokeWidth={stroke}
          stroke={TONE_HEX[tone]}
          style={{
            '--dash-array': circumference,
            '--dash-offset': offset,
            filter: hasScore ? `drop-shadow(0 0 6px ${TONE_HEX[tone]}66)` : 'none',
          }}
        />
      </svg>

      <div className="score-ring__label">
        {/* w-[86%] resolves against the ring box, not the shrink-wrapped grid
            item, so labels get the full width instead of truncating early. */}
        <div className="flex w-[86%] flex-col items-center">
          <div className="flex items-baseline">
            <span
              className={cn(
                'font-mono font-bold tabular-nums',
                valueClass,
                hasScore ? TONE_TEXT[tone] : 'text-aria-muted',
              )}
            >
              {hasScore ? shownValue : '--'}
            </span>
            {showSuffix && hasScore ? (
              <span className={cn('ml-0.5 font-mono text-aria-muted', suffix)}>%</span>
            ) : null}
          </div>
          {label ? (
            <span
              className={cn(
                'mt-1 w-full px-0.5 text-center leading-tight text-aria-muted',
                labelClass,
              )}
            >
              {label}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
