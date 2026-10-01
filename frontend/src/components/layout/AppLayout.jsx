// The signed-in app shell: top navbar plus the collapsible sidebar, with the
// routed page in <Outlet />. Public pages (landing, login, register) never
// render inside this - they are standalone.

import { useState } from 'react'
import { Outlet } from 'react-router-dom'

import Navbar from '../ui/Navbar'
import Sidebar from '../ui/Sidebar'

const SIDEBAR_KEY = 'aria_sidebar_collapsed'

export default function AppLayout() {
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
