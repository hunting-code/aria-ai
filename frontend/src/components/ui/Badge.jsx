import cn from './cn'

// Session lifecycle -> presentation. Keys match the backend's status strings
// as well as the labels used in the UI, so either can be passed straight in.
const STATUS = {
  completed: { label: 'Completed', variant: 'green' },
  active: { label: 'In Progress', variant: 'blue' },
  in_progress: { label: 'In Progress', variant: 'blue' },
  'in progress': { label: 'In Progress', variant: 'blue' },
  pending: { label: 'Pending', variant: 'muted' },
  abandoned: { label: 'Abandoned', variant: 'red' },
  failed: { label: 'Failed', variant: 'red' },
}

const VARIANTS = {
  green: 'border-aria-green/30 bg-aria-green/10 text-aria-green',
  blue: 'border-aria-blue/40 bg-aria-blue/10 text-aria-pulse',
  amber: 'border-aria-amber/30 bg-aria-amber/10 text-aria-amber',
  red: 'border-aria-red/30 bg-aria-red/10 text-aria-red',
  muted: 'border-aria-border bg-aria-surface text-aria-muted',
}

const DOT = {
  green: 'bg-aria-green',
  blue: 'bg-aria-pulse',
  amber: 'bg-aria-amber',
  red: 'bg-aria-red',
  muted: 'bg-aria-muted',
}

const SIZES = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
}

/**
 * Status pill.
 *
 * Pass `status` for the known session states, or `variant` + children for a
 * free-form label. The dot pulses only for in-progress states, which is the
 * one case where something is actually still happening.
 */
export default function Badge({
  children,
  status,
  variant,
  size = 'md',
  withDot = true,
  className,
  ...props
}) {
  const preset = status ? STATUS[String(status).toLowerCase()] : undefined
  const tone = variant ?? preset?.variant ?? 'muted'
  const label = children ?? preset?.label ?? status ?? ''
  const isLive = tone === 'blue' && !children

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium',
        VARIANTS[tone] ?? VARIANTS.muted,
        SIZES[size] ?? SIZES.md,
        className,
      )}
      {...props}
    >
      {withDot ? (
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            DOT[tone] ?? DOT.muted,
            isLive && 'animate-pulse-glow',
          )}
        />
      ) : null}
      {label}
    </span>
  )
}
