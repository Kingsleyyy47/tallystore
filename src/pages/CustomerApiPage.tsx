import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/SimpleAuth'
import { customerApiRequest, type CustomerApiKey, type CustomerApiOverview, type CustomerApiSection } from '@/lib/customerApi'

const labels: Record<CustomerApiSection, string> = {
  products: 'Products', sms: 'SMS', social_boost: 'Social Boost', airtime: 'International Airtime', giftcards: 'Gift Cards', telegram: 'Telegram',
}

export default function CustomerApiPage() {
  const { user } = useAuth()
  return <CustomerApiAccount key={user?.id || 'signed-out'} userId={user?.id || null} />
}

function CustomerApiAccount({ userId }: { userId: string | null }) {
  const active = useRef(true)
  const reloadSequence = useRef(0)
  const accountAbort = useRef(new AbortController())
  const [overview, setOverview] = useState<CustomerApiOverview | null>(null)
  const [overviewState, setOverviewState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [section, setSection] = useState<CustomerApiSection>('products')
  const [label, setLabel] = useState('')
  const [newKey, setNewKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const sequence = ++reloadSequence.current
    setOverviewState('loading')
    setError('')
    try {
      if (!userId) throw new Error('Sign in to manage your API keys.')
      const data = await customerApiRequest<CustomerApiOverview>('/v1/keys', 'GET', undefined,
        { expectedUserId: userId, signal: accountAbort.current.signal })
      if (!active.current || sequence !== reloadSequence.current) return
      setOverview(data)
      setSection(current => data.access.allowed_sections.includes(current)
        ? current : (data.access.allowed_sections[0] || 'products'))
      setOverviewState('ready')
    } catch {
      if (!active.current || sequence !== reloadSequence.current) return
      setOverviewState('error')
      setError('Unable to load API keys. Please try again.')
    }
  }, [userId])
  useEffect(() => {
    const currentReloadSequence = reloadSequence
    active.current = true
    if (accountAbort.current.signal.aborted) accountAbort.current = new AbortController()
    void reload()
    return () => {
      active.current = false
      currentReloadSequence.current++
      accountAbort.current.abort()
      setNewKey('')
    }
  }, [reload])

  const createKey = async () => {
    setBusy(true); setError(''); setNewKey('')
    try {
      const data = await customerApiRequest<CustomerApiKey & { api_key: string }>('/v1/keys', 'POST', { section, label },
        { expectedUserId: userId || undefined, signal: accountAbort.current.signal })
      if (!active.current) return
      setNewKey(data.api_key)
      setLabel('')
      await reload()
    } catch {
      if (active.current) setError('Unable to create key. Please try again.')
    } finally { if (active.current) setBusy(false) }
  }
  const revokeKey = async (keyId: string) => {
    setBusy(true); setError(''); setNewKey('')
    try {
      await customerApiRequest(`/v1/keys/${keyId}`, 'DELETE', undefined,
        { expectedUserId: userId || undefined, signal: accountAbort.current.signal })
      if (!active.current) return
      await reload()
    } catch {
      if (active.current) setError('Unable to revoke key. Please try again.')
    } finally { if (active.current) setBusy(false) }
  }

  return <>
    <NavbarAuth />
    <main className="mx-auto min-h-[70vh] max-w-4xl px-4 py-10 text-foreground">
      <Link to="/profile" className="text-sm text-primary hover:underline">← Back to profile</Link>
      <h1 className="mt-5 text-3xl font-bold">Developer API keys</h1>
      <p className="mt-2 text-muted-foreground">Create separate keys for the services available to your account. Purchases use your verified TallyStore wallet and the current service price.</p>
      {error && <p role="alert" className="mt-5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {newKey && <section className="mt-6 rounded-xl border border-primary bg-primary/5 p-5">
        <h2 className="font-semibold">Copy your new key now</h2>
        <p className="mt-1 text-sm text-muted-foreground">It is shown only once. Store it securely and keep it out of browser code.</p>
        <code className="mt-3 block break-all rounded bg-background p-3 text-sm">{newKey}</code>
        <Button type="button" variant="outline" className="mt-3" onClick={() => void navigator.clipboard.writeText(newKey)}>Copy key</Button>
        <Button type="button" variant="ghost" className="mt-3 ml-2" onClick={() => setNewKey('')}>Close key</Button>
      </section>}
      <section className="mt-8 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">Create a section key</h2>
        {overviewState === 'loading'
          ? <p className="mt-2 text-sm text-muted-foreground">Loading access…</p>
          : overviewState === 'error'
          ? <p className="mt-2 text-sm text-muted-foreground">Access details are unavailable. Retry below.</p>
          : !overview?.access.is_active || !overview.access.allowed_sections.length
          ? <p className="mt-2 text-sm text-muted-foreground">API access has not been enabled for this account. Contact an admin if you need it.</p>
          : <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm">Service
                <select className="rounded-md border bg-background p-2" value={section} onChange={(event) => setSection(event.target.value as CustomerApiSection)}>
                  {overview.access.allowed_sections.map((item) => <option key={item} value={item}>{labels[item]}</option>)}
                </select>
              </label>
              <label className="grid flex-1 gap-1 text-sm">Key name
                <input className="min-w-48 rounded-md border bg-background p-2" maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="My integration" />
              </label>
              <Button type="button" disabled={busy || !label.trim()} onClick={() => void createKey()}>Create key</Button>
            </div>}
      </section>
      <section className="mt-8 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">Your keys</h2>
        {overviewState === 'loading' ? <p className="mt-3 text-sm">Loading…</p>
          : overviewState === 'error'
          ? <div className="mt-3 flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">Unable to load your keys.</p><Button type="button" variant="outline" onClick={() => void reload()}>Retry</Button></div>
          : !overview || overview.keys.length === 0
          ? <p className="mt-3 text-sm text-muted-foreground">No keys created yet.</p>
          : <ul className="mt-4 divide-y">{overview.keys.map((key) => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div><div className="font-medium">{key.label} · {labels[key.section]}</div>
              <code className="text-xs text-muted-foreground">{key.prefix}…</code>
              <p className="text-xs text-muted-foreground">{key.revoked_at ? 'Revoked' : `Created ${new Date(key.created_at).toLocaleDateString()}`}</p>
            </div>
            {!key.revoked_at && <Button type="button" variant="outline" disabled={busy} onClick={() => void revokeKey(key.id)}>Revoke</Button>}
          </li>)}</ul>}
      </section>
      <section className="mt-8 text-sm text-muted-foreground">
        <h2 className="font-semibold text-foreground">API endpoints</h2>
        <p className="mt-2">Send your key as <code>Authorization: Bearer YOUR_KEY</code>. Products, SMS, Social Boost, Gift Cards, and Telegram have <code>/v1/catalogue?section=products</code>; replace the section with the matching key’s service. Every section has <code>/v1/wallet?section=products</code> and <code>/v1/orders?section=products</code> with the same section substitution.</p>
        <p className="mt-2">For a product total, call <code>/v1/quote?section=products&amp;product_group_id=UUID&amp;quantity=1</code>. It includes your Tally Circle discount when eligible. Create an order with <code>POST /v1/purchases</code>, the quote’s <code>expected_amount_ngn</code>, and a unique idempotency key. Retrieve delivered credentials with <code>GET /v1/orders/ORDER_UUID?section=products</code>.</p>
        <p className="mt-2">SMS uses an <code>sms</code> key. Send your owned order’s <code>order_id</code> and <code>section: "sms"</code> to <code>POST /v1/sms/status</code> for the latest code or <code>POST /v1/sms/cancel</code> to request cancellation. Refunds require provider confirmation. These actions do not buy another number.</p>
        <p className="mt-2">International Airtime uses an <code>airtime</code> key and JSON POST requests to <code>/v1/airtime/check-phone</code> and <code>/v1/airtime/quote</code>. Pass the server quote’s total to <code>POST /v1/purchases</code>; use <code>/v1/airtime/status</code> to check an owned order. The phone number belongs in the request body.</p>
        <p className="mt-2">Gift Cards use a <code>giftcards</code> key. Get denominations from <code>/v1/giftcards/details</code>, then POST the product, package, value, quantity, and a unique <code>quote_request_id</code> to <code>/v1/giftcards/quote</code>. Purchase before expiry using its <code>quote_id</code> and quoted <code>amount_ngn</code> as <code>expected_amount_ngn</code>. Retry uncertain requests with the same IDs and selection. Check an owned order with <code>/v1/giftcards/status</code>.</p>
        <p className="mt-2">Telegram uses a <code>telegram</code> key. Get Stars quantities and available Premium plans from <code>/v1/catalogue?section=telegram</code>. Send <code>product_type</code> and either <code>quantity</code> for Stars or <code>product_id</code> for Premium to <code>POST /v1/telegram/quote</code>. Purchase with the quote’s <code>price_ngn</code> as <code>expected_amount_ngn</code>, a Telegram username, and a unique idempotency key. Use <code>/v1/telegram/status</code> with your order ID to check delivery.</p>
      </section>
    </main>
    <Footer />
  </>
}
