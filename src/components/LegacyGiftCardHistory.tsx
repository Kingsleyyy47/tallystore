import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/SimpleAuth'
import { supabase } from '@/lib/supabase'

type LegacyOrder = {
  id: string
  reference: string
  product_name: string
  quantity: number | null
  amount_ngn: number | null
  status: string
  redemption_code: string | null
  redemption_link: string | null
  redemption_pin: string | null
  created_at: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function safeLink(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href : null
  } catch { return null }
}

function parseOrders(value: unknown): LegacyOrder[] {
  if (!Array.isArray(value)) throw new Error('Invalid history')
  return value.slice(0, 10).filter(row => row && typeof row === 'object' && text(row.id))
    .map(row => ({
      id: row.id, reference: text(row.reference) ?? '',
      product_name: text(row.product_name) ?? 'Gift card',
      quantity: Number.isSafeInteger(row.quantity) && row.quantity > 0 ? row.quantity : null,
      amount_ngn: typeof row.amount_ngn === 'number' && Number.isFinite(row.amount_ngn) && row.amount_ngn >= 0
        ? row.amount_ngn : null,
      status: text(row.status) ?? 'unknown',
      redemption_code: row.status === 'successful' ? text(row.redemption_code) : null,
      redemption_link: row.status === 'successful' ? text(row.redemption_link) : null,
      redemption_pin: row.status === 'successful' ? text(row.redemption_pin) : null,
      created_at: text(row.created_at) ?? '',
    }))
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString()
}

function download(order: LegacyOrder) {
  const lines = [`Product: ${order.product_name.replace(/[\r\n]/g, ' ')}`,
    `Reference: ${order.reference.replace(/[\r\n]/g, ' ')}`,
    `Status: ${order.status}`, `Quantity ordered: ${order.quantity ?? 'Unknown'}`,
    ...(order.redemption_code === null ? [] : [`Code: ${order.redemption_code}`]),
    ...(order.redemption_pin === null ? [] : [`PIN: ${order.redemption_pin}`]),
    ...(order.redemption_link === null ? [] : [`Link: ${order.redemption_link}`])]
  const href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type:'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `gift-card-${order.id.replace(/[^A-Za-z0-9_-]/g, '')}.txt`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return <div className="flex min-w-0 items-center gap-2 rounded-lg border p-2 text-sm">
    <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 flex-1 truncate font-mono" title={value}>{value}</span>
    <button type="button" className="shrink-0 rounded border px-2 py-1 text-xs"
      aria-label={`Copy ${label}`} onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true) } catch { setCopied(false) }
      }}>{copied ? 'Copied' : 'Copy'}</button>
  </div>
}

function HistoryForUser({ userId }: { userId: string | null }) {
  const [attempt, setAttempt] = useState(0)
  const [orders, setOrders] = useState<LegacyOrder[]>([])
  const [state, setState] = useState<'loading'|'ready'|'error'|'signed-out'>(userId ? 'loading' : 'signed-out')

  useEffect(() => {
    if (!userId) return
    let active = true
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setOrders([])
    setState('loading')
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('History timed out')) }, 8000)
    })
    const load = async () => {
      try {
        const request = supabase.rpc('get_my_bitrefill_order_history' as never)
        const bounded = typeof request.abortSignal === 'function' ? request.abortSignal(controller.signal) : request
        const { data, error } = await Promise.race([bounded, timeout])
        if (error) throw error
        const parsed = parseOrders(data)
        if (active) { setOrders(parsed); setState('ready') }
      } catch {
        if (active) { setOrders([]); setState('error') }
      } finally { if (timer) clearTimeout(timer) }
    }
    void load()
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer) }
  }, [userId, attempt])

  return <section className="mx-auto w-full max-w-lg rounded-2xl border bg-card p-4 text-left shadow-sm"
    aria-label="Previous gift-card orders">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="font-semibold">Previous gift-card orders</h2>
        <p className="text-xs text-muted-foreground">Your 10 most recent legacy orders. Purchasing is paused.</p></div>
      {userId && <button type="button" className="rounded-lg border px-3 py-1 text-sm"
        onClick={() => setAttempt(value => value + 1)} disabled={state === 'loading'}>
        {state === 'error' ? 'Retry' : 'Refresh'}</button>}
    </div>
    {state === 'signed-out' && <p className="pt-4 text-sm">Sign in to view previous orders.</p>}
    {state === 'loading' && <p className="pt-4 text-sm" role="status">Loading previous orders…</p>}
    {state === 'error' && <p className="pt-4 text-sm text-destructive" role="alert">
      Previous orders could not be loaded. Retry to check again.</p>}
    {state === 'ready' && orders.length === 0 && <p className="pt-4 text-sm">No previous gift-card orders found.</p>}
    {state === 'ready' && orders.length > 0 && <div className="mt-4 space-y-3">
      {orders.map(order => {
        const delivered = order.status === 'successful'
        const hasDetails = delivered && !!(order.redemption_code || order.redemption_pin || order.redemption_link)
        const link = safeLink(order.redemption_link)
        return <article key={order.id} className="min-w-0 rounded-xl border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <h3 className="min-w-0 break-words font-medium">{order.product_name}</h3>
            <span className="text-xs capitalize text-muted-foreground">{order.status.split('_').join(' ')}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{dateLabel(order.created_at)}
            {order.quantity !== null ? ` · Quantity ordered: ${order.quantity}` : ''}
            {order.amount_ngn !== null ? ` · ₦${order.amount_ngn.toLocaleString()}` : ''}</p>
          {order.quantity !== null && order.quantity > 1 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            This older order records one set of redemption details. It may not show every unit purchased.</p>}
          {hasDetails ? <div className="mt-3 space-y-2">
            {order.redemption_code && <Field label="Code" value={order.redemption_code} />}
            {order.redemption_pin && <Field label="PIN" value={order.redemption_pin} />}
            {order.redemption_link && <><Field label="Link" value={order.redemption_link} />
              {link && <a className="text-sm underline" href={link} target="_blank" rel="noopener noreferrer">Open redemption link</a>}</>}
            <button type="button" className="block rounded-lg border px-3 py-1 text-sm"
              onClick={() => download(order)}>Download details TXT</button>
          </div> : <p className="mt-2 text-xs text-muted-foreground">
            {delivered ? 'No redemption details were stored for this order.' : 'Redemption details are unavailable until delivery succeeds.'}
          </p>}
        </article>
      })}
    </div>}
  </section>
}

export default function LegacyGiftCardHistory() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  return <HistoryForUser key={userId ?? 'signed-out'} userId={userId} />
}
