// The "Career" nav link has no session in hand. Resolve it to the most recent
// AI Meet, since that is the only thing a career report can be built from.

import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'

import { sessionsApi } from '../services/api'
import { Button } from '../components/ui'
import EmptyState from '../components/ui/EmptyState'
import { PageSkeleton } from '../components/ui/Skeleton'

export default function CareerIndex() {
  const navigate = useNavigate()
  const [latest, setLatest] = useState(undefined) // undefined = loading

  useEffect(() => {
    let live = true
    sessionsApi
      .mySessions()
      .then((data) => {
        if (!live) return
        const rows = Array.isArray(data) ? data : (data?.sessions ?? [])
        const meets = rows.filter(
          (s) => s.session_type === 'ai_meet' && s.status === 'completed',
        )
        setLatest(meets[0] ?? null)
      })
      .catch(() => live && setLatest(null))
    return () => {
      live = false
    }
  }, [])

  if (latest === undefined) return <PageSkeleton />
  if (latest) return <Navigate to={`/career/${latest.id}`} replace />

  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        icon={Compass}
        title="No career report yet"
        description="Career intelligence is built from an AI Meet interview - the formal, five-phase mode. Finish one and your report appears here."
        action={<Button onClick={() => navigate('/select-role')}>Start an AI Meet</Button>}
      />
    </div>
  )
}
