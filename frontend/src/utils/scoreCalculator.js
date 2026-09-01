// Optimistic, client-side scoring shown the instant an answer ends, before the
// server's real scores arrive. Mirrors the arithmetic in
// backend/app/services/filler_service.py so the numbers do not visibly jump
// when the authoritative result replaces them.

import { detectFillers } from './fillerDetector'

export const TARGET_WPM = 140

export const SCORE_THRESHOLDS = { good: 75, fair: 50 }

/** Words per minute. 0 when the duration is unusable. */
export function calculateWpm(transcript, durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return 0
  const words = (transcript || '').split(/\s+/).filter(Boolean).length
  if (!words) return 0
  return Math.round((words / (durationSeconds / 60)) * 10) / 10
}

/**
 * Delivery confidence, 0-100. Same formula as the backend, including the
 * clamp at both ends - the length bonus can otherwise exceed 100.
 */
export function calculateConfidence(fillerCount, wpm, answerLength) {
  const fillerPenalty = Math.min(fillerCount * 4, 40)
  const wpmPenalty = wpm > 0 ? Math.max(0, Math.abs(wpm - TARGET_WPM) * 0.15) : 20
  const lengthBonus = Math.min(10, Math.max(0, (answerLength - 50) * 0.1))
  const score = 100 - fillerPenalty - wpmPenalty + lengthBonus
  return Math.round(Math.min(100, Math.max(0, score)) * 10) / 10
}

/** 100 for clean speech, falling as filler density rises. */
export function calculateFillerScore(fillerCount, wordCount) {
  if (!wordCount) return 0
  const ratio = fillerCount / wordCount
  return Math.round(Math.min(100, Math.max(0, 100 - ratio * 1250)) * 10) / 10
}

/**
 * Approximate scores for one answer, computed locally.
 *
 * `answer_score` is deliberately capped at 75 and flagged `isProvisional`:
 * nothing on the client can judge whether an answer was *correct*, only how it
 * was delivered. Presenting a local 90 that the server then corrects to 40
 * would be worse than showing a cautious estimate.
 *
 * @returns {{answer_score:number, communication_score:number, confidence_score:number,
 *            filler_score:number, overall_score:number, wpm:number, word_count:number,
 *            filler_count:number, isProvisional:boolean}}
 */
export function calculateLocalScores(transcript, duration, fillerCount) {
  const text = transcript || ''
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const fillers =
    typeof fillerCount === 'number' ? fillerCount : detectFillers(text).count

  const wpm = calculateWpm(text, duration)
  const confidence = calculateConfidence(fillers, wpm, wordCount)
  const filler = calculateFillerScore(fillers, wordCount)

  // Length as a rough proxy for substance: ~120 words is a full answer.
  const answer = Math.round(Math.min(75, (wordCount / 120) * 75) * 10) / 10
  const communication = Math.round(((confidence + filler) / 2) * 10) / 10

  const overall =
    Math.round((answer * 0.5 + communication * 0.2 + confidence * 0.15 + filler * 0.15) * 10) / 10

  return {
    answer_score: answer,
    communication_score: communication,
    confidence_score: confidence,
    filler_score: filler,
    overall_score: overall,
    wpm,
    word_count: wordCount,
    filler_count: fillers,
    isProvisional: true,
  }
}

/** Tone key for a score, matching the design system's thresholds. */
export function scoreTone(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'muted'
  if (value > SCORE_THRESHOLDS.good) return 'green'
  if (value >= SCORE_THRESHOLDS.fair) return 'amber'
  return 'red'
}
