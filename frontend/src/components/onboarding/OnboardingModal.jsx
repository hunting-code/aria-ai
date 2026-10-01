// First-run introduction, shown once on the dashboard.
//
// Deliberately not dismissable by Escape or a backdrop click: it is four short
// steps with a visible way out on the last one, and an accidental Escape would
// skip the explanation without ever offering it again. Every step still has a
// real forward action - nobody is trapped.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight, BarChart3, Check, FileText, Mic, Sparkles, Video, Zap,
} from 'lucide-react'

import { AriaLogo, Button, cn } from '../ui'

export const ONBOARDING_KEY = 'aria_onboarding_done'
// The key this shipped under first. Read so anyone who already finished
// onboarding is not shown it a second time after the rename.
const LEGACY_KEY = 'aria_onboarding_complete'
// Remembers which step they were on, so leaving via "Upload Resume" and coming
// back resumes rather than restarting from the welcome screen.
const STEP_KEY = 'aria_onboarding_step'
const TOTAL_STEPS = 4

/** True when this user has not finished onboarding yet. */
export function shouldShowOnboarding() {
  try {
    return (
      window.localStorage.getItem(ONBOARDING_KEY) !== 'true' &&
      window.localStorage.getItem(LEGACY_KEY) !== 'true'
    )
  } catch {
    // Private mode / blocked storage: never block the dashboard on it.
    return false
  }
}

function readStep() {
  try {
    const n = Number(window.localStorage.getItem(STEP_KEY))
    return Number.isInteger(n) && n >= 1 && n <= TOTAL_STEPS ? n : 1
  } catch {
    return 1
  }
}

function ModeCard({ icon: Icon, name, minutes, points, accent }) {
  return (
    <div className="rounded-xl border border-aria-border bg-aria-surface/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <span
          className="grid h-9 w-9 place-items-center rounded-lg"
          style={{ background: `${accent}1A`, color: accent }}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="rounded-full border border-aria-border px-2 py-0.5 font-mono text-[10px] text-aria-muted">
          {minutes}
        </span>
      </div>
      <h3 className="mt-2.5 font-display text-base font-semibold">{name}</h3>
      <ul className="mt-2 space-y-1.5">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2 text-xs text-aria-muted">
            <Check className="mt-0.5 h-3 w-3 shrink-0" style={{ color: accent }} aria-hidden="true" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function OnboardingModal({ open, onClose, firstName }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(readStep)
  const dialogRef = useRef(null)
  const previouslyFocused = useRef(null)

  const persistStep = useCallback((next) => {
    try {
      window.localStorage.setItem(STEP_KEY, String(next))
    } catch {
      /* progress is a convenience, not a requirement */
    }
  }, [])

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_KEY, 'true')
      window.localStorage.removeItem(STEP_KEY)
      window.localStorage.removeItem(LEGACY_KEY)
    } catch {
      /* if storage fails it will simply be offered again */
    }
    onClose?.()
  }, [onClose])

  const go = useCallback(
    (next) => {
      setStep(next)
      persistStep(next)
    },
    [persistStep],
  )

  // Escape must not dismiss this, and focus must not escape it while it is up.
  useEffect(() => {
    if (!open) return undefined
    previouslyFocused.current = document.activeElement

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    // The page behind must not scroll while this is covering it.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus in, so a keyboard user starts inside the dialog.
    window.setTimeout(() => {
      dialogRef.current?.querySelector('button')?.focus()
    }, 50)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  const STEPS = {
    1: {
      eyebrow: 'Welcome',
      title: `Welcome to ARIA AI${firstName ? `, ${firstName}` : ''}`,
      body: (
        <>
          <div className="mb-4 flex justify-center">
            <AriaLogo className="scale-150" />
          </div>
          <p className="text-sm text-aria-muted">
            A mock interviewer that listens to you answer out loud, then tells you
            what was actually wrong with it.
          </p>
          <ul className="mt-5 space-y-3.5">
            {[
              {
                icon: Mic,
                title: 'Answer out loud, like a real interview',
                text: 'Speak your answers. ARIA transcribes you live and follows up on what you actually said.',
              },
              {
                icon: Sparkles,
                title: 'Honest, specific feedback',
                text: 'Every answer gets a verdict - correct, partly right, or wrong - with the gap named precisely.',
              },
              {
                icon: BarChart3,
                title: 'Delivery measured, not guessed',
                text: 'Filler words, pace and confidence are tracked while you speak, then scored per answer.',
              },
            ].map((row) => (
              <li key={row.title} className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-aria-blue/10 text-aria-blue">
                  <row.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-aria-text">{row.title}</p>
                  <p className="mt-0.5 text-xs text-aria-muted">{row.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      ),
      actions: (
        <Button fullWidth size="lg" onClick={() => go(2)} rightIcon={<ArrowRight className="h-4 w-4" />}>
          Get Started
        </Button>
      ),
    },

    2: {
      eyebrow: 'Step 2 of 4',
      title: 'Upload your resume',
      body: (
        <>
          <p className="text-sm text-aria-muted">
            Optional, but it changes the interview completely.
          </p>
          <div className="mt-5 rounded-xl border border-aria-border bg-aria-surface/60 p-4">
            <p className="text-sm text-aria-text">
              With a resume, ARIA asks about <em>your</em> work by name - the projects
              you shipped, the tools you listed, the gaps worth probing. Without one,
              you get solid questions for the role, just generic ones.
            </p>
            <p className="mt-3 text-xs text-aria-muted">
              Your resume is read once for its text, scored, and never shared. The
              file itself is not stored.
            </p>
          </div>
        </>
      ),
      actions: (
        <div className="space-y-3">
          <Button
            fullWidth
            size="lg"
            onClick={() => {
              // Resume at step 3 when they come back from the resume page.
              go(3)
              navigate('/resume')
            }}
            leftIcon={<FileText className="h-4 w-4" />}
          >
            Upload Resume
          </Button>
          <button
            type="button"
            onClick={() => go(3)}
            className="w-full rounded-lg py-1.5 text-sm text-aria-muted transition-colors hover:text-aria-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse"
          >
            Skip for now
          </button>
        </div>
      ),
    },

    3: {
      eyebrow: 'Step 3 of 4',
      title: 'Choose how you want to practice',
      body: (
        <>
          <p className="text-sm text-aria-muted">
            Two modes. You pick each time you start.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <ModeCard
              icon={Zap}
              name="Quick Practice"
              minutes="10-15 min"
              accent="#1A6FD4"
              points={[
                'Straight into questions',
                'Feedback after every answer',
                'Stop or retry any time',
              ]}
            />
            <ModeCard
              icon={Video}
              name="AI Meet"
              minutes="30-35 min"
              accent="#F5A623"
              points={[
                'Five phases, like a real interview',
                'Camera on, ARIA speaks aloud',
                'Spoken debrief and career report',
              ]}
            />
          </div>
        </>
      ),
      actions: (
        <Button fullWidth size="lg" onClick={() => go(4)} rightIcon={<ArrowRight className="h-4 w-4" />}>
          Got it
        </Button>
      ),
    },

    4: {
      eyebrow: 'Step 4 of 4',
      title: 'Try your first question now?',
      body: (
        <>
          <p className="text-sm text-aria-muted">
            One question takes about two minutes, and it is the fastest way to see
            what the feedback actually looks like.
          </p>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-aria-green/40 bg-aria-green/10 p-4">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-aria-green" aria-hidden="true" />
            <p className="text-sm text-aria-text">
              You are set up. Everything here is also reachable from the sidebar
              whenever you want it.
            </p>
          </div>
        </>
      ),
      actions: (
        <div className="space-y-3">
          <Button
            fullWidth
            size="lg"
            onClick={() => {
              finish()
              navigate('/select-role')
            }}
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            Start Practicing
          </Button>
          <button
            type="button"
            onClick={finish}
            className="w-full rounded-lg py-1.5 text-sm text-aria-muted transition-colors hover:text-aria-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse"
          >
            I&apos;ll explore first
          </button>
        </div>
      ),
    },
  }

  const current = STEPS[step] ?? STEPS[1]

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-aria-void/92 px-4 py-8 backdrop-blur-sm animate-fade-in"
      // No onClick here on purpose: a stray backdrop click must not dismiss it.
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="w-full max-w-lg rounded-2xl border border-aria-border bg-aria-base p-6 shadow-surface sm:p-7"
      >
        {/* Progress */}
        <div className="mb-5 flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300',
                n < step ? 'bg-aria-green' : n === step ? 'bg-aria-blue' : 'bg-aria-border',
              )}
            />
          ))}
        </div>

        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-aria-blue">
          {current.eyebrow}
        </p>
        <h2 id="onboarding-title" className="mt-1.5 font-display text-2xl font-bold tracking-tight">
          {current.title}
        </h2>

        <div className="mt-4">{current.body}</div>

        <div className="mt-6">{current.actions}</div>
      </div>
    </div>
  )
}
