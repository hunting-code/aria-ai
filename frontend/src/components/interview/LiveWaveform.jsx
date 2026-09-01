import { useEffect, useRef } from 'react'

import cn from '../ui/cn'

const BAR_COUNT = 32

/**
 * Waveform driven by the real microphone level.
 *
 * Reads `getLevel()` inside an animation frame and writes bar heights straight
 * to the DOM. Nothing here is React state: at 60fps that would re-render the
 * whole interview screen ~60 times a second for a purely decorative meter.
 */
export default function LiveWaveform({ isActive, getLevel, className }) {
  const barsRef = useRef([])
  const rafRef = useRef(null)
  // Per-bar history so the wave travels outward from the centre instead of
  // every bar moving in lockstep.
  const historyRef = useRef(new Array(BAR_COUNT).fill(0))

  useEffect(() => {
    if (!isActive) {
      historyRef.current = new Array(BAR_COUNT).fill(0)
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.transform = 'scaleY(0.06)'
      })
      return undefined
    }

    const centre = (BAR_COUNT - 1) / 2
    const draw = () => {
      const level = getLevel?.() ?? 0
      const history = historyRef.current
      // Shift outward from the centre, newest sample in the middle.
      for (let i = 0; i < centre; i += 1) {
        history[i] = history[i + 1]
        history[BAR_COUNT - 1 - i] = history[BAR_COUNT - 2 - i]
      }
      history[Math.floor(centre)] = level
      history[Math.ceil(centre)] = level

      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        // Taper the edges so the shape reads as a waveform, not a bar chart.
        const taper = 0.45 + 0.55 * Math.sin((i / (BAR_COUNT - 1)) * Math.PI)
        const scale = Math.max(0.06, Math.min(1, history[i] * taper * 1.25))
        bar.style.transform = `scaleY(${scale.toFixed(3)})`
      })
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [isActive, getLevel])

  return (
    <div
      className={cn('flex h-20 items-center justify-center gap-[3px]', className)}
      role="img"
      aria-label={isActive ? 'Microphone input level' : 'Microphone idle'}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className={cn(
            'h-full w-1 origin-center rounded-full transition-colors duration-300',
            isActive ? 'bg-gradient-to-t from-aria-blue to-aria-pulse' : 'bg-aria-border',
          )}
          style={{ transform: 'scaleY(0.06)' }}
        />
      ))}
    </div>
  )
}
