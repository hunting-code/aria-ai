// Application shell: router, auth gating and the two page layouts.

import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'

import useAuth from './hooks/useAuth'
import Navbar from './components/ui/Navbar'
import Sidebar from './components/ui/Sidebar'
import Toaster from './components/ui/Toast'
import { AriaLogo } from './components/ui/Navbar'
import LoadingSpinner from './components/ui/LoadingSpinner'

import Analysis from './pages/Analysis'
import History from './pages/History'
import Home from './pages/Home'
import Interview from './pages/Interview'
import Login from './pages/Login'
import Register from './pages/Register'
import Report from './pages/Report'
import RoleSelect from './pages/RoleSelect'
import Settings from './pages/Settings'

const SIDEBAR_KEY = 'aria_sidebar_collapsed'

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

/** Gate for signed-in routes. Remembers where the user was heading. */
function RequireAuth() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}

/** Keeps signed-in users off /login and /register. */
function RedirectIfAuthenticated() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/" replace />
  return <Outlet />
}

/** Navbar + collapsible sidebar, for the dashboard-style pages. */
function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v
      try {
        window.localStorage.setItem(SIDEBAR_KEY, String(next))
      } catch {
        /* preference is non-critical */
      }
      return next
    })
  }

  return (
    <div className="min-h-screen bg-aria-void">
      <Navbar showMenuButton onOpenSidebar={() => setMobileOpen(true)} />
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <main
        id="main"
        className={
          'px-4 pb-16 pt-24 transition-[padding] duration-200 ease-out-expo sm:px-6 ' +
          (collapsed ? 'lg:pl-[88px]' : 'lg:pl-64')
        }
      >
        <Outlet />
      </main>
    </div>
  )
}

/**
 * Navbar only - used for the interview, analysis and report screens, where a
 * persistent nav rail would compete with the content for attention.
 */
function FocusLayout() {
  return (
    <div className="min-h-screen bg-aria-void">
      <Navbar />
      <main id="main" className="px-4 pb-16 pt-24 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
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

        <Toaster />

        <Routes>
          {/* Public */}
          <Route element={<RedirectIfAuthenticated />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Protected */}
          <Route element={<RequireAuth />}>
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/select-role" element={<RoleSelect />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            <Route element={<FocusLayout />}>
              <Route path="/interview/:sessionId" element={<Interview />} />
              <Route path="/analysis/:sessionId" element={<Analysis />} />
              <Route path="/report/:sessionId" element={<Report />} />
            </Route>
          </Route>

          {/* Unknown paths fall back to the dashboard, which will bounce to
              /login if the visitor is not signed in. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
