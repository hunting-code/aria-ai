// Gate for signed-in routes. Remembers where the visitor was heading so the
// login page can send them back there afterwards.

import { Navigate, useLocation } from 'react-router-dom'

import useAuth from '../../hooks/useAuth'

export default function ProtectedRoute({ children }) {
  const isAuthenticated = useAuth((s) => s.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return children
}
