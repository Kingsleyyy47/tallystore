import { supabase } from '@/lib/supabase'

export type CustomerApiSection = 'products' | 'sms' | 'social_boost'
export type CustomerApiKey = {
  id: string
  section: CustomerApiSection
  label: string
  prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}
export type CustomerApiOverview = {
  access: { allowed_sections: CustomerApiSection[]; is_active: boolean }
  keys: CustomerApiKey[]
}

export async function customerApiRequest<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !session?.access_token) throw new Error('Sign in to manage your API keys.')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.success !== true) {
    throw new Error(result?.code || 'The API request is unavailable. Please try again.')
  }
  return result.data as T
}
