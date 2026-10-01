// Tab-switch tracking for an interview in progress.
//
// A real interview is one continuous conversation. Leaving the tab mid-answer
// is worth recording - but the record is descriptive, not accusatory: someone
// may have taken a call or had a notification steal focus. The UI says how
// long and how often, never why.

import { useCallback, useEffect, useRef, useState } from 'react'

// Below this, a switch is a flicker (an OS notification stealing focus, an
// alt-tab that bounced straight back) and is not worth reporting.
const MIN_SWITCH_MS = 700
// Escalation thresholds, by count or by total time away.
const WARNING_AFTER = 1
const CRITICAL_AFTER = 3
const CRITICAL_TOTAL_MS = 60_000

export const WARNING_LEVEL = { NONE: 'none', WARNING: 'warning', CRITICAL: 'critical' }

export default function useProctoring({ enabled = true } = {}) {
  const [switches, setSwitches] = useState([]) // {at, durationMs}
  const [isHidden, setIsHidden] = useState(false)
  // Set when the candidate comes back, so the overlay can report that trip.
  const [lastReturn, setLastReturn] = useState(null)

  const hiddenSinceRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now()
        setIsHidden(true)
        return
      }
      setIsHidden(false)
      const since = hiddenSinceRef.current
      hiddenSinceRef.current = null
      if (!since) return
      const durationMs = Date.now() - since
      if (durationMs < MIN_SWITCH_MS) return
      const entry = { at: new Date(since).toISOString(), durationMs }
      setSwitches((list) => [...list, entry])
      setLastReturn(entry)
    }

    // blur/focus catches switching to another application, which does not
    // always fire visibilitychange on every platform.
    const onBlur = () => {
      if (document.visibilityState === 'visible' && hiddenSinceRef.current === null) {
        hiddenSinceRef.current = Date.now()
      }
    }
    const onFocus = () => {
      if (document.visibilityState === 'visible') onVisibility()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled])

  const totalAwayMs = switches.reduce((sum, s) => sum + s.durationMs, 0)

  let level = WARNING_LEVEL.NONE
  if (switches.length >= CRITICAL_AFTER || totalAwayMs >= CRITICAL_TOTAL_MS) {
    level = WARNING_LEVEL.CRITICAL
  } else if (switches.length >= WARNING_AFTER) {
    level = WARNING_LEVEL.WARNING
  }

  /** Dismiss the return overlay without clearing the record. */
  const acknowledge = useCallback(() => setLastReturn(null), [])

  const reset = useCallback(() => {
    hiddenSinceRef.current = null
    setSwitches([])
    setLastReturn(null)
  }, [])

  return {
    switches,
    switchCount: switches.length,
    totalAwayMs,
    level,
    isHidden,
    lastReturn,
    acknowledge,
    reset,
  }
}

/**
 * Collapse proctoring signals into one 0-100 integrity score.
 *
 * Deliberately generous: this measures focus, not honesty, and an interview
 * should never be branded on weak evidence. Everything here is a deduction
 * from 100 with a hard floor, and the inputs are reported alongside so a
 * reader can disagree with the arithmetic.
 */
export function calculateIntegrityScore({
  switchCount = 0,
  totalAwayMs = 0,
  suspiciousEvents = 0,
  attentionRate = null,
} = {}) {
  let score = 100

  // Tab switches: the first is cheap, repeats are not. Stepping on the first
  // one matters - briefly losing focus once is ordinary, and labelling that
  // "needs review" would make the whole signal untrustworthy.
  if (switchCount > 0) score -= Math.min(30, 6 + (switchCount - 1) * 12)
  // Time away, at 1 point per 5 seconds.
  score -= Math.min(20, (totalAwayMs / 1000) * 0.2)
  // Sustained looks away from the screen.
  score -= Math.min(25, suspiciousEvents * 8)
  // Overall attention, only when it was actually measured.
  if (attentionRate !== null && attentionRate < 0.8) {
    score -= Math.min(25, (0.8 - attentionRate) * 100)
  }

  return Math.max(0, Math.round(score))
}

/** Plain-language band for a score, for badges and summaries. */
export function integrityBand(score) {
  if (score == null) return { label: 'Not measured', tone: 'muted' }
  if (score >= 90) return { label: 'Clean', tone: 'green' }
  if (score >= 70) return { label: 'Minor flags', tone: 'amber' }
  return { label: 'Needs review', tone: 'red' }
}
