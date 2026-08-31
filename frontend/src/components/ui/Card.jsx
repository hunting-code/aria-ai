import cn from './cn'

const PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
}

/**
 * Frosted surface panel.
 *
 * `glow` adds the cyan halo used to mark the active or highlighted card;
 * `interactive` adds hover/focus affordances. When `as="button"` or an onClick
 * is supplied, pass an aria-label so the card has an accessible name.
 */
export default function Card({
  children,
  as: Tag = 'div',
  glow = false,
  interactive = false,
  padding = 'md',
  className,
  ...props
}) {
  return (
    <Tag
      className={cn(
        'glass rounded-xl',
        PADDING[padding] ?? PADDING.md,
        glow && 'glow-border',
        interactive &&
          'cursor-pointer transition-all duration-200 ease-out-expo ' +
            'hover:-translate-y-0.5 hover:border-aria-blue/60 hover:shadow-glow-sm ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse ' +
            'focus-visible:ring-offset-2 focus-visible:ring-offset-aria-void',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {title ? (
          <h3 className="truncate font-display text-lg font-semibold text-aria-text">
            {title}
          </h3>
        ) : null}
        {subtitle ? <p className="mt-1 text-sm text-aria-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
