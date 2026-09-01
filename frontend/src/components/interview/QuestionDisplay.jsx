import { useEffect, useState } from 'react'

import cn from '../ui/cn'

const WORD_DELAY_MS = 55

/**
 * Reveals a question one word at a time.
 *
 * Under prefers-reduced-motion the whole question appears at once - a question
 * that types itself out is precisely the kind of motion that setting asks to
 * suppress, and it also delays a screen reader from seeing the full text.
 */
export default function QuestionDisplay({ question, className }) {
  const [revealed, setRevealed] = useState(0)
  const words = (question || '').split(' ')

  useEffect(() => {
    if (!question) return undefined

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setRevealed(words.length)
      return undefined
    }

    setRevealed(0)
    let i = 0
    const timer = setInterval(() => {
      i += 1
      setRevealed(i)
      if (i >= words.length) clearInterval(timer)
    }, WORD_DELAY_MS)
    return () => clearInterval(timer)
    // Re-run per question, not per word-count change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question])

  return (
    <p
      className={cn(
        'font-display text-xl font-semibold leading-snug tracking-tight text-aria-text sm:text-2xl',
        className,
      )}
      // The full text is always available to assistive tech; only the visual
      // reveal is progressive.
      aria-label={question}
    >
      {words.map((word, i) => (
        <span
          key={`${i}-${word}`}
          aria-hidden="true"
          className={cn(
            'inline-block transition-all duration-300 ease-out-expo',
            i < revealed ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          )}
        >
          {word}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  )
}
