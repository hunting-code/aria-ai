import { forwardRef } from 'react'

import cn from './cn'

const BASE =
  'relative inline-flex items-center justify-center gap-2 rounded-lg font-medium ' +
  'transition-all duration-200 ease-out-expo select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-aria-void ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none'

const VARIANTS = {
  primary:
    'bg-aria-gradient text-white shadow-glow-blue ' +
    'hover:brightness-110 hover:shadow-glow active:brightness-95 ' +
    'disabled:hover:brightness-100',
  ghost:
    'bg-transparent text-aria-text hover:bg-white/5 active:bg-white/10 ' +
    'disabled:hover:bg-transparent',
  danger:
    'bg-aria-red text-white hover:bg-aria-red/90 active:bg-aria-red/80 ' +
    'shadow-[0_0_20px_rgba(239,68,68,0.25)] disabled:hover:bg-aria-red',
  outline:
    'border border-aria-border bg-transparent text-aria-text ' +
    'hover:border-aria-blue hover:bg-aria-blue/10 hover:text-white ' +
    'active:bg-aria-blue/20 disabled:hover:border-aria-border disabled:hover:bg-transparent',
}

const SIZES = {
  // min-h keeps every size at or above the 44px touch target on md/lg, and
  // sm stays usable at 36px for dense toolbars.
  sm: 'h-9 min-h-[2.25rem] px-3 text-sm',
  md: 'h-11 min-h-[2.75rem] px-5 text-sm',
  lg: 'h-13 min-h-[3.25rem] px-7 text-base',
}

const SPINNER_SIZE = { sm: 'sm', md: 'sm', lg: 'md' }

/** Inline spinner - separate from LoadingSpinner so it inherits currentColor. */
function ButtonSpinner({ size }) {
  const dot = size === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5'
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn('animate-pulse-dot rounded-full bg-current', dot)}
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  )
}

/**
 * Primary action control.
 *
 * While `isLoading` the button is disabled and marked aria-busy, and the label
 * is kept in the DOM (dimmed) so the button does not change width mid-click.
 */
const Button = forwardRef(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    isLoading = false,
    disabled = false,
    fullWidth = false,
    leftIcon = null,
    rightIcon = null,
    type = 'button',
    className,
    loadingLabel = 'Working',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || isLoading

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      className={cn(
        BASE,
        VARIANTS[variant] ?? VARIANTS.primary,
        SIZES[size] ?? SIZES.md,
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {isLoading && (
        <span className="absolute inset-0 grid place-items-center">
          <ButtonSpinner size={SPINNER_SIZE[size] ?? 'sm'} />
        </span>
      )}
      {/* Kept mounted so the width is stable; hidden from AT while busy. */}
      <span
        className={cn(
          'inline-flex items-center gap-2 transition-opacity',
          isLoading && 'opacity-0',
        )}
      >
        {leftIcon ? <span aria-hidden="true">{leftIcon}</span> : null}
        {children}
        {rightIcon ? <span aria-hidden="true">{rightIcon}</span> : null}
      </span>
      {isLoading ? <span className="sr-only">{loadingLabel}</span> : null}
    </button>
  )
})

export default Button
