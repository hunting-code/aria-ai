// Shared score -> colour thresholds, so the ring, the bar and any future
// readout can never disagree about what "a good score" looks like.
//   > 75  green   |  50-75  amber  |  < 50  red
export const SCORE_THRESHOLDS = { good: 75, fair: 50 }

export function scoreTone(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'muted'
  if (value > SCORE_THRESHOLDS.good) return 'green'
  if (value >= SCORE_THRESHOLDS.fair) return 'amber'
  return 'red'
}

export const TONE_HEX = {
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  blue: '#2D7DD2',
  pulse: '#00D4FF',
  muted: '#6B7A99',
}

export const TONE_TEXT = {
  green: 'text-aria-green',
  amber: 'text-aria-amber',
  red: 'text-aria-red',
  blue: 'text-aria-blue',
  pulse: 'text-aria-pulse',
  muted: 'text-aria-muted',
}

export const TONE_BG = {
  green: 'bg-aria-green',
  amber: 'bg-aria-amber',
  red: 'bg-aria-red',
  blue: 'bg-aria-blue',
  pulse: 'bg-aria-pulse',
  muted: 'bg-aria-muted',
}
