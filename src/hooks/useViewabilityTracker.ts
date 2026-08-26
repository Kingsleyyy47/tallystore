import { useEffect, useRef, useCallback, RefObject } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ViewabilityOptions = {
  /** Fraction of element that must be visible. Default 0.5 (50%). */
  threshold?: number
  /** Milliseconds the element must remain visible before firing. Default 500. */
  durationMs?: number
  /** Fire onViewed only once. Default true. */
  once?: boolean
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Tracks whether a DOM element has been genuinely viewed by the customer
 * (>= threshold visible for >= durationMs).
 *
 * Usage:
 *   const ref = useViewabilityTracker(() => markInterventionViewed(interventionId))
 *   return <div ref={ref}>...</div>
 */
export function useViewabilityTracker(
  onViewed: () => void,
  options: ViewabilityOptions = {},
): RefObject<HTMLDivElement> {
  const { threshold = 0.5, durationMs = 500, once = true } = options

  const ref        = useRef<HTMLDivElement>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedRef   = useRef(false)
  // Keep onViewed stable so the effect doesn't re-run on every render
  const callbackRef = useRef(onViewed)
  useEffect(() => { callbackRef.current = onViewed }, [onViewed])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (once && firedRef.current) {
            observer.disconnect()
            return
          }

          if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
            // Element entered view — start the timer
            if (timerRef.current === null) {
              timerRef.current = setTimeout(() => {
                timerRef.current = null
                if (once && firedRef.current) return
                firedRef.current = true
                callbackRef.current()
                if (once) observer.disconnect()
              }, durationMs)
            }
          } else {
            // Element left view — cancel the timer
            clearTimer()
          }
        }
      },
      { threshold: [0, threshold] },
    )

    observer.observe(el)

    return () => {
      observer.disconnect()
      clearTimer()
    }
  }, [threshold, durationMs, once, clearTimer])

  return ref
}
