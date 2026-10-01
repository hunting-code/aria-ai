import { AudioLines, BarChart3, Sparkles } from 'lucide-react'

import cn from './cn'
import { AriaLogo } from './Navbar'

const BAR_COUNT = 20

// Silhouette is two sine components multiplied: a centre-weighted envelope so
// the wave reads as a single utterance rather than a bar chart, and a finer
// ripple so no two neighbours match. Computed once at module load.
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const t = i / (BAR_COUNT - 1)
  const envelope = 0.32 + 0.68 * Math.sin(t * Math.PI) // tall in the middle
  const ripple = 0.78 + 0.22 * Math.sin(t * Math.PI * 5)
  return {
    height: Math.max(8, Math.round(envelope * ripple * 100)),
    // Negative delay starts each bar part-way through its cycle, so the wave is
    // already travelling on first paint instead of every bar rising in unison.
    delay: -(i * 0.13).toFixed(2),
    duration: (1.5 + 0.55 * Math.sin(t * Math.PI * 2 + 1)).toFixed(2),
  }
})

/**
 * The 20-bar hero waveform.
 *
 * Bars scale from their centre, mirroring a real audio meter. Under
 * prefers-reduced-motion the global stylesheet freezes the animation and the
 * static silhouette remains, which is why each bar carries a real height
 * rather than relying on the animation for its shape.
 */
export default function WaveformHero({ className }) {
  return (
    <div
      className={cn('relative flex h-40 items-center justify-center gap-1.5 sm:h-52 sm:gap-2', className)}
      aria-hidden="true"
    >
      {/* Soft bloom behind the bars so they read as emitting light. */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(245,166,35,0.16),transparent_70%)] blur-xl" />

      {BARS.map((bar, i) => (
        <span
          key={i}
          className="w-1.5 origin-center animate-waveform rounded-full bg-gradient-to-b from-aria-pulse via-aria-blue to-aria-pulse/40 sm:w-2"
          style={{
            height: `${bar.height}%`,
            animationDelay: `${bar.delay}s`,
            animationDuration: `${bar.duration}s`,
            boxShadow: '0 0 12px rgba(245,166,35,0.35)',
          }}
        />
      ))}

      {/* Baseline the wave sits on. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-aria-pulse/30 to-transparent" />
    </div>
  )
}

const FEATURES = [
  {
    icon: Sparkles,
    title: 'Adaptive questioning',
    body: 'Questions follow your answers, tuned to the role and difficulty you pick.',
  },
  {
    icon: AudioLines,
    title: 'Live speech analysis',
    body: 'Filler words, pace and confidence, measured while you speak.',
  },
  {
    icon: BarChart3,
    title: 'Scorecards that explain',
    body: 'A breakdown per answer, plus a report you can take away.',
  },
]

/** Left-hand branding panel shared by the login and register screens. */
export function BrandPanel() {
  return (
    <div className="flex w-full max-w-lg flex-col justify-center">
      <AriaLogo className="mb-8 scale-125 origin-left" />

      <WaveformHero className="mb-10" />

      <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
        Practice Smarter.
        <br />
        <span className="text-gradient">Interview Better.</span>
      </h1>

      <ul className="mt-8 space-y-5">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-4">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-aria-border bg-aria-surface/70">
              <Icon className="h-5 w-5 text-aria-pulse" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-sm font-semibold text-aria-text">{title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-aria-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
