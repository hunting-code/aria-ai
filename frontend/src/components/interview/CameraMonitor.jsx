// The small self-view in the corner of an interview, with its attention state.
//
// It is deliberately visible rather than hidden: someone being watched should
// be able to see exactly what is being watched.

import { useEffect, useState } from 'react'
import { Eye, EyeOff, VideoOff } from 'lucide-react'

import useCamera from '../../hooks/useCamera'
import useEyeTracking, { GAZE } from '../../hooks/useEyeTracking'
import { getProctoringSettings } from '../../store/settingsStore'
import { cn } from '../ui'

const STATUS_UI = {
  [GAZE.ON_SCREEN]: { label: 'Focused', dot: 'bg-aria-green', text: 'text-aria-green', Icon: Eye },
  [GAZE.LOOKING_AWAY]: { label: 'Looking away', dot: 'bg-aria-amber', text: 'text-aria-amber', Icon: EyeOff },
  [GAZE.SUSPICIOUS]: { label: 'Away a while', dot: 'bg-aria-red', text: 'text-aria-red', Icon: EyeOff },
  [GAZE.NOT_DETECTED]: { label: 'No face', dot: 'bg-aria-muted', text: 'text-aria-muted', Icon: VideoOff },
}

/**
 * @param enabled   false mounts nothing and starts no camera
 * @param onSignals called with {status, stats, attentionRate} as they change
 */
export default function CameraMonitor({ enabled = true, onSignals, className }) {
  // Read once on mount: a toggle flipped mid-interview should not yank the
  // camera out from under a question in progress - it applies next time.
  const [prefs] = useState(getProctoringSettings)
  const cameraOn = enabled && prefs.cameraMonitoring
  const camera = useCamera({ auto: cameraOn })
  const gaze = useEyeTracking(camera.videoRef?.current ?? null, {
    enabled: cameraOn && prefs.eyeTracking && camera.isActive,
  })

  // Hand the live signals up so the page can fold them into its completion
  // payload without re-running detection itself.
  useEffect(() => {
    onSignals?.({
      status: gaze.status,
      stats: gaze.stats,
      attentionRate: gaze.attentionRate,
      trackingAvailable: gaze.isReady,
    })
  }, [gaze.status, gaze.stats, gaze.attentionRate, gaze.isReady, onSignals])

  if (!cameraOn) return null

  const ui = STATUS_UI[gaze.status] ?? STATUS_UI[GAZE.NOT_DETECTED]
  const { Icon } = ui

  return (
    <div
      className={cn(
        'fixed bottom-28 right-4 z-40 w-[160px] overflow-hidden rounded-xl border border-aria-border bg-black shadow-surface',
        className,
      )}
      aria-label="Your camera"
    >
      <div className="relative h-[120px] w-[160px]">
        <video
          ref={camera.setVideoEl}
          autoPlay
          playsInline
          muted
          className="h-full w-full -scale-x-100 object-cover"
        />
        {!camera.isActive ? (
          <div className="absolute inset-0 grid place-items-center bg-aria-surface/90 px-2 text-center">
            <div>
              <VideoOff className="mx-auto h-5 w-5 text-aria-muted" aria-hidden="true" />
              <p className="mt-1 text-[10px] leading-tight text-aria-muted">
                {camera.permissionDenied ? 'Camera blocked' : 'Camera off'}
              </p>
            </div>
          </div>
        ) : null}

        {/* Live attention state, over the feed. */}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/60 px-2 py-1 backdrop-blur-sm">
          <span
            aria-hidden="true"
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              ui.dot,
              gaze.status === GAZE.SUSPICIOUS && 'animate-pulse',
            )}
          />
          <Icon className={cn('h-2.5 w-2.5 shrink-0', ui.text)} aria-hidden="true" />
          <span className="truncate font-mono text-[9px] text-white/80">{ui.label}</span>
        </div>
      </div>
    </div>
  )
}
