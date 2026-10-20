import type { SupabaseClient } from '@supabase/supabase-js'

export type MaintenanceAccess = { userId: string; role: 'admin' | 'staff' }

// A local session or user_metadata flag is never authority for this gate.
export function abortable<T>(request: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(new Error('Access verification interrupted'))
    if (signal.aborted) { Promise.resolve(request).catch(() => undefined); cancelled(); return }
    signal.addEventListener('abort', cancelled, { once: true })
    Promise.resolve(request).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled))
  })
}

export async function verifyMaintenanceAccess(client: SupabaseClient, signal: AbortSignal): Promise<MaintenanceAccess | null> {
  signal.throwIfAborted()
  const { data: auth, error: authError } = await abortable(client.auth.getUser(), signal)
  signal.throwIfAborted()
  if (authError || !auth.user?.id) return null
  const userId = auth.user.id
  const { data, error } = await abortable(client.from('profiles')
    .select('id, is_admin, is_staff, account_suspended')
    .eq('id', userId)
    .abortSignal(signal)
    .maybeSingle(), signal)
  signal.throwIfAborted()
  if (error) throw new Error('Account permissions could not be verified')
  if (!data || data.id !== userId || data.account_suspended !== false) return null
  if (data.is_admin === true) return { userId, role: 'admin' }
  if (data.is_staff === true) return { userId, role: 'staff' }
  return null
}
