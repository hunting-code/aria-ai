// Local preferences: interview defaults, ARIA's voice, and what the proctoring
// layer is allowed to do.
//
// These live in localStorage rather than on the server because they are
// per-device choices - which camera you are willing to turn on in this browser
// is not a property of your account.

import { create } from 'zustand'

const KEY = 'aria_settings'
// Written by the AI Meet lobby too, so both read the same value.
const VOICE_KEY = 'aria_meet_voice'

export const DEFAULT_SETTINGS = {
  // Interview preferences
  defaultRole: null, // null = ask every time
  defaultDifficulty: 'intermediate',
  defaultMode: 'practice', // 'practice' | 'ai_meet'
  voiceId: 'nova',
  // Open the mic as soon as a question appears, instead of waiting for a tap.
  autoStartMic: true,

  // Proctoring. All default ON, and all are the candidate's to turn off - a
  // practice tool that forces a camera on is not a practice tool.
  cameraMonitoring: true,
  eyeTracking: true,
  tabSwitchDetection: true,

  // Notifications (no backend yet - see the note on the settings page).
  emailOnCompletion: false,
  streakReminder: false,
}

function read() {
  try {
    const raw = window.localStorage.getItem(KEY)
    const stored = raw ? JSON.parse(raw) : {}
    // Merge over the defaults so a setting added in a later release does not
    // come back undefined for someone with an older stored object.
    const merged = { ...DEFAULT_SETTINGS, ...stored }
    // The lobby's own key wins if it was set more recently there.
    const lobbyVoice = window.localStorage.getItem(VOICE_KEY)
    if (lobbyVoice) merged.voiceId = lobbyVoice
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function persist(settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings))
    window.localStorage.setItem(VOICE_KEY, settings.voiceId)
  } catch {
    /* storage can be unavailable in private mode; preferences are not critical */
  }
}

const useSettings = create((set, get) => ({
  settings: read(),

  /** Merge a patch and persist. */
  update: (patch) => {
    const next = { ...get().settings, ...patch }
    persist(next)
    set({ settings: next })
    return next
  },

  reset: () => {
    persist(DEFAULT_SETTINGS)
    set({ settings: { ...DEFAULT_SETTINGS } })
  },
}))

export default useSettings

/**
 * Read the proctoring switches outside React (and without subscribing).
 * The interview pages use this so a toggle flipped in Settings takes effect
 * on the next interview rather than needing a reload.
 */
export function getProctoringSettings() {
  const s = read()
  return {
    cameraMonitoring: s.cameraMonitoring,
    eyeTracking: s.eyeTracking,
    tabSwitchDetection: s.tabSwitchDetection,
  }
}

/** Read one preference outside React, for code that runs before mount. */
export function getSetting(key) {
  return read()[key]
}
