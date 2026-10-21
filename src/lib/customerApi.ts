import { supabase } from '@/lib/supabase'

export type CustomerApiSection = 'products' | 'sms' | 'social_boost' | 'airtime' | 'giftcards' | 'telegram'
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

const REQUEST_TIMEOUT_MS = 12_000
const PUBLIC_ERRORS = new Set([
  'coming_soon', 'customer_only', 'invalid_request', 'key_limit', 'not_found',
  'unauthorized', 'unavailable',
])

export async function customerApiRequest<T>(
  path: string, method = 'GET', input?: unknown,
  options: { expectedUserId?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbortListener: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    const cancel = () => { controller.abort(); reject(new Error('The API request was cancelled.')) }
    if (options.signal?.aborted) cancel()
    else if (options.signal) {
      options.signal.addEventListener('abort', cancel, { once: true })
      onAbortListener = cancel
    }
  })
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('The API request timed out. Please try again.'))
    }, REQUEST_TIMEOUT_MS)
  })
  try {
    return await Promise.race([deadline, cancelled, (async () => {
      if (controller.signal.aborted) throw new Error('The API request was cancelled.')
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session?.access_token) throw new Error('Sign in to manage your API keys.')
      if (options.expectedUserId && session.user?.id !== options.expectedUserId) {
        throw new Error('Sign in to manage your API keys.')
      }
      if (controller.signal.aborted) throw new Error('The API request timed out. Please try again.')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-api${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) {
        throw new Error(PUBLIC_ERRORS.has(result?.code) ? result.code : 'The API request is unavailable. Please try again.')
      }
      return result.data as T
    })()])
  } catch (error) {
    if (timedOut) throw new Error('The API request timed out. Please try again.')
    if (error instanceof Error && (PUBLIC_ERRORS.has(error.message) ||
      error.message === 'Sign in to manage your API keys.')) throw error
    throw new Error('The API request is unavailable. Please try again.')
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (onAbortListener) options.signal?.removeEventListener('abort', onAbortListener)
  }
}
