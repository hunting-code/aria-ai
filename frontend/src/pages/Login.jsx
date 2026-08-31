import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Lock, User } from 'lucide-react'

import useAuth from '../hooks/useAuth'
import { Button, Card, Input } from '../components/ui'
import { BrandPanel } from '../components/ui/WaveformHero'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuth((s) => s.login)
  const isLoading = useAuth((s) => s.isLoading)
  const storeError = useAuth((s) => s.error)
  const clearError = useAuth((s) => s.clearError)

  const [form, setForm] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)

  // Where the user was headed before the redirect to /login.
  const from = location.state?.from?.pathname ?? '/'

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
    <div className="min-h-screen bg-aria-void">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-12 px-6 py-12 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-10">
        {/* Branding - on top when stacked, left half on desktop */}
        <div className="flex justify-center lg:justify-start">
          <BrandPanel />
        </div>

        {/* Form */}
        <div className="flex justify-center lg:justify-end">
          <Card className="w-full max-w-md" padding="lg" glow>
            <div className="mb-6">
              <h2 className="font-display text-2xl font-semibold">Welcome back</h2>
              <p className="mt-1 text-sm text-aria-muted">
                Sign in to continue your practice.
              </p>
            </div>

            {message ? (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-lg border border-aria-red/40 bg-aria-red/10 p-3 text-sm text-aria-red"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{message}</span>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <Input
                label="Username"
                name="username"
                autoComplete="username"
                placeholder="alice"
                value={form.username}
                onChange={update('username')}
                leftIcon={<User className="h-4 w-4" />}
                required
              />

              <Input
                label="Password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={form.password}
                onChange={update('password')}
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

              <Button type="submit" fullWidth size="lg" isLoading={isLoading}>
                Sign in
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-aria-muted">
              New to ARIA?{' '}
              <Link
                to="/register"
                className="font-medium text-aria-pulse underline-offset-4 hover:underline"
              >
                Create free account
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
