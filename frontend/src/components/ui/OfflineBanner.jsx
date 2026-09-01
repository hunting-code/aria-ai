import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/**
 * Connectivity banner.
 *
 * navigator.onLine only reports whether the machine has *a* network, not
 * whether the API is reachable, so this is a hint rather than a guarantee -
 * request failures still surface their own errors.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  )

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[120] flex items-center justify-center gap-2 bg-aria-red px-4 py-2 text-sm font-medium text-white"
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      You&apos;re offline. Check your connection.
    </div>
  )
}
