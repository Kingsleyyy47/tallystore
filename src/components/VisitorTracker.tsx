import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/SimpleAuth'
import { supabase } from '@/lib/supabase'

const VISITOR_ID_KEY = 'tallystore_visitor_id'
const VISIT_THROTTLE_PREFIX = 'tallystore_visit_seen:'

function getVisitorId() {
  let visitorId = localStorage.getItem(VISITOR_ID_KEY)
  if (!visitorId) {
    visitorId = crypto.randomUUID()
    localStorage.setItem(VISITOR_ID_KEY, visitorId)
  }
  return visitorId
}

export default function VisitorTracker() {
  const location = useLocation()
  const { user } = useAuth()

  useEffect(() => {
    const path = `${location.pathname}${location.search}`
    const today = new Date().toISOString().slice(0, 10)
    const throttleKey = `${VISIT_THROTTLE_PREFIX}${today}:${path}`

    if (sessionStorage.getItem(throttleKey)) return
    sessionStorage.setItem(throttleKey, '1')

    const visitorId = getVisitorId()

    supabase
      .from('site_visits' as any)
      .insert({
        visitor_id: visitorId,
        user_id: user?.id || null,
        path,
        user_agent: navigator.userAgent,
      })
      .then(({ error }) => {
        if (error) console.warn('Failed to record site visit:', error.message)
      })
  }, [location.pathname, location.search, user?.id])

  return null
}
