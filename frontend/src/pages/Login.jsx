// Sign-in page, in the landing page's warm visual style. Auth logic is
// unchanged: zustand login, demo prefill via router state, return-to redirect.

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Lock, User } from 'lucide-react'

import useAuth from '../hooks/useAuth'
import AuthShell, { AuthField } from '../components/auth/AuthShell'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuth((s) => s.login)
  const isLoading = useAuth((s) => s.isLoading)
  const storeError = useAuth((s) => s.error)
  const clearError = useAuth((s) => s.clearError)

  // The landing page's "Try demo account" button arrives with credentials in
  // router state, so the form starts filled and one click signs the demo in.
  const prefill = location.state
  const [form, setForm] = useState({
    username: prefill?.username ?? '',
    password: prefill?.password ?? '',
  })

  // Also react to state arriving after mount (e.g. an in-page navigation back
  // to /login with fresh credentials).
  useEffect(() => {
    if (location.state?.username) {
      setForm({
        username: location.state.username,
        password: location.state.password ?? '',
      })
    }
  }, [location.state])

  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)

  // Where the user was headed before the redirect to /login.
  const from = location.state?.from?.pathname ?? '/dashboard'

  const update = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }))
    if (error) setError(null)
    if (storeError) clearError()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError(null)
    if (!form.username.trim() || !form.password) {
      setError('Enter your username and password.')
      return
    }
    try {
      await login({ username: form.username.trim(), password: form.password })
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message)
    }
  }

  const message = error ?? storeError

  return (
    <AuthShell>
      <h2 className="auth-title">WELCOME BACK</h2>
      <p className="auth-sub">Sign in to continue your practice.</p>

      {message ? (
        <div role="alert" className="auth-error">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>{message}</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="auth-form">
        <AuthField
          label="Username"
          id="username"
          name="username"
          autoComplete="username"
          placeholder="alice"
          value={form.username}
          onChange={update('username')}
          icon={<User size={16} />}
          required
        />

        <AuthField
          label="Password"
          id="password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder="••••••••"
          value={form.password}
          onChange={update('password')}
          icon={<Lock size={16} />}
          required
          rightElement={
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
          }
        />

        <button type="submit" className="btn-gold auth-submit" disabled={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
          {!isLoading && <div className="btn-gold-arrow" aria-hidden="true">↗</div>}
        </button>
      </form>

      <p className="auth-alt">
        New to ARIA? <Link to="/register">Create free account</Link>
      </p>
    </AuthShell>
  )
}
