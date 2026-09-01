import { CornerDownRight, MessagesSquare } from 'lucide-react'

import { cn } from '../ui'
import { highlightFillers } from '../../utils/fillerDetector'

/**
 * The interview as a chat transcript.
 *
 * ARIA's questions and feedback sit on the left, the candidate's answers on
 * the right. Filler words stay highlighted inside the bubbles, which is the
 * point: reading your own transcript with the crutches marked is more useful
 * than being told a count.
 */
export default function InterviewReplay({ answers = [], className }) {
  if (!answers.length) {
    return (
      <p className={cn('rounded-xl border border-dashed border-aria-border p-6 text-center text-sm text-aria-muted', className)}>
        No conversation was recorded for this session.
      </p>
    )
  }

  const ordered = [...answers].sort(
    (a, b) =>
      a.question_number - b.question_number ||
      new Date(a.created_at) - new Date(b.created_at),
  )

  return (
    <div className={cn('space-y-4', className)}>
      {ordered.map((answer) => (
        <div key={answer.id} className="space-y-3">
          {/* ARIA asks */}
          <div className="flex gap-2.5">
            <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-aria-gradient text-[10px] font-bold text-white">
              AI
            </span>
            <div className="max-w-[78%] rounded-2xl rounded-tl-sm border border-aria-border bg-aria-surface px-3.5 py-2.5">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] text-aria-muted">
                  Q{answer.question_number}
                </span>
                {answer.is_follow_up ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-aria-amber/40 bg-aria-amber/10 px-1.5 py-0.5 text-[10px] text-aria-amber">
                    <CornerDownRight className="h-2.5 w-2.5" aria-hidden="true" />
                    Follow-up
                  </span>
                ) : null}
                {answer.question_tag ? (
                  <span className="rounded-full border border-aria-border px-1.5 py-0.5 text-[10px] text-aria-muted">
                    {answer.question_tag}
                  </span>
                ) : null}
              </div>
              <p className="text-sm leading-relaxed text-aria-text">{answer.question_text}</p>
            </div>
          </div>

          {/* The candidate answers */}
          <div className="flex justify-end gap-2.5">
            <div className="max-w-[78%] rounded-2xl rounded-tr-sm border border-aria-blue/40 bg-aria-blue/15 px-3.5 py-2.5">
              {answer.transcript ? (
                // highlightFillers escapes everything it does not wrap, so a
                // transcript from the speech model cannot inject markup.
                <p
                  className="text-sm leading-relaxed text-aria-text"
                  dangerouslySetInnerHTML={{ __html: highlightFillers(answer.transcript) }}
                />
              ) : (
                <p className="text-sm italic text-aria-muted">(no answer recorded)</p>
              )}
              {answer.filler_count ? (
                <p className="mt-1.5 text-[10px] text-aria-muted">
                  {answer.filler_count} filler word{answer.filler_count === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>
            <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-aria-border bg-aria-surface text-[10px] font-bold text-aria-muted">
              You
            </span>
          </div>

          {/* ARIA responds */}
          {answer.ai_feedback ? (
            <div className="flex gap-2.5">
              <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-aria-gradient text-[10px] font-bold text-white">
                AI
              </span>
              <div className="max-w-[78%] rounded-2xl rounded-tl-sm border border-aria-border bg-aria-surface/70 px-3.5 py-2.5">
                <p className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-aria-pulse">
                  <MessagesSquare className="h-2.5 w-2.5" aria-hidden="true" />
                  Feedback
                </p>
                <p className="text-sm leading-relaxed text-aria-text">{answer.ai_feedback}</p>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
