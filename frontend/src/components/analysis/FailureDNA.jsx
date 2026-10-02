// The root cause behind a weak session.
//
// A scorecard says you did badly. This says why - and the distinction matters,
// because "you don't know it" and "you know it but can't say it" need
// completely different work. The tone is deliberately direct but never
// contemptuous: it judges the answers, not the person.

import { AlertCircle, ArrowRight, Lightbulb, Quote, Sparkles } from 'lucide-react'

import { Card, cn } from '../ui'

// Colour carries meaning here, so each mode also keeps its words - a reader who
// cannot distinguish the hues still gets the full signal from the label.
const MODES = {
  KNOWLEDGE_GAP: {
    label: 'Knowledge Gap',
    cls: 'border-aria-red/45 bg-aria-red/10 text-aria-red',
    blurb: "The material itself isn't there yet",
  },
  COMMUNICATION_GAP: {
    label: 'Communication Gap',
    cls: 'border-aria-amber/45 bg-aria-amber/10 text-aria-amber',
    blurb: 'You know it; it is not coming out clearly',
  },
  STRESS_RESPONSE: {
    label: 'Stress Response',
    cls: 'border-[#A855F7]/45 bg-[#A855F7]/10 text-[#A855F7]',
    blurb: 'The knowledge is there until the pressure is on',
  },
  STRUCTURE_FAILURE: {
    label: 'Structure Failure',
    cls: 'border-[#1A6FD4]/45 bg-[#1A6FD4]/10 text-[#1A6FD4]',
    blurb: 'Good ideas arriving in the wrong order',
  },
  CONFIDENCE_DEFICIT: {
    label: 'Confidence Deficit',
    cls: 'border-[#E8842B]/45 bg-[#E8842B]/10 text-[#E8842B]',
    blurb: 'Right answers, hedged into sounding wrong',
  },
  EXAMPLE_POVERTY: {
    label: 'Example Poverty',
    cls: 'border-[#C9A227]/45 bg-[#C9A227]/10 text-[#C9A227]',
    blurb: 'Concepts without the work to back them',
  },
  DEPTH_AVOIDANCE: {
    label: 'Depth Avoidance',
    cls: 'border-aria-muted/50 bg-aria-muted/10 text-aria-muted',
    blurb: 'Staying shallow to stay safe',
  },
}

export default function FailureDNA({ data, className }) {
  // Nothing to show rather than an empty shell: the model declined, or there
  // were no scored answers to reason about.
  if (!data?.primary_failure_mode || !data?.headline) return null

  const mode = MODES[data.primary_failure_mode] ?? MODES.DEPTH_AVOIDANCE
  const confidence =
    typeof data.confidence === 'number' ? Math.round(data.confidence * 100) : null

  return (
    <Card padding="lg" glow className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-aria-blue">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Root cause
        </p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-semibold',
              mode.cls,
            )}
          >
            {mode.label}
          </span>
          {confidence !== null ? (
            <span className="font-mono text-[10px] text-aria-muted">
              {confidence}% confident
            </span>
          ) : null}
        </div>
      </div>

      {/* The line that does the work. */}
      <h2 className="font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
        {data.headline}
      </h2>
      <p className="mt-1.5 text-sm text-aria-muted">{mode.blurb}</p>

      {data.what_this_means ? (
        <p className="mt-4 text-sm leading-relaxed text-aria-text">
          {data.what_this_means}
        </p>
      ) : null}

      {data.evidence?.length ? (
        <div className="mt-5">
          <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-aria-muted">
            What this is based on
          </p>
          <ul className="space-y-2.5">
            {data.evidence.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 rounded-lg border border-aria-border bg-aria-surface/60 p-3"
              >
                <Quote
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aria-muted"
                  aria-hidden="true"
                />
                <span className="text-sm italic leading-relaxed text-aria-text">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {data.good_news ? (
          <div className="rounded-xl border border-aria-green/40 bg-aria-green/10 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-aria-green">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
              The good news
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-aria-text">
              {data.good_news}
            </p>
          </div>
        ) : null}

        {data.fix ? (
          <div className="rounded-xl border border-aria-blue/45 bg-aria-blue/10 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-aria-blue">
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              Work on this first
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-aria-text">{data.fix}</p>
          </div>
        ) : null}
      </div>

      {data.source === 'unavailable' ? (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-aria-muted">
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          Based on too few answers to be confident.
        </p>
      ) : null}
    </Card>
  )
}
