import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ChevronsLeft,
  ChevronsRight,
  History,
  Home,
  Mic,
  Settings,
  X,
  Compass,
  FileText,
} from 'lucide-react'

import useAuth from '../../hooks/useAuth'
import cn from './cn'

const LINKS = [
  { to: '/dashboard', label: 'Home', icon: Home, end: true },
  { to: '/select-role', label: 'New Interview', icon: Mic },
  { to: '/sessions', label: 'History', icon: History },
  { to: '/resume', label: 'Resume', icon: FileText },
  { to: '/career', label: 'Career', icon: Compass },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function initialsFor(user) {
  const source = user?.full_name || user?.username || '?'
  return source.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
}

/**
 * Dashboard navigation rail.
 *
 * 240px when open, 72px when collapsed to icons. Below `lg` it becomes an
 * overlay drawer driven by `mobileOpen`, which traps nothing but does close on
 * Escape and on navigation.
 */
export default function Sidebar({
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
}) {
  const user = useAuth((s) => s.user)

  const drawerRef = useRef(null)
  const restoreFocusRef = useRef(null)

  // Escape closes the drawer, and Tab is trapped inside it: an open dialog
  // that lets focus wander behind the overlay is unusable with a keyboard.
  useEffect(() => {
    if (!mobileOpen) return undefined

    restoreFocusRef.current = document.activeElement
    const focusables = () =>
      Array.from(
        drawerRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)

    focusables()[0]?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCloseMobile?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Return focus to whatever opened the drawer.
      restoreFocusRef.current?.focus?.()
    }
  }, [mobileOpen, onCloseMobile])

  const linkClass = ({ isActive }) =>
    cn(
      'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
      'transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aria-pulse',
      isActive
        ? 'bg-aria-blue/15 text-aria-text'
        : 'text-aria-muted hover:bg-black/5 hover:text-aria-text',
    )

  const content = (
    <div className="flex h-full flex-col">
      <nav className="flex-1 space-y-1 p-3" aria-label="Dashboard">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onCloseMobile}
            className={linkClass}
            title={collapsed ? label : undefined}
          >
            {({ isActive }) => (
              <>
                {/* Left border indicator for the active route. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-1 left-0 w-0.5 rounded-full bg-aria-pulse transition-opacity',
                    isActive ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <Icon
                  className={cn(
                    'h-5 w-5 shrink-0',
                    isActive ? 'text-aria-pulse' : 'text-current',
                  )}
                  aria-hidden="true"
                />
                <span className={cn('truncate', collapsed && 'lg:hidden')}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom: user card */}
      <div className="border-t border-aria-border p-3">
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg bg-aria-surface/60 p-2.5',
            collapsed && 'lg:justify-center lg:bg-transparent lg:p-0',
          )}
        >
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-aria-gradient font-mono text-xs font-bold text-aria-text"
          >
            {initialsFor(user)}
          </span>
          <div className={cn('min-w-0 flex-1', collapsed && 'lg:hidden')}>
            <p className="truncate text-sm font-medium text-aria-text">
              {user?.full_name || user?.username || 'Signed out'}
            </p>
            <p className="truncate text-xs text-aria-muted">{user?.email}</p>
          </div>
        </div>

        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'mt-3 hidden w-full items-center gap-2 rounded-lg px-3 py-2 text-sm',
              'text-aria-muted transition-colors hover:bg-black/5 hover:text-aria-text lg:flex',
              collapsed && 'lg:justify-center lg:px-0',
            )}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                Collapse
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={cn(
          'fixed left-0 top-16 z-30 hidden h-[calc(100vh-4rem)] border-r border-aria-border',
          'bg-aria-base/60 backdrop-blur-md transition-[width] duration-200 ease-out-expo lg:block',
          collapsed ? 'w-[72px]' : 'w-60',
        )}
      >
        {content}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-black/60 animate-fade-in"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside
            ref={drawerRef}
            className="fixed left-0 top-0 z-50 h-full w-60 border-r border-aria-border bg-aria-base shadow-surface"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="flex h-16 items-center justify-between border-b border-aria-border px-4">
              <span className="font-display font-bold text-gradient">ARIA</span>
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close navigation menu"
                className="rounded-lg p-2 text-aria-muted hover:bg-black/5 hover:text-aria-text"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="h-[calc(100%-4rem)]">{content}</div>
          </aside>
        </div>
      ) : null}
    </>
  )
}
