// Account, interview defaults, proctoring consent, and the irreversible stuff.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle, AlertTriangle, Bell, Check, Download, Eye, Lock, Monitor,
  Settings as SettingsIcon, Trash2, User, Volume2,
} from 'lucide-react'

import useAuth from '../hooks/useAuth'
import useSettings from '../store/settingsStore'
import useToast from '../store/toastStore'
import useTTS, { VOICE_OPTIONS } from '../hooks/useTTS'
import { accountApi, extractErrorMessage, sessionsApi, resumeApi } from '../services/api'
import { Button, Card, Input, cn } from '../components/ui'

const ROLES = [
  { value: '', label: 'Ask me every time' },
  { value: 'data_analyst', label: 'Data Analyst' },
  { value: 'software_engineer', label: 'Software Engineer' },
  { value: 'hr', label: 'Human Resources' },
  { value: 'ai_engineer', label: 'AI Engineer' },
]
const DIFFICULTIES = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
]
const MODES = [
  { value: 'practice', label: 'Quick Practice' },
  { value: 'ai_meet', label: 'AI Meet Interview' },
]

/* -------------------------------------------------------------------------- */

function Section({ icon: Icon, title, description, children, tone = 'default' }) {
  return (
    <Card padding="lg" className={cn(tone === 'danger' && 'border-aria-red/40')}>
      <div className="mb-5 flex items-start gap-3">
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
            tone === 'danger'
              ? 'bg-aria-red/10 text-aria-red'
              : 'bg-aria-blue/10 text-aria-blue',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-aria-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </Card>
  )
}

function Field({ label, hint, children, htmlFor }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium uppercase tracking-wider text-aria-muted"
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-xs text-aria-muted">{hint}</p> : null}
    </div>
  )
}

function Select({ id, value, onChange, options }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-aria-border bg-aria-surface px-3 py-2.5 text-sm text-aria-text focus:border-aria-blue focus:outline-none focus:ring-2 focus:ring-aria-blue/40"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Toggle({ id, checked, onChange, label, description, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-aria-text">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-xs text-aria-muted">{description}</p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse focus-visible:ring-offset-2 focus-visible:ring-offset-aria-void',
          checked ? 'bg-aria-blue' : 'bg-aria-border',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

/** Type-to-confirm dialog for the irreversible actions. */
function ConfirmDialog({ open, title, body, confirmWord, confirmLabel, busy, error, onConfirm, onCancel, children }) {
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (open) setTyped('')
  }, [open])
  if (!open) return null

  // Compared case-insensitively on BOTH sides: the confirm word is sometimes a
  // literal like CLEAR and sometimes a username, which is lowercase.
  const ready =
    !confirmWord || typed.trim().toLowerCase() === String(confirmWord).toLowerCase()

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-[100] grid place-items-center bg-aria-void/90 px-6 backdrop-blur-sm animate-fade-in"
    >
      <div className="w-full max-w-md rounded-2xl border border-aria-red/40 bg-aria-base p-6 shadow-surface">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-aria-red/15 text-aria-red">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 id="confirm-title" className="mt-4 font-display text-xl font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-aria-muted">{body}</p>

        {children}

        {confirmWord ? (
          <div className="mt-4">
            <label htmlFor="confirm-word" className="text-xs text-aria-muted">
              Type <span className="font-mono text-aria-text">{confirmWord}</span> to confirm
            </label>
            <input
              id="confirm-word"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1.5 w-full rounded-lg border border-aria-border bg-aria-surface px-3 py-2 font-mono text-sm text-aria-text focus:border-aria-red focus:outline-none focus:ring-2 focus:ring-aria-red/30"
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-aria-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex gap-3">
          <Button variant="ghost" fullWidth onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            fullWidth
            onClick={onConfirm}
            disabled={!ready || busy}
            isLoading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export default function Settings() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const loadUser = useAuth((s) => s.loadUser)
  const toast = useToast((s) => s.success)
  const warn = useToast((s) => s.error)

  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const tts = useTTS({ voiceId: settings.voiceId })

  const isDemo = Boolean(user?.is_demo)

  // ---- Section 1: profile ------------------------------------------------ //
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState(null)

  useEffect(() => {
    setFullName(user?.full_name ?? '')
  }, [user?.full_name])

  const nameChanged = (fullName ?? '') !== (user?.full_name ?? '')
  const wantsPassword = Boolean(pw.current || pw.next || pw.confirm)
  const canSaveProfile = !isDemo && (nameChanged || wantsPassword)

  const saveProfile = async () => {
    setProfileError(null)
    if (wantsPassword) {
      if (!pw.current || !pw.next) {
        return setProfileError('Enter your current password and a new one.')
      }
      if (pw.next !== pw.confirm) {
        return setProfileError('The new passwords do not match.')
      }
      if (pw.next.length < 8) {
        return setProfileError('The new password must be at least 8 characters.')
      }
    }
    setSavingProfile(true)
    try {
      await accountApi.updateProfile({
        ...(nameChanged ? { full_name: fullName.trim() } : {}),
        ...(wantsPassword
          ? { current_password: pw.current, new_password: pw.next }
          : {}),
      })
      setPw({ current: '', next: '', confirm: '' })
      await loadUser()
      toast('Profile saved', wantsPassword ? 'Your password has been changed.' : undefined)
    } catch (err) {
      setProfileError(extractErrorMessage(err, 'Could not save your changes.'))
    } finally {
      setSavingProfile(false)
    }
  }

  // ---- Section 2: staged preferences ------------------------------------ //
  // Edited locally and committed by the Save button, so a half-made choice is
  // never written. Proctoring below stays immediate - those are consent
  // switches, and consent should not need confirming.
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings])
  const prefKeys = ['defaultRole', 'defaultDifficulty', 'defaultMode', 'voiceId', 'autoStartMic']
  const prefsDirty = prefKeys.some((k) => draft[k] !== settings[k])
  const savePrefs = () => {
    update(Object.fromEntries(prefKeys.map((k) => [k, draft[k]])))
    toast('Preferences saved', 'They apply to your next interview.')
  }

  // ---- Section 2: voice preview ----------------------------------------- //
  const [previewing, setPreviewing] = useState(false)
  const previewTimer = useRef(null)
  useEffect(() => () => window.clearTimeout(previewTimer.current), [])

  const previewVoice = () => {
    setPreviewing(true)
    tts.preview(settings.voiceId)
    previewTimer.current = window.setTimeout(() => setPreviewing(false), 3000)
  }

  // ---- Section 5: account actions --------------------------------------- //
  const [dialog, setDialog] = useState(null) // 'history' | 'account'
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState(null)
  const [deletePassword, setDeletePassword] = useState('')

  const clearHistory = async () => {
    setBusy(true)
    setDialogError(null)
    try {
      const { deleted } = await accountApi.clearHistory()
      setDialog(null)
      toast(
        'History cleared',
        `${deleted} session${deleted === 1 ? '' : 's'} removed from your history.`,
      )
    } catch (err) {
      setDialogError(extractErrorMessage(err, 'Could not clear your history.'))
    } finally {
      setBusy(false)
    }
  }

  const deleteAccount = async () => {
    setBusy(true)
    setDialogError(null)
    try {
      await accountApi.deleteAccount(deletePassword)
      logout()
      navigate('/', { replace: true })
    } catch (err) {
      setDialogError(extractErrorMessage(err, 'Could not delete your account.'))
      setBusy(false)
    }
  }

  // Assembled client-side from endpoints the user can already read, so this
  // works without a backend export job.
  const downloadData = useCallback(async () => {
    try {
      const [sessions, resume] = await Promise.all([
        sessionsApi.mySessions({ force: true }).catch(() => null),
        resumeApi.myResume({ force: true }).catch(() => null),
      ])
      const bundle = {
        exported_at: new Date().toISOString(),
        account: {
          username: user?.username,
          email: user?.email,
          full_name: user?.full_name,
          created_at: user?.created_at,
        },
        preferences: settings,
        sessions: Array.isArray(sessions) ? sessions : (sessions?.sessions ?? []),
        resume: resume ?? null,
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = `aria-data-${user?.username ?? 'export'}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Download started', 'Your data was exported as JSON.')
    } catch {
      warn('Export failed', 'Your data could not be assembled just now.')
    }
  }, [user, settings, toast, warn])

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-aria-blue">
          Settings
        </p>
        <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight">
          Your account and preferences
        </h1>
      </header>

      {isDemo ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-aria-amber/40 bg-aria-amber/10 p-3 text-sm text-aria-amber"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            You are signed in to the shared demo account. Profile and account
            changes are disabled - create your own account to use them.
          </span>
        </div>
      ) : null}

      {/* ---- 1. Profile --------------------------------------------------- */}
      <Section icon={User} title="Profile" description="How you appear in your interviews.">
        <div className="space-y-4">
          <Field label="Full name" htmlFor="full_name">
            <Input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              disabled={isDemo}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username" htmlFor="username" hint="Cannot be changed.">
              <Input id="username" value={user?.username ?? ''} readOnly disabled />
            </Field>
            <Field label="Email" htmlFor="email" hint="Cannot be changed.">
              <Input id="email" value={user?.email ?? ''} readOnly disabled />
            </Field>
          </div>

          <div className="border-t border-aria-border pt-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-medium">
              <Lock className="h-3.5 w-3.5 text-aria-muted" aria-hidden="true" />
              Change password
            </p>
            <div className="space-y-3">
              <Input
                type="password"
                placeholder="Current password"
                autoComplete="current-password"
                value={pw.current}
                onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                disabled={isDemo}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="password"
                  placeholder="New password"
                  autoComplete="new-password"
                  value={pw.next}
                  onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                  disabled={isDemo}
                />
                <Input
                  type="password"
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  value={pw.confirm}
                  onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                  disabled={isDemo}
                  error={
                    pw.confirm && pw.next !== pw.confirm ? 'Passwords do not match.' : undefined
                  }
                />
              </div>
            </div>
          </div>

          {profileError ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-aria-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {profileError}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              onClick={saveProfile}
              disabled={!canSaveProfile}
              isLoading={savingProfile}
              loadingLabel="Saving"
            >
              Save changes
            </Button>
          </div>
        </div>
      </Section>

      {/* ---- 2. Interview preferences ------------------------------------- */}
      <Section
        icon={SettingsIcon}
        title="Interview Preferences"
        description="Defaults for every new interview. Stored on this device."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default role" htmlFor="pref-role">
            <Select
              id="pref-role"
              value={draft.defaultRole ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, defaultRole: v || null }))}
              options={ROLES}
            />
          </Field>
          <Field label="Default difficulty" htmlFor="pref-difficulty">
            <Select
              id="pref-difficulty"
              value={draft.defaultDifficulty}
              onChange={(v) => setDraft((d) => ({ ...d, defaultDifficulty: v }))}
              options={DIFFICULTIES}
            />
          </Field>
          <Field label="Preferred mode" htmlFor="pref-mode">
            <Select
              id="pref-mode"
              value={draft.defaultMode}
              onChange={(v) => setDraft((d) => ({ ...d, defaultMode: v }))}
              options={MODES}
            />
          </Field>
          <Field
            label="ARIA's voice"
            htmlFor="pref-voice"
            hint={tts.isSupported ? undefined : 'This browser has no speech synthesis.'}
          >
            <div className="flex gap-2">
              <Select
                id="pref-voice"
                value={draft.voiceId}
                onChange={(v) => setDraft((d) => ({ ...d, voiceId: v }))}
                options={VOICE_OPTIONS.map((v) => ({
                  value: v.id,
                  label: `${v.name} - ${v.blurb}`,
                }))}
              />
              <Button
                variant="outline"
                onClick={previewVoice}
                disabled={!tts.isSupported || previewing}
                aria-label="Preview voice"
              >
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </Field>
        </div>

        <div className="mt-2 border-t border-aria-border">
          <Toggle
            id="t-automic"
            checked={draft.autoStartMic}
            onChange={(v) => setDraft((d) => ({ ...d, autoStartMic: v }))}
            label="Auto-start microphone"
            description="Open the mic as soon as a question appears, instead of waiting for you to tap it."
          />
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          {prefsDirty ? (
            <span className="text-xs text-aria-muted">Unsaved changes</span>
          ) : null}
          <Button onClick={savePrefs} disabled={!prefsDirty}>
            Save preferences
          </Button>
        </div>
      </Section>

      {/* ---- 3. Proctoring ------------------------------------------------ */}
      <Section
        icon={Monitor}
        title="Proctoring"
        description="What ARIA is allowed to observe during an interview. All of it is optional, and none of it changes your scores."
      >
        <div className="divide-y divide-aria-border">
          <Toggle
            id="t-camera"
            checked={settings.cameraMonitoring}
            onChange={(v) =>
              update({ cameraMonitoring: v, ...(v ? {} : { eyeTracking: false }) })
            }
            label="Camera monitoring"
            description="Shows a small self-view during the interview, so you can see what is being recorded. Nothing is uploaded - the video never leaves your browser."
          />
          <Toggle
            id="t-eye"
            checked={settings.eyeTracking && settings.cameraMonitoring}
            disabled={!settings.cameraMonitoring}
            onChange={(v) => update({ eyeTracking: v })}
            label="Eye tracking"
            description="Estimates whether you are facing the screen, and notes long glances away. Requires the camera. It measures attention, not honesty."
          />
          <Toggle
            id="t-tab"
            checked={settings.tabSwitchDetection}
            onChange={(v) => update({ tabSwitchDetection: v })}
            label="Tab switch detection"
            description="Records when you leave the interview tab and for how long. Shown on your session summary."
          />
        </div>
      </Section>

      {/* ---- 4. Notifications --------------------------------------------- */}
      <Section
        icon={Bell}
        title="Notifications"
        description="Email reminders and summaries."
      >
        <div className="divide-y divide-aria-border">
          <Toggle
            id="t-email"
            checked={settings.emailOnCompletion}
            onChange={(v) => update({ emailOnCompletion: v })}
            label="Session completion email"
            description="Send my scores and feedback by email when an interview finishes."
          />
          <Toggle
            id="t-streak"
            checked={settings.streakReminder}
            onChange={(v) => update({ streakReminder: v })}
            label="Streak reminder"
            description="Remind me to practise when my streak is about to lapse."
          />
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-aria-amber/40 bg-aria-amber/10 p-3 text-xs text-aria-amber">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Email notifications require backend configuration. These preferences are
          saved, but no email will be sent until that is set up.
        </p>
      </Section>

      {/* ---- 5. Account ---------------------------------------------------- */}
      <Section
        icon={Trash2}
        title="Account"
        description="Export or remove your data."
        tone="danger"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-aria-border bg-aria-surface/60 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Download my data</p>
              <p className="mt-0.5 text-xs text-aria-muted">
                Your profile, preferences, interview history and resume analysis, as JSON.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={downloadData}
              leftIcon={<Download className="h-4 w-4" />}
            >
              Download
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-aria-red/30 bg-aria-red/5 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Delete all session history</p>
              <p className="mt-0.5 text-xs text-aria-muted">
                Removes every interview from your history and dashboard.
              </p>
            </div>
            <Button variant="danger" onClick={() => setDialog('history')} disabled={isDemo}>
              Clear history
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-aria-red/30 bg-aria-red/5 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Delete account</p>
              <p className="mt-0.5 text-xs text-aria-muted">
                Permanently removes your account, interviews and resume. This cannot be undone.
              </p>
            </div>
            <Button variant="danger" onClick={() => setDialog('account')} disabled={isDemo}>
              Delete account
            </Button>
          </div>
        </div>
      </Section>

      <ConfirmDialog
        open={dialog === 'history'}
        title="Clear your interview history?"
        body="Every interview disappears from your history, dashboard and progress charts. Your account stays."
        confirmWord="CLEAR"
        confirmLabel="Clear history"
        busy={busy}
        error={dialogError}
        onConfirm={clearHistory}
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog === 'account'}
        title="Delete your account?"
        body="This removes your account, every interview, and your resume analysis. It cannot be undone."
        confirmWord={user?.username ?? 'DELETE'}
        confirmLabel="Delete forever"
        busy={busy}
        error={dialogError}
        onConfirm={deleteAccount}
        onCancel={() => {
          setDialog(null)
          setDeletePassword('')
        }}
      >
        <div className="mt-4">
          <label htmlFor="delete-pw" className="text-xs text-aria-muted">
            Confirm your password
          </label>
          <input
            id="delete-pw"
            type="password"
            autoComplete="current-password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-aria-border bg-aria-surface px-3 py-2 text-sm text-aria-text focus:border-aria-red focus:outline-none focus:ring-2 focus:ring-aria-red/30"
          />
        </div>
      </ConfirmDialog>
    </div>
  )
}
