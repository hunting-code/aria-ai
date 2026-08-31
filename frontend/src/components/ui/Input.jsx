import { forwardRef, useId } from 'react'

import cn from './cn'

const SIZES = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-13 px-5 text-base',
}

/**
 * Dark-theme text field with label, hint and error states.
 *
 * Wires up id/label/aria-describedby automatically, so the hint and the error
 * are both announced when the field takes focus. `error` also sets
 * aria-invalid, which is what screen readers use to flag the field - colour
 * alone would not communicate it.
 */
const Input = forwardRef(function Input(
  {
    label,
    error,
    hint,
    id,
    size = 'md',
    type = 'text',
    leftIcon = null,
    rightElement = null,
    required = false,
    className,
    containerClassName,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('w-full', containerClassName)}>
      {label ? (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-sm font-medium text-aria-text"
        >
          {label}
          {required ? (
            <>
              <span aria-hidden="true" className="ml-0.5 text-aria-red">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          ) : null}
        </label>
      ) : null}

      <div className="relative">
        {leftIcon ? (
          <span
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-aria-muted"
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        ) : null}

        <input
          ref={ref}
          id={inputId}
          type={type}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full rounded-lg border bg-aria-surface/70 text-aria-text',
            'placeholder:text-aria-muted/70',
            'transition-colors duration-200',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            'disabled:cursor-not-allowed disabled:opacity-50',
            // 16px on mobile stops iOS Safari zooming the viewport on focus.
            'text-base sm:text-sm',
            SIZES[size] ?? SIZES.md,
            leftIcon && 'pl-10',
            rightElement && 'pr-10',
            error
              ? 'border-aria-red focus:border-aria-red focus:ring-aria-red/40'
              : 'border-aria-border focus:border-aria-blue focus:ring-aria-blue/50',
            className,
          )}
          {...props}
        />

        {rightElement ? (
          <span className="absolute inset-y-0 right-0 flex items-center pr-3">
            {rightElement}
          </span>
        ) : null}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-aria-red">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-sm text-aria-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
})

export default Input
