import { useId, useState } from 'react'
import { ChevronDown, CornerDownRight, MessageSquare } from 'lucide-react'

import { ProgressBar, cn } from '../ui'
import { scoreTone } from '../ui/scoreColor'
import { highlightFillers } from '../../utils/fillerDetector'

const TONE_TEXT = {
  green: 'text-aria-green',
  amber: 'text-aria-amber',
  red: 'text-aria-red',
  muted: 'text-aria-muted',
}

/**
 * One expandable answer: transcript with fillers marked, the three sub-scores,
 * ARIA's feedback, and the filler tally.
 */
export default function QuestionBreakdown({ answer, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const buttonId = `${panelId}-button`

  const tone = scoreTone(answer.answer_score)
  const fillers = Object.entries(
    (answer.filler_words_detected ?? []).reduce((acc, w) => {
      acc[w] = (acc[w] ?? 0) + 1
      return acc
    }, {}),
  ).sort((a, b) => b[1] - a[1])

  return (
    <div className="glass overflow-hidden rounded-xl">
      <h3>
        <button
          id={buttonId}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-aria-border bg-aria-surface font-mono text-xs text-aria-muted">
            {answer.question_number}
          </span>
          <span className={cn('min-w-0 flex-1', !open && 'truncate')}>
            {answer.is_follow_up || answer.question_tag ? (
              <span className="mr-2 inline-flex flex-wrap gap-1.5 align-middle">
                {answer.is_follow_up ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-aria-amber/40 bg-aria-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-aria-amber">
                    <CornerDownRight className="h-2.5 w-2.5" aria-hidden="true" />
                    Follow-up
                  </span>
                ) : null}
                {answer.question_tag ? (
                  <span className="rounded-full border border-aria-border px-1.5 py-0.5 text-[10px] text-aria-muted">
                    {answer.question_tag}
                  </span>
                ) : null}
              </span>
            ) : null}
            {/* Collapsed rows stay one line so the list scans quickly. */}
            <span className={cn('text-sm text-aria-text', !open && 'align-middle')}>
              {answer.question_text}
            </span>
          </span>
          <span
            className={cn(
              'shrink-0 font-mono text-sm font-bold tabular-nums',
              TONE_TEXT[tone],
            )}
          >
            {answer.answer_score != null ? Math.round(answer.answer_score) : '--'}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-aria-muted transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
      </h3>

      {open ? (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="space-y-4 border-t border-aria-border p-4">
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-aria-muted">
              Your answer
            </p>
            {answer.transcript ? (
              // highlightFillers escapes everything it does not wrap, so a
              // transcript from the speech model cannot inject markup.
              <p
                className="rounded-lg border border-aria-border bg-aria-void/60 p-3 font-mono text-xs leading-relaxed text-aria-text"
                dangerouslySetInnerHTML={{ __html: highlightFillers(answer.transcript) }}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-aria-border p-3 text-xs text-aria-muted">
                No answer was recorded for this question.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <ProgressBar label="Answer" value={answer.answer_score} size="sm" />
            <ProgressBar label="Confidence" value={answer.confidence_score} size="sm" />
            <ProgressBar label="Communication" value={answer.communication_score} size="sm" />
          </div>

          {answer.ai_feedback ? (
            <div className="rounded-lg border border-aria-blue/25 bg-aria-blue/5 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-aria-pulse">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                ARIA&apos;s feedback
              </p>
              <p className="text-sm leading-relaxed text-aria-text">{answer.ai_feedback}</p>
            </div>
          ) : null}

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-aria-muted">
              Filler words ({answer.filler_count ?? 0})
            </p>
            {fillers.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {fillers.map(([word, n]) => (
                  <li
                    key={word}
                    className="rounded-full border border-aria-red/30 bg-aria-red/10 px-2 py-0.5 text-[11px] text-aria-red"
                  >
                    {word}
                    {n > 1 ? <span className="ml-1 font-mono opacity-70">x{n}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-aria-green">None detected.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
