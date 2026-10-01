// Account creation, in the landing page's warm visual style. Validation and
// submit logic are unchanged from the original dark version.

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Eye, EyeOff, Lock, Mail, User, UserCircle2 } from 'lucide-react'

import useAuth from '../hooks/useAuth'
import useToast from '../store/toastStore'
import AuthShell, { AuthField } from '../components/auth/AuthShell'

// bcrypt hashes at most 72 bytes; the API rejects anything longer, so catch it
// here rather than letting the user submit and bounce.
const MAX_PASSWORD_BYTES = 72
const byteLength = (value) => new TextEncoder().encode(value).length

const VALIDATORS = {
  full_name: (v) => (v.length > 255 ? 'Must be 255 characters or fewer.' : null),

  username: (v) => {
    if (!v.trim()) return 'Username is required.'
    if (v.trim().length < 3) return 'At least 3 characters.'
    if (v.trim().length > 50) return 'At most 50 characters.'
    if (!/^[a-zA-Z0-9_.-]+$/.test(v.trim()))
      return 'Letters, digits, underscore, dot and hyphen only.'
    return null
  },

  email: (v) => {
    if (!v.trim()) return 'Email is required.'
    // Deliberately loose - the server does the authoritative check.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Enter a valid email address.'
    return null
  },

  password: (v) => {
    if (!v) return 'Password is required.'
    if (v.length < 8) return 'At least 8 characters.'
    if (byteLength(v) > MAX_PASSWORD_BYTES)
      return `Too long (${byteLength(v)} of ${MAX_PASSWORD_BYTES} bytes).`
    return null
  },

  confirmPassword: (v, form) => {
    if (!v) return 'Please confirm your password.'
    if (v !== form.password) return 'Passwords do not match.'
    return null
  },
}

const EMPTY = {
  full_name: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
}

function Requirement({ met, children }) {
  return (
    <li className={met ? 'met' : ''}>
      <span className="dot" aria-hidden="true">
        <Check size={9} />
      </span>
      {children}
    </li>
  )
}

export default function Register() {
  const navigate = useNavigate()
  const register = useAuth((s) => s.register)
  const isLoading = useAuth((s) => s.isLoading)
  const toast = useToast((s) => s.success)

  const [form, setForm] = useState(EMPTY)
  // A field is only shown as invalid once the user has left it, so errors
  // don't appear while they are still typing the first character.
  const [touched, setTouched] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  const errors = useMemo(() => {
    const next = {}
    for (const [field, validate] of Object.entries(VALIDATORS)) {
      const message = validate(form[field], form)
      if (message) next[field] = message
    }
    return next
  }, [form])

  const isValid = Object.keys(errors).length === 0

  const update = (field) => (event) => {
    const { value } = event.target
    setForm((f) => ({ ...f, [field]: value }))
    if (submitError) setSubmitError(null)
  }

  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }))

  // Show an error only after the field has been touched or a submit attempted.
  const errorFor = (field) => (touched[field] ? errors[field] : undefined)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitError(null)
    setTouched(Object.fromEntries(Object.keys(VALIDATORS).map((k) => [k, true])))
    if (!isValid) return

    try {
      const user = await register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        fullName: form.full_name.trim() || null,
      })
      toast(
        `Welcome to ARIA, ${user?.full_name?.split(' ')[0] || user?.username}`,
        'Your account is ready. Pick a role to start your first interview.',
      )
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setSubmitError(err.message)
    }
  }

  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? 'Hide password' : 'Show password'}
    >
      {showPassword ? (
        <EyeOff size={16} aria-hidden="true" />
      ) : (
        <Eye size={16} aria-hidden="true" />
      )}
    </button>
  )

  return (
    <AuthShell>
      <h2 className="auth-title">CREATE YOUR ACCOUNT</h2>
      <p className="auth-sub">Free, and takes about a minute.</p>

      {submitError ? (
        <div role="alert" className="auth-error">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>{submitError}</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="auth-form">
        <AuthField
          label="Full name"
          id="full_name"
          name="full_name"
          autoComplete="name"
          placeholder="Alice Ng"
          value={form.full_name}
          onChange={update('full_name')}
          onBlur={blur('full_name')}
          error={errorFor('full_name')}
          hint="Optional"
          icon={<UserCircle2 size={16} />}
        />

        <AuthField
          label="Username"
          id="username"
          name="username"
          autoComplete="username"
          placeholder="alice"
          value={form.username}
          onChange={update('username')}
          onBlur={blur('username')}
          error={errorFor('username')}
          icon={<User size={16} />}
          required
        />

        <AuthField
          label="Email"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={form.email}
          onChange={update('email')}
          onBlur={blur('email')}
          error={errorFor('email')}
          icon={<Mail size={16} />}
          required
        />

        <div>
          <AuthField
            label="Password"
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="••••••••"
            value={form.password}
            onChange={update('password')}
            onBlur={blur('password')}
            error={errorFor('password')}
            icon={<Lock size={16} />}
            required
            rightElement={passwordToggle}
          />
          {/* Live requirement checklist - updates as they type. */}
          <ul className="auth-req">
            <Requirement met={form.password.length >= 8}>
              At least 8 characters
            </Requirement>
            <Requirement
              met={
                form.password.length > 0 &&
                byteLength(form.password) <= MAX_PASSWORD_BYTES
              }
            >
              Within {MAX_PASSWORD_BYTES} bytes
            </Requirement>
          </ul>
        </div>

        <AuthField
          label="Confirm password"
          id="confirmPassword"
          name="confirmPassword"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="••••••••"
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          onBlur={blur('confirmPassword')}
          error={errorFor('confirmPassword')}
          icon={<Lock size={16} />}
          required
        />

        <button type="submit" className="btn-gold auth-submit" disabled={isLoading}>
          {isLoading ? 'Creating account…' : 'Create account'}
          {!isLoading && <div className="btn-gold-arrow" aria-hidden="true">↗</div>}
        </button>
      </form>

      <p className="auth-alt">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  )
}
