// How a recruiter would have read this interview.
//
// The shortlist verdict is the point: it is the judgement a real screen ends
// with, and seeing it on a practice run is far cheaper than learning it from
// silence after a real one. It is framed as one reviewer's read of these
// answers, not a verdict on the candidate.

import { Briefcase, Check, Quote, ThumbsDown, ThumbsUp, X } from 'lucide-react'

import { Card, cn } from '../ui'

const STANDING = {
  'above average': { label: 'Above average', cls: 'text-aria-green' },
  average: { label: 'About average', cls: 'text-aria-amber' },
  'below average': { label: 'Below average', cls: 'text-aria-red' },
}

export default function RecruiterReplay({ data, className }) {
  if (!data?.first_impression) return null

  const yes = data.would_shortlist === true
  const decided = data.would_shortlist !== null && data.would_shortlist !== undefined
  const standing = STANDING[data.compared_to_typical_candidates ?? '']

  return (
    <Card padding="lg" className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-aria-blue/10 text-aria-blue">
            <Briefcase className="h-4 w-4" aria-hidden="true" />
          </span>
          Recruiter&apos;s Take
        </h2>
        {standing ? (
          <span className="text-xs text-aria-muted">
            Against typical candidates:{' '}
            <span className={cn('font-semibold', standing.cls)}>{standing.label}</span>
          </span>
        ) : null}
      </div>

      {/* Gut reaction, given the weight it carries in a real screen. */}
      <blockquote className="flex gap-3 border-l-2 border-aria-blue/50 pl-4">
        <Quote className="mt-1 h-4 w-4 shrink-0 text-aria-muted" aria-hidden="true" />
        <p className="font-display text-lg italic leading-relaxed text-aria-text">
          {data.first_impression}
        </p>
      </blockquote>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-aria-green">
            <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
            What I noticed
          </p>
          <ul className="space-y-2">
            {(data.strengths_noticed ?? []).map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-aria-green/30 bg-aria-green/5 p-2.5 text-sm text-aria-text"
              >
                <Check
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aria-green"
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-aria-red">
            <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
            What worried me
          </p>
          <ul className="space-y-2">
            {(data.concerns ?? []).map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-aria-red/30 bg-aria-red/5 p-2.5 text-sm text-aria-text"
              >
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aria-red" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {decided ? (
        <div
          className={cn(
            'mt-5 rounded-xl border p-4',
            yes
              ? 'border-aria-green/45 bg-aria-green/10'
              : 'border-aria-red/45 bg-aria-red/10',
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-aria-muted">
              Would shortlist
            </span>
            <span
              className={cn(
                'font-display text-2xl font-bold',
                yes ? 'text-aria-green' : 'text-aria-red',
              )}
            >
              {yes ? 'YES' : 'NO'}
            </span>
          </div>
          {data.shortlist_reasoning ? (
            <p className="mt-1.5 text-sm leading-relaxed text-aria-text">
              {data.shortlist_reasoning}
            </p>
          ) : null}
        </div>
      ) : null}

      {data.what_would_change_my_mind ? (
        <div className="mt-3 rounded-xl border border-aria-amber/40 bg-aria-amber/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-aria-amber">
            What would change my mind
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-aria-text">
            {data.what_would_change_my_mind}
          </p>
        </div>
      ) : null}

      {data.advice_to_candidate ? (
        <p className="mt-4 border-l-2 border-aria-border pl-4 text-sm italic leading-relaxed text-aria-text">
          “{data.advice_to_candidate}”
        </p>
      ) : null}

      <p className="mt-4 text-xs text-aria-muted">
        One reviewer&apos;s read of these answers on this day — not a verdict on
        you. Two recruiters often disagree.
      </p>
    </Card>
  )
}
