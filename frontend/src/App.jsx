// Application shell: router, auth gating and the two page layouts.

import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import useAuth from './hooks/useAuth'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import Toaster from './components/ui/Toast'
import { AriaLogo } from './components/ui/Navbar'
import LoadingSpinner from './components/ui/LoadingSpinner'
import OfflineBanner from './components/ui/OfflineBanner'
import { PageSkeleton } from './components/ui/Skeleton'

// Pages are code-split: the interview screen pulls in recharts and the report
// pulls in the PDF stack, and nobody should download either to reach /login.
const Analysis = lazy(() => import('./pages/Analysis'))
const Landing = lazy(() => import('./pages/Landing'))
const ResumeUpload = lazy(() => import('./pages/ResumeUpload'))
const Sessions = lazy(() => import('./pages/Sessions'))
const Home = lazy(() => import('./pages/Home'))
const Interview = lazy(() => import('./pages/Interview'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Report = lazy(() => import('./pages/Report'))
const RoleSelect = lazy(() => import('./pages/RoleSelect'))
const Settings = lazy(() => import('./pages/Settings'))

/** Shown while the stored token is being checked against the server. */
function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-aria-void">
      <div className="flex flex-col items-center gap-4">
        <AriaLogo className="scale-125" />
        <LoadingSpinner size="md" label="Starting ARIA" />
      </div>
    </div>
  )
}

/**
 * Validates any stored token once, before the router renders a guarded route.
 *
 * Without this gate a reload would flash the login screen for every signed-in
 * user while /auth/me was still in flight.
 */
function AuthProvider({ children }) {
  const loadUser = useAuth((s) => s.loadUser)
  const isInitialised = useAuth((s) => s.isInitialised)

  useEffect(() => {
    loadUser()
  }, [loadUser])

  if (!isInitialised) return <Splash />
  return children
}

/**
 * The public landing page. A signed-in visitor is bounced straight to their
 * dashboard - the marketing pitch is for people who are not customers yet.
 */
function LandingGate() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return <Landing />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Lets keyboard users jump past the nav on every page. */}
        <a
          href="#main"
          className="sr-only-focusable fixed left-4 top-4 z-[110] rounded-lg bg-aria-blue px-4 py-2 text-sm font-medium text-white"
        >
          Skip to content
        </a>

        <OfflineBanner />
        <Toaster />

        {/* Route-level split points need a fallback that matches the eventual
            layout, so the page does not jump when the chunk lands. */}
        <Suspense fallback={<div className="px-4 pt-24 sm:px-6"><PageSkeleton /></div>}>
        <Routes>
          {/* Public standalone routes - no app shell, no sidebar, no navbar. */}
          <Route path="/" element={<LandingGate />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected app routes - navbar + sidebar via AppLayout. */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Home />} />
            <Route path="/select-role" element={<RoleSelect />} />
            <Route path="/interview/:sessionId" element={<Interview />} />
            <Route path="/analysis/:sessionId" element={<Analysis />} />
            <Route path="/report/:sessionId" element={<Report />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/resume" element={<ResumeUpload />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Unknown paths fall back to the landing page, which forwards
              signed-in users to their dashboard. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
