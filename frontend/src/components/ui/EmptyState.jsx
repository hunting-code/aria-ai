import cn from './cn'

/**
 * CSS-drawn empty-state illustrations. No image assets: these scale, theme
 * with the palette, and cost nothing to load.
 */
function Art({ variant }) {
  if (variant === 'chart') {
    return (
      <div className="relative mx-auto flex h-24 w-40 items-end justify-center gap-1.5" aria-hidden="true">
        <div className="absolute inset-x-0 bottom-0 h-px bg-aria-border" />
        {[26, 40, 34, 56, 70, 88].map((h, i) => (
          <div
            key={i}
            className="w-4 animate-slide-up rounded-t bg-gradient-to-t from-aria-blue/20 to-aria-pulse/60"
            style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }}
          />
        ))}
      </div>
    )
  }

  if (variant === 'search') {
    return (
      <div className="relative mx-auto h-24 w-24" aria-hidden="true">
        <div className="absolute left-3 top-3 h-14 w-14 rounded-full border-2 border-aria-border" />
        <div className="absolute left-[3.6rem] top-[3.6rem] h-6 w-1 rotate-45 rounded-full bg-aria-border" />
        <div className="absolute left-6 top-8 h-1.5 w-8 rounded-full bg-aria-border/70" />
        <div className="absolute left-6 top-11 h-1.5 w-5 rounded-full bg-aria-border/50" />
      </div>
    )
  }

  if (variant === 'mic') {
    return (
      <div className="relative mx-auto h-24 w-24" aria-hidden="true">
        <div className="absolute left-1/2 top-3 h-10 w-6 -translate-x-1/2 rounded-full border-2 border-aria-border" />
        <div className="absolute left-1/2 top-[3.4rem] h-4 w-10 -translate-x-1/2 rounded-b-full border-x-2 border-b-2 border-aria-border" />
        <div className="absolute left-1/2 top-[4.6rem] h-4 w-0.5 -translate-x-1/2 bg-aria-border" />
        <div className="absolute inset-0 animate-pulse-glow rounded-full" />
      </div>
    )
  }

  // Default: a stack of document cards.
  return (
    <div className="relative mx-auto h-24 w-24" aria-hidden="true">
      <div className="absolute left-2 top-4 h-16 w-12 -rotate-6 rounded-md border border-aria-border bg-aria-surface/70" />
      <div className="absolute left-6 top-2 h-16 w-12 rotate-3 rounded-md border border-aria-border bg-aria-surface" />
      <div className="absolute left-9 top-6 h-1 w-6 rounded-full bg-aria-border" />
      <div className="absolute left-9 top-9 h-1 w-5 rounded-full bg-aria-border" />
      <div className="absolute left-9 top-12 h-1 w-6 rounded-full bg-aria-border" />
    </div>
  )
}

export default function EmptyState({
  variant = 'documents',
  title,
  description,
  action,
  className,
}) {
  return (
    <div className={cn('py-10 text-center', className)}>
      <Art variant={variant} />
      {title ? <p className="mt-5 font-medium text-aria-text">{title}</p> : null}
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-aria-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}
