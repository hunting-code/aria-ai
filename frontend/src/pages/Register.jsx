import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Eye, EyeOff, Lock, Mail, User, UserCircle2 } from 'lucide-react'

import useAuth from '../hooks/useAuth'
import { Button, Card, Input, cn } from '../components/ui'
import useToast from '../store/toastStore'
import { BrandPanel } from '../components/ui/WaveformHero'

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
    <li className="flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className={cn(
          'grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors',
          met
            ? 'border-aria-green/50 bg-aria-green/15 text-aria-green'
            : 'border-aria-border text-transparent',
        )}
      >
        <Check className="h-2.5 w-2.5" />
      </span>
      <span className={met ? 'text-aria-green' : 'text-aria-muted'}>{children}</span>
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

  return (
    <div className="min-h-screen bg-aria-void">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-12 px-6 py-12 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-10">
        <div className="flex justify-center lg:justify-start">
          <BrandPanel />
        </div>

        <div className="flex justify-center lg:justify-end">
          <Card className="w-full max-w-md" padding="lg" glow>
            <div className="mb-6">
              <h2 className="font-display text-2xl font-semibold">Create your account</h2>
              <p className="mt-1 text-sm text-aria-muted">
                Free, and takes about a minute.
              </p>
            </div>

            {submitError ? (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-lg border border-aria-red/40 bg-aria-red/10 p-3 text-sm text-aria-red"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{submitError}</span>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <Input
                label="Full name"
                name="full_name"
                autoComplete="name"
                placeholder="Alice Ng"
                value={form.full_name}
                onChange={update('full_name')}
                onBlur={blur('full_name')}
                error={errorFor('full_name')}
                hint="Optional"
                leftIcon={<UserCircle2 className="h-4 w-4" />}
              />

              <Input
                label="Username"
                name="username"
                autoComplete="username"
                placeholder="alice"
                value={form.username}
                onChange={update('username')}
                onBlur={blur('username')}
                error={errorFor('username')}
                leftIcon={<User className="h-4 w-4" />}
                required
              />

              <Input
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={update('email')}
                onBlur={blur('email')}
                error={errorFor('email')}
                leftIcon={<Mail className="h-4 w-4" />}
                required
              />

              <div>
                <Input
                  label="Password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={update('password')}
                  onBlur={blur('password')}
                  error={errorFor('password')}
                  leftIcon={<Lock className="h-4 w-4" />}
                  required
                  rightElement={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="rounded-md p-1 text-aria-muted transition-colors hover:text-aria-text"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  }
                />
                {/* Live requirement checklist - updates as they type. */}
                <ul className="mt-2 space-y-1">
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

              <Input
                label="Confirm password"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                value={form.confirmPassword}
                onChange={update('confirmPassword')}
                onBlur={blur('confirmPassword')}
                error={errorFor('confirmPassword')}
                leftIcon={<Lock className="h-4 w-4" />}
                required
              />

              <Button type="submit" fullWidth size="lg" isLoading={isLoading}>
                Create account
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-aria-muted">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-medium text-aria-pulse underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
