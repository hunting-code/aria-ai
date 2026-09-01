import cn from './cn'

/**
 * Shimmering placeholder. Used instead of a spinner wherever the shape of the
 * incoming content is known, so the layout does not jump when it arrives.
 */
export default function Skeleton({ className, ...props }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-md bg-[length:200%_100%]',
        'bg-gradient-to-r from-aria-surface via-aria-border to-aria-surface',
        className,
      )}
      {...props}
    />
  )
}

/** Card-shaped skeleton matching the session cards. */
export function SessionCardSkeleton() {
  return (
    <div className="glass rounded-xl p-6">
      <div className="mb-3 flex gap-2">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-24" />
      <div className="mt-4 flex gap-4">
        <div className="flex-1 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-2 w-full" />
          ))}
        </div>
        <Skeleton className="h-12 w-12 rounded-lg" />
      </div>
      <div className="mt-4 flex gap-2 border-t border-aria-border pt-3">
        <Skeleton className="h-8 flex-1 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  )
}

/** Full-page skeleton used as the Suspense fallback for lazy routes. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-6 h-64 rounded-xl" />
    </div>
  )
}
