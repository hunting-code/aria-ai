import cn from './cn'

const SIZES = {
  sm: { dot: 'h-1.5 w-1.5', gap: 'gap-1' },
  md: { dot: 'h-2.5 w-2.5', gap: 'gap-1.5' },
  lg: { dot: 'h-3.5 w-3.5', gap: 'gap-2' },
}

/**
 * Three cyan dots pulsing in sequence - ARIA's "thinking" state.
 *
 * Announced politely via role="status"; the visible dots are hidden from the
 * accessibility tree so only the label is read out.
 */
export default function LoadingSpinner({
  size = 'md',
  label = 'Loading',
  showLabel = false,
  className,
  ...props
}) {
  const { dot, gap } = SIZES[size] ?? SIZES.md

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center', showLabel ? 'gap-3' : '', className)}
      {...props}
    >
      <span className={cn('inline-flex items-center', gap)} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('animate-pulse-dot rounded-full bg-aria-pulse', dot)}
            // Stagger so the dots read as a travelling pulse, not a blink.
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      {showLabel ? (
        <span className="font-mono text-sm text-aria-muted">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  )
}
