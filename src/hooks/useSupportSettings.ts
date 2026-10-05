import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface SupportSettings {
  whatsappUrl: string
  telegramUrl: string
  channelUrl: string
  popupMessage: string
  loading: boolean
}

const DEFAULT: SupportSettings = {
  whatsappUrl: '',
  telegramUrl: '',
  channelUrl: '',
  popupMessage: 'Stay updated and reach us directly. Join our channel for announcements and message support for any account, wallet, or order issues.',
  loading: true,
}

let cached: SupportSettings | null = null
let cacheExpiry = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 min
const READ_DEADLINE_MS = 6000
const READY_DEFAULT: SupportSettings = { ...DEFAULT, loading: false }
let cacheGeneration = 0
const invalidationListeners = new Set<() => void>()

function readSettings(signal: AbortSignal): Promise<{ data: unknown; error: unknown }> {
  return Promise.resolve(supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['support_whatsapp_url', 'support_telegram_url', 'support_channel_url', 'support_popup_message'])
    .abortSignal(signal))
}

function parseSettings(data: unknown): SupportSettings {
  if (!Array.isArray(data) || !data.every(row => row && typeof row === 'object'
    && typeof row.key === 'string' && (typeof row.value === 'string' || row.value === null))) {
    throw new Error('Invalid support settings response')
  }
  const map: Record<string, string> = {}
  for (const row of data) map[row.key] = row.value ?? ''
  return {
    whatsappUrl: map.support_whatsapp_url ?? '',
    telegramUrl: map.support_telegram_url ?? '',
    channelUrl: map.support_channel_url ?? '',
    popupMessage: map.support_popup_message ?? DEFAULT.popupMessage,
    loading: false,
  }
}

export function useSupportSettings(refreshKey?: string | null): SupportSettings {
  const [settings, setSettings] = useState<SupportSettings>(
    cached && Date.now() < cacheExpiry ? cached : DEFAULT,
  )
  const [invalidationVersion, setInvalidationVersion] = useState(cacheGeneration)

  useEffect(() => {
    const onInvalidate = () => setInvalidationVersion(cacheGeneration)
    invalidationListeners.add(onInvalidate)
    return () => { invalidationListeners.delete(onInvalidate) }
  }, [])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const generation = cacheGeneration
    if (cached && Date.now() < cacheExpiry) {
      setSettings(cached)
      return
    }
    setSettings(DEFAULT)

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('Support settings deadline exceeded'))
      }, READ_DEADLINE_MS)
    })
    Promise.race([Promise.resolve().then(() => readSettings(controller.signal)), timeout])
      .then(({ data, error }) => {
        if (error) throw new Error('Support settings unavailable')
        const next = parseSettings(data)
        if (!active) return
        if (generation !== cacheGeneration) {
          setSettings(cached ?? READY_DEFAULT)
          return
        }
        cached = next
        cacheExpiry = Date.now() + CACHE_TTL
        setSettings(next)
      })
      .catch(() => {
        if (active) setSettings(generation === cacheGeneration ? READY_DEFAULT : (cached ?? READY_DEFAULT))
      })
      .finally(() => { if (timer) clearTimeout(timer) })
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      controller.abort()
    }
  }, [refreshKey, invalidationVersion])

  return settings
}

// Call this after saving to invalidate the cache
export function invalidateSupportSettingsCache() {
  cacheGeneration += 1
  cached = null
  cacheExpiry = 0
  for (const listener of invalidationListeners) listener()
}
