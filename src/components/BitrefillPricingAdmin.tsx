import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from '@/contexts/SimpleAuth'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const OWNER_ID = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const DEADLINE_MS = 30_000
type Kind = 'airtime' | 'gift_card' | 'sms'
type Mode = 'amount' | 'percent'
type Scope = 'global' | 'product' | 'denomination'
type Rule = { mode: Mode; value: number }
type Override = Rule & { scope: 'product' | 'denomination'; product_id: string;
  package_id: string | null; unit_value: number | null; currency: string | null }
type Product = { product_id: string; product_name: string; currency: string;
  packages: { package_id: string; unit_value: number }[]; range: { min: number; max: number; step: number } | null }
type Change = { scope: Scope; product_id?: string; package_id?: string | null;
  unit_value?: number | null; currency?: string | null; mode?: Mode; value?: number; remove?: true }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function rule(value: unknown): Rule | null {
  if (!record(value) || (value.mode !== 'amount' && value.mode !== 'percent')
    || typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0) return null
  return { mode: value.mode, value: value.value }
}
function override(value: unknown): Override | null {
  if (!record(value) || (value.scope !== 'product' && value.scope !== 'denomination')
    || typeof value.product_id !== 'string' || !value.product_id.trim()) return null
  const config = rule(value)
  if (!config) return null
  const packageId: string | null = typeof value.package_id === 'string' ? value.package_id : null
  const unitValue = value.unit_value === null || typeof value.unit_value === 'number' && Number.isFinite(value.unit_value)
    ? value.unit_value as number | null : null
  const currency: string | null = typeof value.currency === 'string' ? value.currency : null
  if (value.scope === 'denomination' && (!(typeof unitValue === 'number' && unitValue > 0)
    || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))) return null
  return { ...config, scope: value.scope, product_id: value.product_id.slice(0, 200),
    package_id: packageId, unit_value: unitValue, currency }
}
function product(value: unknown, expectedId: string): Product | null {
  if (!record(value) || value.product_id !== expectedId || typeof value.product_name !== 'string'
    || typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)
    || !Array.isArray(value.packages)) return null
  const packages = value.packages.flatMap((entry: unknown) => record(entry)
    && typeof entry.package_id === 'string' && entry.package_id.length > 0
    && typeof entry.unit_value === 'number' && Number.isFinite(entry.unit_value) && entry.unit_value > 0
    ? [{ package_id: entry.package_id, unit_value: entry.unit_value }] : [])
  const range = record(value.range) && ['min', 'max', 'step'].every(key => typeof value.range![key] === 'number')
    && Number(value.range.min) > 0 && Number(value.range.max) >= Number(value.range.min) && Number(value.range.step) > 0
    ? { min: Number(value.range.min), max: Number(value.range.max), step: Number(value.range.step) } : null
  return { product_id: value.product_id, product_name: value.product_name.slice(0, 120),
    currency: value.currency, packages, range }
}
function validValue(raw: string, mode: Mode): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) return null
  const number = Number(raw)
  return Number.isFinite(number) && number >= 0 && number <= (mode === 'percent' ? 1000 : 1_000_000_000) ? number : null
}
function label(ruleValue: Rule): string {
  return ruleValue.mode === 'percent' ? `Add ${ruleValue.value}% of supplier cost`
    : `Add ₦${ruleValue.value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
}
async function invoke(body: Record<string, unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const response = await Promise.race([
      supabase.functions.invoke('customer-airtime', { body }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), DEADLINE_MS) }),
    ])
    if (response.error) throw new Error('service unavailable')
    return response.data
  } finally { if (timer) clearTimeout(timer) }
}
function selector(change: Change): Change {
  return change.scope === 'global' ? { scope: 'global' }
    : change.scope === 'product' ? { scope: 'product', product_id: change.product_id }
      : { scope: 'denomination', product_id: change.product_id, package_id: change.package_id ?? null,
        unit_value: change.unit_value, currency: change.currency }
}

export default function BitrefillPricingAdmin({ kind, active = true }: { kind: Kind; active?: boolean }) {
  const { user } = useAuth()
  const owner = active && user?.id === OWNER_ID
  const [globalRule, setGlobalRule] = useState<Rule | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Override[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [globalMode, setGlobalMode] = useState<Mode>('percent')
  const [globalValue, setGlobalValue] = useState('')
  const [productId, setProductId] = useState('')
  const [verifiedProduct, setVerifiedProduct] = useState<Product | null>(null)
  const [scope, setScope] = useState<'product' | 'denomination'>('product')
  const [packageId, setPackageId] = useState('')
  const [useRange, setUseRange] = useState(false)
  const [unitValue, setUnitValue] = useState('')
  const [overrideMode, setOverrideMode] = useState<Mode>('percent')
  const [overrideValue, setOverrideValue] = useState('')
  const [pending, setPending] = useState<Change | null>(null)
  const mounted = useRef(true)
  const epoch = useRef(0)
  const lock = useRef(false)
  const ownerRef = useRef(owner)
  const kindRef = useRef(kind)
  const identity = `${kind}:${user?.id || ''}`
  ownerRef.current = owner
  kindRef.current = kind

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refresh = useCallback(async () => {
    if (!owner || lock.current) return
    const requestEpoch = ++epoch.current
    setLoading(true)
    setError('')
    setPending(null)
    try {
      const response = await invoke({ action: 'admin_pricing_get', kind })
      if (!mounted.current || !ownerRef.current || kindRef.current !== kind || epoch.current !== requestEpoch) return
      if (!record(response) || response.success !== true || !Array.isArray(response.overrides)) throw new Error('invalid pricing')
      const parsedGlobal = rule(response.global)
      const parsedOverrides = response.overrides.map(override)
      if (!parsedGlobal || parsedOverrides.some(item => !item)) throw new Error('invalid pricing')
      setGlobalRule(parsedGlobal)
      setLoadedFor(`${kind}:${user?.id || ''}`)
      setOverrides(parsedOverrides as Override[])
      setGlobalMode(parsedGlobal.mode)
      setGlobalValue(String(parsedGlobal.value))
      setUncertain(false)
    } catch {
      if (mounted.current && ownerRef.current && kindRef.current === kind && epoch.current === requestEpoch) setError('Pricing rules could not be loaded. Refresh to check their latest state.')
    } finally {
      if (mounted.current && ownerRef.current && kindRef.current === kind && epoch.current === requestEpoch) setLoading(false)
    }
  }, [kind, owner, user?.id])
  useEffect(() => {
    epoch.current++
    setGlobalRule(null)
    setLoadedFor(null)
    setOverrides([])
    setLoading(false)
    setBusy(lock.current)
    setVerifiedProduct(null)
    setPending(null)
    setUncertain(false)
    setError('')
    setNotice('')
    if (owner) void refresh()
  }, [owner, kind, refresh])

  const review = (change: Change) => {
    if (!owner || loadedFor !== identity || busy || loading || uncertain) return
    setPending(change)
    setError('')
    setNotice('')
  }
  const reviewGlobal = () => {
    const value = validValue(globalValue, globalMode)
    if (value === null) { setError('Enter a nonnegative amount or percentage with at most two decimal places.'); return }
    review({ scope: 'global', mode: globalMode, value })
  }
  const checkProduct = async () => {
    if (!owner || busy || loading || !productId.trim() || productId.length > 200) return
    const id = productId.trim()
    const requestEpoch = ++epoch.current
    setBusy(true)
    setVerifiedProduct(null)
    setPending(null)
    setError('')
    try {
      const response = await invoke({ action: 'admin_product_options', kind, product_id: id })
      if (!mounted.current || !ownerRef.current || kindRef.current !== kind || epoch.current !== requestEpoch) return
      if (!record(response) || response.success !== true) throw new Error('invalid product')
      const checked = product(response.product, id)
      if (!checked) throw new Error('invalid product')
      setVerifiedProduct(checked)
      setPackageId(checked.packages[0]?.package_id || '')
      setUseRange(!checked.packages.length)
      setUnitValue(checked.range ? String(checked.range.min) : '')
    } catch {
      if (mounted.current && ownerRef.current && kindRef.current === kind && epoch.current === requestEpoch) setError('This product could not be verified. Check its ID and try again.')
    } finally {
      if (mounted.current && ownerRef.current && kindRef.current === kind && epoch.current === requestEpoch) setBusy(false)
    }
  }
  const reviewOverride = () => {
    if (loadedFor !== identity || !verifiedProduct || verifiedProduct.product_id !== productId.trim()) return
    const value = validValue(overrideValue, overrideMode)
    if (value === null) { setError('Enter a nonnegative amount or percentage with at most two decimal places.'); return }
    const base = { product_id: verifiedProduct.product_id, mode: overrideMode, value }
    if (scope === 'product') { review({ scope: 'product', ...base }); return }
    if (!useRange) {
      const chosen = verifiedProduct.packages.find(item => item.package_id === packageId)
      if (!chosen) { setError('Select a verified package.'); return }
      review({ scope: 'denomination', ...base, package_id: chosen.package_id,
        unit_value: chosen.unit_value, currency: verifiedProduct.currency })
      return
    }
    const chosen = Number(unitValue)
    const range = verifiedProduct.range
    if (!range || !Number.isFinite(chosen) || chosen < range.min || chosen > range.max
      || Math.abs((chosen - range.min) / range.step - Math.round((chosen - range.min) / range.step)) > 0.000001) {
      setError('Choose a value within the verified range.'); return
    }
    review({ scope: 'denomination', ...base, package_id: null,
      unit_value: chosen, currency: verifiedProduct.currency })
  }
  const apply = async () => {
    if (!owner || loadedFor !== identity || !pending || uncertain || lock.current || loading) return
    lock.current = true
    const change = pending
    const requestEpoch = ++epoch.current
    setBusy(true)
    setError('')
    let confirmed = false
    try {
      const response = await invoke({ action: 'admin_pricing_set', kind, ...selector(change),
        ...(change.remove ? { remove: true } : { mode: change.mode, value: change.value }) })
      if (!mounted.current || !ownerRef.current || kindRef.current !== kind || epoch.current !== requestEpoch) return
      if (!record(response) || response.success !== true || typeof response.changed !== 'boolean') throw new Error('unconfirmed')
      confirmed = true
      setPending(null)
      setNotice(response.changed ? 'Pricing change was saved and audited.' : 'This pricing rule already has that value.')
    } catch {
      if (mounted.current && ownerRef.current && kindRef.current === kind && epoch.current === requestEpoch) {
        setUncertain(true)
        setPending(null)
        setError('The change could not be confirmed. Refresh pricing rules before making another change.')
      }
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
    if (confirmed && mounted.current && ownerRef.current && kindRef.current === kind && epoch.current === requestEpoch) void refresh()
  }

  if (!owner) return null
  const title = kind === 'gift_card' ? 'Gift card pricing' : kind === 'sms' ? 'SMS pricing' : 'International airtime pricing'
  return <Card className="min-w-0 rounded-2xl">
    <CardHeader className="flex flex-row items-center justify-between gap-3">
      <CardTitle className="text-lg">{title}</CardTitle>
      <Button type="button" variant="outline" size="sm" disabled={busy || loading} onClick={() => void refresh()}>
        <RefreshCw className="mr-2 h-4 w-4" /> Refresh
      </Button>
    </CardHeader>
    <CardContent className="min-w-0 space-y-6 text-sm">
      <p className="text-muted-foreground">Rules add to the verified supplier cost. An amount adds that many naira; a percentage adds that share of cost. The customer price is rounded up to the next ₦10 by the server. {kind === 'sms'
        ? 'A service rule takes priority over the global rule.'
        : 'A denomination rule takes priority over a product rule, then the global rule.'}</p>
      {kind === 'sms' && <p className="rounded-lg border border-amber-300 p-3">Saving a global SMS rule applies it to every SMS service. Existing manually set SMS prices continue until you save a global or individual rule.</p>}
      {loading && <p role="status">Loading pricing rules…</p>}
      {error && <p role="alert" className="rounded-lg border border-red-300 p-3 text-red-700 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-300 p-3">{notice}</p>}
      {globalRule && loadedFor === identity && !loading && <>
        <section className="space-y-3 rounded-xl border p-4">
          <h3 className="font-bold">Global rule</h3>
          <p>Current: {label(globalRule)}</p>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <label className="space-y-1">Method<select className="flex h-10 w-full rounded-md border bg-background px-3" value={globalMode}
              disabled={busy || uncertain} onChange={event => { setGlobalMode(event.target.value as Mode); setPending(null) }}>
              <option value="amount">Add naira</option><option value="percent">Add percent</option>
            </select></label>
            <label className="space-y-1">{globalMode === 'amount' ? 'Amount (₦)' : 'Percentage (%)'}
              <Input type="number" min="0" step="0.01" value={globalValue} disabled={busy || uncertain}
                onChange={event => { setGlobalValue(event.target.value); setPending(null) }} /></label>
            <Button type="button" variant="outline" disabled={busy || uncertain} onClick={reviewGlobal}>Review global change</Button>
          </div>
        </section>
        <section className="space-y-4 rounded-xl border p-4">
          <h3 className="font-bold">{kind === 'sms' ? 'SMS service overrides' : 'Product and denomination overrides'}</h3>
          <p className="text-muted-foreground">Verify the product before adding an override. The product ID and selected value are checked again by the server when saved.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 space-y-1">{kind === 'sms' ? 'SMS service code' : 'Product ID'}
              <Input value={productId} maxLength={200} disabled={busy || uncertain} onChange={event => {
                setProductId(event.target.value); setVerifiedProduct(null); setPending(null)
              }} /></label>
            <Button type="button" variant="outline" disabled={busy || uncertain || !productId.trim()} onClick={() => void checkProduct()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verify product
            </Button>
          </div>
          {verifiedProduct && <div className="space-y-3 rounded-lg border p-3">
            <p className="break-words font-semibold">Verified: {verifiedProduct.product_name} · {verifiedProduct.currency}</p>
            <label className="block space-y-1">Apply to
              <select className="flex h-10 w-full rounded-md border bg-background px-3" value={scope} disabled={busy || uncertain}
                onChange={event => { setScope(event.target.value as 'product' | 'denomination'); setPending(null) }}>
                <option value="product">All top-ups of this product</option>
                {kind !== 'sms' && <option value="denomination">One denomination</option>}
              </select>
            </label>
            {scope === 'denomination' && <>
              {!!verifiedProduct.packages.length && !!verifiedProduct.range && <label className="block space-y-1">Value type
                <select className="flex h-10 w-full rounded-md border bg-background px-3" value={useRange ? 'range' : 'package'}
                  disabled={busy || uncertain} onChange={event => { setUseRange(event.target.value === 'range'); setPending(null) }}>
                  <option value="package">Package</option><option value="range">Custom value</option>
                </select></label>}
              {!useRange && verifiedProduct.packages.length > 0 ? <label className="block space-y-1">Package
                <select className="flex h-10 w-full rounded-md border bg-background px-3" value={packageId} disabled={busy || uncertain}
                  onChange={event => { setPackageId(event.target.value); setPending(null) }}>
                  {verifiedProduct.packages.map(item => <option key={item.package_id} value={item.package_id}>
                    {item.unit_value.toLocaleString()} {verifiedProduct.currency} · {item.package_id}
                  </option>)}
                </select></label> : verifiedProduct.range && <label className="block space-y-1">Value ({verifiedProduct.currency})
                <Input type="number" min={verifiedProduct.range.min} max={verifiedProduct.range.max}
                  step={verifiedProduct.range.step} value={unitValue} disabled={busy || uncertain}
                  onChange={event => { setUnitValue(event.target.value); setPending(null) }} /></label>}
            </>}
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <label className="space-y-1">Method<select className="flex h-10 w-full rounded-md border bg-background px-3" value={overrideMode}
                disabled={busy || uncertain} onChange={event => { setOverrideMode(event.target.value as Mode); setPending(null) }}>
                <option value="amount">Add naira</option><option value="percent">Add percent</option>
              </select></label>
              <label className="space-y-1">{overrideMode === 'amount' ? 'Amount (₦)' : 'Percentage (%)'}
                <Input type="number" min="0" step="0.01" value={overrideValue} disabled={busy || uncertain}
                  onChange={event => { setOverrideValue(event.target.value); setPending(null) }} /></label>
              <Button type="button" variant="outline" disabled={busy || uncertain} onClick={reviewOverride}>Review override</Button>
            </div>
          </div>}
          {overrides.length ? <div className="space-y-2"><h4 className="font-semibold">Current overrides</h4>
            {overrides.map((item, index) => <div key={`${item.scope}:${item.product_id}:${item.package_id}:${item.unit_value}:${index}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <p className="min-w-0 break-all">{item.product_id} · {item.scope === 'product' ? 'all values'
                : `${item.unit_value} ${item.currency}${item.package_id ? ` · ${item.package_id}` : ''}`} · {label(item)}</p>
              <Button type="button" size="sm" variant="outline" disabled={busy || uncertain}
                onClick={() => review({ ...selector(item), remove: true })}>Review removal</Button>
            </div>)}</div> : <p className="text-muted-foreground">No overrides. The global rule applies.</p>}
        </section>
        {pending && <section className="space-y-3 rounded-xl border border-amber-300 p-4">
          <h3 className="font-bold">Confirm pricing change</h3>
          <p className="break-all">{pending.remove ? 'Remove the override for' : `Set ${label(pending as Rule)} for`} {pending.scope}
            {pending.product_id ? ` · ${pending.product_id}` : ''}
            {pending.scope === 'denomination' ? ` · ${pending.unit_value} ${pending.currency}${pending.package_id ? ` · ${pending.package_id}` : ''}` : ''}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || uncertain} onClick={() => void apply()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save audited change
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </section>}
      </>}
    </CardContent>
  </Card>
}
