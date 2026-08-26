import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/SimpleAuth'
import { supabase } from '@/lib/supabase'
import {
  deriveRevenueAttribution,
  getRevenueSessionId,
  getRevenueVisitorId,
  isInternalRevenueTraffic,
  safeRevenuePath,
  trackRevenueEvent,
} from '@/lib/revenue-os'

const VISIT_THROTTLE_PREFIX = 'tallystore_visit_seen:'
const REVENUE_RETURN_VISIT_KEY = 'tallystore_last_visit_ts'
const REVENUE_SESSION_MARKER_PREFIX = 'tallystore_session_started:'

const RETURN_VISIT_THRESHOLD_MINUTES = 30

export default function VisitorTracker() {
  const location = useLocation()
  const { user, isAdmin, isStaff } = useAuth()

  useEffect(() => {
    const path = `${location.pathname}${location.search}`
    if (isAdmin || isStaff || isInternalRevenueTraffic(path)) return

    const now = Date.now()
    const sessionId = getRevenueSessionId()
    const visitorId = getRevenueVisitorId()
    const storedPath = safeRevenuePath(path) || '/'

    if (sessionId && sessionStorage.getItem(`${REVENUE_SESSION_MARKER_PREFIX}${sessionId}`) !== '1') {
      sessionStorage.setItem(`${REVENUE_SESSION_MARKER_PREFIX}${sessionId}`, '1')
      trackRevenueEvent({
        eventType: 'SESSION_STARTED',
        userId: user?.id || null,
        surface: 'global',
        metadata: { sessionId, path: storedPath },
        eventId: `SESSION_STARTED:${sessionId}:${user?.id || visitorId || 'anonymous'}`,
      })
    }

    try {
      const lastVisitRaw = localStorage.getItem(REVENUE_RETURN_VISIT_KEY)
      const lastVisit = lastVisitRaw ? Number(lastVisitRaw) : NaN
      const minutesSinceLastVisit = Number.isFinite(lastVisit) ? (now - lastVisit) / (1000 * 60) : Infinity
      if (Number.isFinite(lastVisit) && minutesSinceLastVisit >= RETURN_VISIT_THRESHOLD_MINUTES) {
        trackRevenueEvent({
          eventType: 'RETURN_VISIT',
          userId: user?.id || null,
          surface: 'global',
          metadata: {
            minutesSinceLastVisit,
            previousVisitTs: lastVisit,
            path: storedPath,
          },
          eventId: `RETURN_VISIT:${sessionId || visitorId || user?.id || 'anonymous'}:${now}`,
        })
      }
      localStorage.setItem(REVENUE_RETURN_VISIT_KEY, String(now))
    } catch (error) {
      console.warn('Revenue return-visit tracking unavailable:', error)
    }

    const today = new Date().toISOString().slice(0, 10)
    const throttleKey = `${VISIT_THROTTLE_PREFIX}${today}:${path}`

    if (sessionStorage.getItem(throttleKey)) return
    sessionStorage.setItem(throttleKey, '1')

    const pageViewVisitorId = getRevenueVisitorId()
    const attribution = deriveRevenueAttribution({
      path,
      referrer: document.referrer || null,
      userAgent: navigator.userAgent,
      internal: false,
    })

    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      userId: user?.id || null,
      surface: 'global',
      metadata: { path: storedPath, attribution, traffic_quality: attribution.trafficQuality },
      eventId: `PAGE_VIEWED:${pageViewVisitorId || 'unknown'}:${today}:${path}`,
    })

    supabase
      .from('site_visits' as any)
      .insert({
        visitor_id: pageViewVisitorId,
        user_id: user?.id || null,
        path: storedPath,
        user_agent: navigator.userAgent,
        attribution,
        traffic_quality: attribution.trafficQuality,
      })
      .then(({ error }) => {
        if (error) console.warn('Failed to record site visit:', error.message)
      })
  }, [isAdmin, isStaff, location.pathname, location.search, user?.id])

  return null
}
