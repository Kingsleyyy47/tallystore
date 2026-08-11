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

export function useSupportSettings(): SupportSettings {
  const [settings, setSettings] = useState<SupportSettings>(cached ?? DEFAULT)

  useEffect(() => {
    if (cached && Date.now() < cacheExpiry) {
      setSettings(cached)
      return
    }

    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['support_whatsapp_url', 'support_telegram_url', 'support_channel_url', 'support_popup_message'])
      .then(({ data }) => {
        const map: Record<string, string> = {}
        for (const row of data ?? []) map[row.key] = row.value ?? ''
        const next: SupportSettings = {
          whatsappUrl: map['support_whatsapp_url'] ?? '',
          telegramUrl: map['support_telegram_url'] ?? '',
          channelUrl: map['support_channel_url'] ?? '',
          popupMessage: map['support_popup_message'] ?? DEFAULT.popupMessage,
          loading: false,
        }
        cached = next
        cacheExpiry = Date.now() + CACHE_TTL
        setSettings(next)
      })
  }, [])

  return settings
}

// Call this after saving to invalidate the cache
export function invalidateSupportSettingsCache() {
  cached = null
  cacheExpiry = 0
}
