// ARIA's voice, via the browser's built-in speech synthesis.
//
// Why not a cloud TTS: the OpenAI account this project uses has no credit, and
// Groq's free tier covers chat and Whisper but not speech. The Web Speech API
// is local, free and instant - and it emits word-boundary events, which is what
// makes the word-by-word subtitle possible at all. The four voice options below
// are labels mapped onto whatever voices the OS actually provides.

import { useCallback, useEffect, useRef, useState } from 'react'

import { ttsApi } from '../services/api'

// The four voices offered in the lobby. `match` is only used by the browser
// fallback, to pick the nearest local voice when premium speech is unavailable.
export const VOICE_OPTIONS = [
  { id: 'sarah', name: 'Sarah', blurb: 'Professional female', match: ['samantha', 'jenny', 'aria', 'zira', 'female'] },
  { id: 'rachel', name: 'Rachel', blurb: 'Calm female', match: ['karen', 'moira', 'tessa', 'female'] },
  { id: 'adam', name: 'Adam', blurb: 'Professional male', match: ['alex', 'daniel', 'guy', 'male'] },
  { id: 'josh', name: 'Josh', blurb: 'Friendly male', match: ['fred', 'david', 'rishi', 'male'] },
]

const PREVIEW_LINE =
  "Hello, I'm ARIA. I'll be conducting your interview today."

const supported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window

/** Pick the best real voice for a label, preferring English. */
function resolveVoice(voices, voiceId) {
  if (!voices.length) return null
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang))
  const pool = english.length ? english : voices
  const option = VOICE_OPTIONS.find((v) => v.id === voiceId) ?? VOICE_OPTIONS[0]
  for (const needle of option.match) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(needle))
    if (hit) return hit
  }
  // Deterministic fallback so each label still sounds distinct from the others.
  return pool[VOICE_OPTIONS.findIndex((v) => v.id === option.id) % pool.length]
}

export default function useTTS({ voiceId = 'nova' } = {}) {
  const [voices, setVoices] = useState([])
  const [isSpeaking, setIsSpeaking] = useState(false)
  // Words revealed so far, for the subtitle bar.
  const [spokenText, setSpokenText] = useState('')

  const utteranceRef = useRef(null)
  // The <audio> element playing premium speech, when that path is in use.
  const audioRef = useRef(null)
  // Whether the last turn used premium audio, for the lobby's indicator.
  const premiumRef = useRef(false)
  const doneRef = useRef(null)
  const voiceIdRef = useRef(voiceId)
  voiceIdRef.current = voiceId

  // The voice list populates asynchronously in Chrome.
  useEffect(() => {
    if (!supported()) return undefined
    const load = () => setVoices(window.speechSynthesis.getVoices() ?? [])
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [])

  const cancel = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      try {
        audio.pause()
        audio.src = ''
      } catch {
        /* already torn down */
      }
      audioRef.current = null
      setIsSpeaking(false)
    }
    if (!supported()) return
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* cancelling an idle synth throws in some browsers */
    }
    utteranceRef.current = null
    setIsSpeaking(false)
    // Resolve a pending speak() so a caller awaiting it is never stranded.
    doneRef.current?.()
    doneRef.current = null
  }, [])

  /**
   * Speak `text`, revealing it word by word in `spokenText`.
   * Resolves when the utterance finishes (or immediately if unsupported).
   */
  /** Browser speech synthesis. The fallback, and the only path pre-ElevenLabs. */
  const speakLocally = useCallback(
    (text, { onWord } = {}) =>
      new Promise((resolve) => {
        const clean = String(text ?? '').trim()
        if (!clean) return resolve()

        if (!supported()) {
          // No synth: reveal the text at a readable pace so subtitles still run.
          setSpokenText(clean)
          setIsSpeaking(false)
          return resolve()
        }

        cancel()
        setSpokenText('')
        const utterance = new SpeechSynthesisUtterance(clean)
        const picked = resolveVoice(voices, voiceIdRef.current)
        if (picked) utterance.voice = picked
        utterance.rate = 1.02
        utterance.pitch = 1
        utterance.lang = picked?.lang || 'en-US'

        utterance.onboundary = (event) => {
          if (event.name && event.name !== 'word') return
          const upto = clean.slice(0, event.charIndex + (event.charLength || 0))
          setSpokenText(upto)
          onWord?.(upto)
        }
        const finish = () => {
          setSpokenText(clean)
          setIsSpeaking(false)
          utteranceRef.current = null
          doneRef.current = null
          resolve()
        }
        utterance.onend = finish
        utterance.onerror = finish

        utteranceRef.current = utterance
        doneRef.current = finish
        setIsSpeaking(true)
        window.speechSynthesis.speak(utterance)
      }),
    [cancel, voices],
  )

  /**
   * Speak `text` as ARIA.
   *
   * Premium audio first, because a robotic interviewer undercuts the whole
   * exercise. If that fails for any reason - no key, quota exhausted, offline -
   * the browser voice takes over silently. The candidate should never learn
   * about a billing limit halfway through an answer.
   */
  const speak = useCallback(
    async (text, { onWord } = {}) => {
      const clean = String(text ?? '').trim()
      if (!clean) return
      cancel()
      setSpokenText('')

      const blob = await ttsApi.speak({ text: clean, voice: voiceIdRef.current })
      if (!blob || blob.size === 0) {
        premiumRef.current = false
        return speakLocally(clean, { onWord })
      }

      premiumRef.current = true
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      return new Promise((resolve) => {
        const words = clean.split(/\s+/)
        let revealTimer = null

        const finish = () => {
          window.clearInterval(revealTimer)
          URL.revokeObjectURL(url)
          audioRef.current = null
          setSpokenText(clean)
          setIsSpeaking(false)
          resolve()
        }

        // ElevenLabs returns audio, not word-boundary events, so the subtitle
        // is paced against playback position instead. Not per-word accurate,
        // but it tracks the voice closely enough to read along with.
        audio.onloadedmetadata = () => {
          revealTimer = window.setInterval(() => {
            if (!audio.duration || !Number.isFinite(audio.duration)) return
            const progress = Math.min(1, audio.currentTime / audio.duration)
            const upto = words.slice(0, Math.ceil(progress * words.length)).join(' ')
            setSpokenText(upto)
            onWord?.(upto)
          }, 120)
        }
        audio.onended = finish
        audio.onerror = () => {
          // Audio decoded badly: still better to speak than to go silent.
          window.clearInterval(revealTimer)
          URL.revokeObjectURL(url)
          audioRef.current = null
          premiumRef.current = false
          speakLocally(clean, { onWord }).then(resolve)
        }

        setIsSpeaking(true)
        audio.play().catch(() => {
          // Autoplay blocked before any user gesture.
          window.clearInterval(revealTimer)
          URL.revokeObjectURL(url)
          audioRef.current = null
          premiumRef.current = false
          speakLocally(clean, { onWord }).then(resolve)
        })
      })
    },
    [cancel, speakLocally],
  )

  /** Five-second sample of a voice, for the lobby's selector. */
  const preview = useCallback(
    (previewVoiceId) => {
      const previous = voiceIdRef.current
      voiceIdRef.current = previewVoiceId
      const done = speak(PREVIEW_LINE)
      window.setTimeout(() => {
        cancel()
        voiceIdRef.current = previous
      }, 5000)
      return done
    },
    [speak, cancel],
  )

  useEffect(() => cancel, [cancel])

  return {
    speak,
    cancel,
    preview,
    isSpeaking,
    spokenText,
    isSupported: supported(),
    voices,
    usingPremiumVoice: premiumRef.current,
  }
}
