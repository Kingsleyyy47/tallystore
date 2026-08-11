import { useEffect, useState } from 'react'
import { getAppSetting } from '@/lib/supabase'

const FALLBACK_RATE = 1600 // NGN per 1 USD, used if no override and live fetch fails
const LIVE_RATE_URL = 'https://open.er-api.com/v6/latest/USD'
const CACHE_KEY = 'tallystore_ngn_usd_rate_cache'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

interface RateCache {
  rate: number
  source: 'override' | 'live' | 'fallback'
  timestamp: number
}

function readCache(): RateCache | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RateCache
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(cache: RateCache) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // ignore storage errors
  }
}

// Call this right after an admin saves or clears the ngn_usd_rate override
// so the change takes effect immediately in the same browser, instead of
// waiting up to an hour for the sessionStorage cache to expire.
export function clearExchangeRateCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore storage errors
  }
}

/**
 * Returns the current NGN-per-USD exchange rate.
 * Priority: admin override (app_settings.ngn_usd_rate) > live API > fallback constant.
 */
export function useExchangeRate() {
  const [rate, setRate] = useState<number>(FALLBACK_RATE)
  const [source, setSource] = useState<'override' | 'live' | 'fallback'>('fallback')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const loadRate = async () => {
      const cached = readCache()
      if (cached) {
        if (isMounted) {
          setRate(cached.rate)
          setSource(cached.source)
          setLoading(false)
        }
        return
      }

      try {
        // 1. Check for an admin-configured override first
        const override = await getAppSetting('ngn_usd_rate')
        if (override) {
          const parsed = parseFloat(override)
          if (!isNaN(parsed) && parsed > 0) {
            if (isMounted) {
              setRate(parsed)
              setSource('override')
              setLoading(false)
            }
            writeCache({ rate: parsed, source: 'override', timestamp: Date.now() })
            return
          }
        }

        // 2. Fall back to a live exchange rate API
        const res = await fetch(LIVE_RATE_URL)
        const data = await res.json()
        const liveRate = data?.rates?.NGN
        if (liveRate && typeof liveRate === 'number' && liveRate > 0) {
          if (isMounted) {
            setRate(liveRate)
            setSource('live')
            setLoading(false)
          }
          writeCache({ rate: liveRate, source: 'live', timestamp: Date.now() })
          return
        }

        throw new Error('Live rate unavailable')
      } catch (err) {
        console.error('useExchangeRate: falling back to default rate', err)
        if (isMounted) {
          setRate(FALLBACK_RATE)
          setSource('fallback')
          setLoading(false)
        }
        writeCache({ rate: FALLBACK_RATE, source: 'fallback', timestamp: Date.now() })
      }
    }

    loadRate()
    return () => { isMounted = false }
  }, [])

  const ngnToUsd = (ngnAmount: number) => ngnAmount / rate

  return { rate, source, loading, ngnToUsd }
}
