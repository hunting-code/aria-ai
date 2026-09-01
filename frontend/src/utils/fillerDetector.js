// Client-side filler detection, run against the live transcript for instant
// feedback while the server's authoritative pass is still in flight.
//
// The list mirrors backend/app/services/filler_service.py. Change one, change
// the other, or the live count will disagree with the stored score.

export const FILLERS = [
  'um',
  'uh',
  'like',
  'basically',
  'actually',
  'you know',
  'so',
  'right',
  'okay',
  'kind of',
  'sort of',
  'literally',
  'honestly',
  'totally',
  'essentially',
  'obviously',
]

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Longest first so "kind of" and "you know" match as single hits instead of
// leaving a stray word behind. Word boundaries keep "so" out of "sort" and
// "like" out of "likely".
const ORDERED = [...FILLERS].sort(
  (a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length,
)
const PATTERN = new RegExp(`\\b(${ORDERED.map(escapeRegExp).join('|')})\\b`, 'gi')

/**
 * Count filler words in a transcript.
 *
 * @returns {{count: number, words: string[], flaggedWords: Record<string, number>, perMinute: number}}
 */
export function detectFillers(transcript, durationSeconds = 0) {
  const text = transcript || ''
  const words = []
  const flaggedWords = {}

  // Fresh lastIndex each call - PATTERN is global and module-level.
  PATTERN.lastIndex = 0
  let match
  while ((match = PATTERN.exec(text)) !== null) {
    const word = match[0].toLowerCase()
    words.push(word)
    flaggedWords[word] = (flaggedWords[word] ?? 0) + 1
  }

  const perMinute =
    durationSeconds > 0 ? Math.round((words.length / (durationSeconds / 60)) * 10) / 10 : 0

  return { count: words.length, words, flaggedWords, perMinute }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ESCAPES[ch])

/**
 * Wrap each filler word in <mark> for the live transcript display.
 *
 * Returns an HTML string, so it is meant for dangerouslySetInnerHTML - which is
 * exactly why every non-filler character is escaped first. The transcript comes
 * back from a speech model over the network and must never be trusted as markup.
 *
 * @returns {string} HTML with fillers wrapped in <mark class="filler-word">.
 */
export function highlightFillers(transcript) {
  const text = transcript || ''
  let out = ''
  let cursor = 0

  PATTERN.lastIndex = 0
  let match
  while ((match = PATTERN.exec(text)) !== null) {
    out += escapeHtml(text.slice(cursor, match.index))
    out += `<mark class="filler-word">${escapeHtml(match[0])}</mark>`
    cursor = match.index + match[0].length
  }
  out += escapeHtml(text.slice(cursor))
  return out
}

/** Filler words as a share of total words - the density the scores use. */
export function fillerRatio(transcript) {
  const words = (transcript || '').split(/\s+/).filter(Boolean).length
  if (!words) return 0
  return detectFillers(transcript).count / words
}
