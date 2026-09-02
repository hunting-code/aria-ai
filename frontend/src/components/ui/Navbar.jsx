import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut, Menu, User, ClipboardList, ChevronDown } from 'lucide-react'

import useAuth from '../../hooks/useAuth'
import cn from './cn'

/** "ARIA" wordmark with the live pulse dot. */
export function AriaLogo({ className, dot = true }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="font-display text-xl font-bold tracking-tight text-gradient">
        ARIA
      </span>
      {dot ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-aria-pulse animate-pulse-glow"
        />
      ) : null}
    </span>
  )
}

function initialsFor(user) {
  const source = user?.full_name || user?.username || '?'
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

/**
 * Fixed 64px top bar: wordmark on the left, account menu on the right, and a
 * hairline of aria-blue along the bottom edge.
 *
 * The dropdown closes on outside click and on Escape, and returns focus to the
 * trigger so keyboard users are not stranded.
 */
export default function Navbar({ onOpenSidebar, showMenuButton = false }) {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleLogout = () => {
    setOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  const itemClass =
    'flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-aria-text transition-colors ' +
    'hover:bg-aria-blue/10 hover:text-white focus-visible:bg-aria-blue/10 focus-visible:outline-none'

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-16">
      <div className="relative flex h-16 items-center justify-between gap-4 border-b border-aria-border bg-aria-base/80 px-4 backdrop-blur-md sm:px-6">
        {/* Left: hamburger (mobile) + wordmark */}
        <div className="flex items-center gap-3">
          {showMenuButton ? (
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Open navigation menu"
              className="-ml-1 rounded-lg p-2 text-aria-muted transition-colors hover:bg-white/5 hover:text-aria-text lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}

          <Link
            to="/dashboard"
            className="rounded-md focus-visible:outline-none"
            aria-label="ARIA AI home"
          >
            <AriaLogo />
          </Link>

          {user?.is_demo ? (
            <span
              className="rounded-full border border-aria-amber/40 bg-aria-amber/10 px-2 py-0.5 text-[11px] font-medium text-aria-amber"
              title="Sample data. Interviews you start here are cleared on the next demo sign-in."
            >
              Demo Mode
            </span>
          ) : null}
        </div>

        {/* Centre is intentionally empty. */}

        {/* Right: account menu */}
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Account menu for ${user?.username ?? 'your account'}`}
            className="flex items-center gap-2 rounded-full border border-aria-border p-1 pr-2 transition-colors hover:border-aria-blue/60 hover:bg-white/5"
          >
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-full bg-aria-gradient font-mono text-xs font-bold text-white"
            >
              {initialsFor(user)}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm text-aria-text sm:block">
              {user?.username ?? 'Account'}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-aria-muted transition-transform',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>

          {open ? (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Account"
              className="glass absolute right-0 mt-2 w-56 overflow-hidden rounded-xl py-1 shadow-surface animate-fade-in"
            >
              <div className="border-b border-aria-border px-4 py-3">
                <p className="truncate text-sm font-medium text-aria-text">
                  {user?.full_name || user?.username}
                </p>
                <p className="truncate text-xs text-aria-muted">{user?.email}</p>
              </div>

              <Link to="/settings" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
                <User className="h-4 w-4" aria-hidden="true" />
                Profile
              </Link>
              <Link to="/history" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                My Sessions
              </Link>

              <div className="my-1 border-t border-aria-border" />

              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className={cn(itemClass, 'text-aria-red hover:bg-aria-red/10 hover:text-aria-red')}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* The signature hairline along the very bottom edge. */}
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-aria-blue to-transparent"
      />
    </header>
  )
}
