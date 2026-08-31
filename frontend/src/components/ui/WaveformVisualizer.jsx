import cn from './cn'

// Per-bar heights when idle and the animation timing offsets when live.
// The centre bar is tallest so the resting state reads as a waveform at rest
// rather than a flat progress bar.
const BAR_PROFILE = [
  { rest: 0.28, delay: 0, duration: 0.9 },
  { rest: 0.45, delay: 0.12, duration: 0.75 },
  { rest: 0.62, delay: 0.24, duration: 0.85 },
  { rest: 0.85, delay: 0.06, duration: 0.7 },
  { rest: 0.62, delay: 0.3, duration: 0.8 },
  { rest: 0.45, delay: 0.18, duration: 0.9 },
  { rest: 0.28, delay: 0.36, duration: 0.75 },
]

const SIZES = {
  sm: { height: 'h-8', width: 'w-1', gap: 'gap-1' },
  md: { height: 'h-14', width: 'w-1.5', gap: 'gap-1.5' },
  lg: { height: 'h-24', width: 'w-2', gap: 'gap-2' },
}

/**
 * Seven-bar audio waveform.
 *
 * Bars pulse on a staggered loop while `isActive` (microphone live) and settle
 * to a static resting profile when it is not. Decorative: the state is carried
 * for assistive tech by the status text, not by the bars.
 */
export default function WaveformVisualizer({
  isActive = false,
  size = 'md',
  bars = BAR_PROFILE,
  label,
  className,
  ...props
}) {
  const { height, width, gap } = SIZES[size] ?? SIZES.md
  const statusText = label ?? (isActive ? 'Microphone active, recording' : 'Microphone idle')

  return (
    <div
      className={cn('inline-flex flex-col items-center gap-2', className)}
      {...props}
    >
      <div
        className={cn('flex items-center justify-center', height, gap)}
        aria-hidden="true"
      >
        {bars.map((bar, i) => (
          <span
            key={i}
            className={cn(
              'h-full origin-center rounded-full transition-colors duration-300',
              width,
              isActive
                ? 'animate-waveform bg-aria-gradient shadow-glow-sm'
                : 'bg-aria-border',
            )}
            style={
              isActive
                ? {
                    animationDelay: `${bar.delay}s`,
                    animationDuration: `${bar.duration}s`,
                  }
                : // Idle: no animation, just a fixed silhouette.
                  { transform: `scaleY(${bar.rest})` }
            }
          />
        ))}
      </div>
      {/* Announced on change so a screen reader user knows the mic went live. */}
      <span role="status" aria-live="polite" className="sr-only">
        {statusText}
      </span>
    </div>
  )
}
