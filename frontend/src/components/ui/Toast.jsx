import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

import useToast from '../../store/toastStore'
import cn from './cn'

const TONES = {
  success: { icon: CheckCircle2, ring: 'border-aria-green/40', text: 'text-aria-green' },
  error: { icon: AlertCircle, ring: 'border-aria-red/40', text: 'text-aria-red' },
  info: { icon: Info, ring: 'border-aria-blue/40', text: 'text-aria-pulse' },
}

function Toast({ toast }) {
  const dismiss = useToast((s) => s.dismiss)
  const { icon: Icon, ring, text } = TONES[toast.tone] ?? TONES.info

  useEffect(() => {
    if (!toast.duration) return undefined
    const timer = setTimeout(() => dismiss(toast.id), toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, dismiss])

  return (
    <div
      className={cn(
        'glass pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-4',
        'animate-slide-up shadow-surface',
        ring,
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', text)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-aria-text">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-sm text-aria-muted">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 rounded-md p-1 text-aria-muted transition-colors hover:bg-white/5 hover:text-aria-text"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/** Mount once, near the root. */
export default function Toaster() {
  const toasts = useToast((s) => s.toasts)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:top-16 sm:max-w-sm sm:items-end"
      role="region"
      aria-label="Notifications"
    >
      {/* Polite: a toast should never interrupt what a screen reader is saying. */}
      <div className="sr-only" role="status" aria-live="polite">
        {toasts.map((t) => `${t.title}. ${t.description ?? ''}`).join(' ')}
      </div>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
