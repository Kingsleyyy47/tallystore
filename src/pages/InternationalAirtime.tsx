import { useCallback, useEffect, useRef, useState } from 'react'
import { Globe2, Loader2, Phone, RefreshCw, ShieldCheck } from 'lucide-react'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/SimpleAuth'
import { supabase } from '@/lib/supabase'

const PHONE = /^\+[1-9]\d{7,14}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const READ_DEADLINE_MS = 30_000
const PURCHASE_DEADLINE_MS = 45_000
const FINAL_STATUSES = new Set(['completed', 'failed'])

type Package = { package_id: string; unit_value: number }
type Range = { min: number; max: number; step: number }
type Product = { product_id: string; product_name: string; currency: string; packages: Package[]; range?: Range }
type Operator = { operator_id: string; operator_name: string; country_code: string; products: Product[] }
type Lookup = { success: true; recipient_phone: string; country_code: string; operators: Operator[] }
type Quote = { product_id: string; product_name: string; operator_id: string; operator_name: string;
  country_code: string; recipient_phone: string; package_id: string | null; unit_value: number;
  currency: string; amount_ngn: number }
type QuoteResponse = { success: true; quote: Quote }
type AirtimeOrder = { id: string; status: string; recipient_phone: string; product_name: string;
  amount_ngn: number; currency: string; created_at: string }
type PurchaseResponse = { success: boolean; order?: AirtimeOrder; outcome_unknown?: boolean }
type OrdersResponse = { success: true; orders: AirtimeOrder[] }
type StatusResponse = { success: true; order: AirtimeOrder }
type Intent = { idempotencyKey: string; orderId: string | null; userId: string; createdAt: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function safeText(value: unknown, max = 100): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
function parseLookup(value: unknown): Lookup | null {
  if (!isRecord(value) || value.success !== true || typeof value.recipient_phone !== 'string'
    || !PHONE.test(value.recipient_phone) || !Array.isArray(value.operators)) return null
  const operators: Operator[] = value.operators.slice(0, 30).flatMap((item) => {
    if (!isRecord(item) || !safeText(item.operator_id) || !Array.isArray(item.products)) return []
    const products: Product[] = item.products.slice(0, 100).flatMap((candidate) => {
      if (!isRecord(candidate) || !safeText(candidate.product_id) || !safeText(candidate.product_name)
        || !/^[A-Z]{3}$/.test(String(candidate.currency)) || !Array.isArray(candidate.packages)) return []
      const packages: Package[] = candidate.packages.slice(0, 100).flatMap((option) =>
        isRecord(option) && safeText(option.package_id) && positive(option.unit_value)
          ? [{ package_id: safeText(option.package_id), unit_value: option.unit_value }] : [])
      const range = isRecord(candidate.range) && positive(candidate.range.min) && positive(candidate.range.max)
        && positive(candidate.range.step) && candidate.range.max >= candidate.range.min
        ? { min: candidate.range.min, max: candidate.range.max, step: candidate.range.step } : undefined
      return packages.length || range ? [{ product_id: safeText(candidate.product_id),
        product_name: safeText(candidate.product_name), currency: candidate.currency as string, packages, range }] : []
    })
    return products.length ? [{ operator_id: safeText(item.operator_id),
      operator_name: safeText(item.operator_name) || 'Operator', country_code: safeText(item.country_code, 12), products }] : []
  })
  return { success: true, recipient_phone: value.recipient_phone,
    country_code: safeText(value.country_code, 12) || operators[0]?.country_code || '', operators }
}
function validQuote(value: unknown, lookup: Lookup, operator: Operator, product: Product,
  selection: Record<string, unknown>): value is Quote {
  if (!isRecord(value)) return false
  return value.product_id === product.product_id && value.operator_id === operator.operator_id
    && value.recipient_phone === lookup.recipient_phone && value.country_code === (operator.country_code || lookup.country_code)
    && typeof value.product_name === 'string' && !!safeText(value.product_name)
    && typeof value.operator_name === 'string' && !!safeText(value.operator_name)
    && typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
    && positive(value.unit_value) && positive(value.amount_ngn)
    && (selection.package_id === undefined
      ? value.package_id === null && value.unit_value === selection.unit_value
      : value.package_id === selection.package_id
        && value.unit_value === product.packages.find((item) => item.package_id === selection.package_id)?.unit_value)
}
function validOrder(value: unknown): value is AirtimeOrder {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && UUID.test(value.id)
    && typeof value.status === 'string' && !!safeText(value.status)
    && typeof value.recipient_phone === 'string' && PHONE.test(value.recipient_phone)
    && typeof value.product_name === 'string' && positive(value.amount_ngn)
    && typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
    && typeof value.created_at === 'string'
}
function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Date unavailable'
}
async function deadline<T>(request: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([request, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('request deadline')), milliseconds)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
async function invokeAirtime<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('customer-airtime', { body })
  if (error) throw new Error('Airtime service unavailable')
  return data as T
}
function storageKey(userId: string): string { return `tallystore:airtime-pending:${userId}` }
function readIntent(userId: string): Intent | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(userId)) || 'null')
    return isRecord(saved) && saved.userId === userId
      && typeof saved.idempotencyKey === 'string' && UUID.test(saved.idempotencyKey)
      && (saved.orderId === null || typeof saved.orderId === 'string' && UUID.test(saved.orderId))
      && typeof saved.createdAt === 'number'
      ? saved as Intent : null
  } catch { return null }
}
function saveIntent(value: Intent): boolean {
  try { localStorage.setItem(storageKey(value.userId), JSON.stringify(value)); return true }
  catch { return false }
}
function clearIntent(userId: string): void {
  try { localStorage.removeItem(storageKey(userId)) } catch { /* Keep the in-memory lock. */ }
}

export default function InternationalAirtime() {
  const { user, walletBalance, walletBalanceUnavailable } = useAuth()
  const [phoneInput, setPhoneInput] = useState('')
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [operatorId, setOperatorId] = useState('')
  const [productId, setProductId] = useState('')
  const [optionMode, setOptionMode] = useState<'package' | 'range'>('package')
  const [packageId, setPackageId] = useState('')
  const [unitValueInput, setUnitValueInput] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [recipientConfirmed, setRecipientConfirmed] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [quoteBusy, setQuoteBusy] = useState(false)
  const [purchaseBusy, setPurchaseBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [intent, setIntent] = useState<Intent | null>(() => user?.id ? readIntent(user.id) : null)
  const [orders, setOrders] = useState<AirtimeOrder[]>([])
  const [ordersBusy, setOrdersBusy] = useState(false)
  const [ordersError, setOrdersError] = useState(false)
  const [checkingOrderId, setCheckingOrderId] = useState<string | null>(null)
  const mounted = useRef(true)
  const userIdRef = useRef(user?.id)
  const accountEpoch = useRef(0)
  const lookupSeq = useRef(0)
  const quoteSeq = useRef(0)
  const purchaseLock = useRef(false)
  const selectionRef = useRef('')
  userIdRef.current = user?.id

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    accountEpoch.current++
    lookupSeq.current++
    quoteSeq.current++
    purchaseLock.current = false
    setLookupBusy(false)
    setQuoteBusy(false)
    setPurchaseBusy(false)
    setOrdersBusy(false)
    setCheckingOrderId(null)
    setIntent(user?.id ? readIntent(user.id) : null)
    setLookup(null)
    setQuote(null)
    setOrders([])
    setMessage('')
  }, [user?.id])

  const selectedOperator = lookup?.operators.find((item) => item.operator_id === operatorId)
  const selectedProduct = selectedOperator?.products.find((item) => item.product_id === productId)
  const busy = lookupBusy || quoteBusy || purchaseBusy

  const clearQuote = () => {
    quoteSeq.current++
    setQuote(null)
    setQuoteBusy(false)
    setRecipientConfirmed(false)
    setMessage('')
  }
  const chooseOperator = (value: string) => {
    clearQuote()
    const next = lookup?.operators.find((item) => item.operator_id === value)
    const product = next?.products[0]
    setOperatorId(value)
    setProductId(product?.product_id || '')
    setOptionMode(product?.packages.length ? 'package' : 'range')
    setPackageId(product?.packages[0]?.package_id || '')
    setUnitValueInput(product?.range ? String(product.range.min) : '')
  }
  const chooseProduct = (value: string) => {
    clearQuote()
    const product = selectedOperator?.products.find((item) => item.product_id === value)
    setProductId(value)
    setOptionMode(product?.packages.length ? 'package' : 'range')
    setPackageId(product?.packages[0]?.package_id || '')
    setUnitValueInput(product?.range ? String(product.range.min) : '')
  }

  const loadOrders = useCallback(async () => {
    if (!user?.id) return
    const actorId = user.id
    const epoch = accountEpoch.current
    setOrdersBusy(true)
    setOrdersError(false)
    try {
      const result = await deadline(invokeAirtime<OrdersResponse>({ action: 'orders' }), READ_DEADLINE_MS)
      if (!mounted.current || userIdRef.current !== actorId || accountEpoch.current !== epoch) return
      if (!result?.success || !Array.isArray(result.orders)) throw new Error('Invalid order history')
      const safeOrders = result.orders.filter(validOrder).slice(0, 100)
      setOrders(safeOrders)
      const pending = readIntent(actorId)
      const matching = pending?.orderId && safeOrders.find((order) => order.id === pending.orderId)
      if (pending && matching && FINAL_STATUSES.has(matching.status)) {
        clearIntent(actorId)
        setIntent(null)
      }
    } catch {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch) setOrdersError(true)
    } finally {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch) setOrdersBusy(false)
    }
  }, [user?.id])
  useEffect(() => { void loadOrders() }, [loadOrders])

  const checkPhone = async () => {
    if (!user?.id || intent || busy) return
    const number = phoneInput.trim()
    if (!PHONE.test(number)) { setMessage('Enter the full phone number with + and country code.'); return }
    const actorId = user.id
    const epoch = accountEpoch.current
    const sequence = ++lookupSeq.current
    quoteSeq.current++
    setLookupBusy(true)
    setLookup(null)
    setQuote(null)
    setMessage('')
    try {
      const result = await deadline(invokeAirtime<unknown>({ action: 'check_phone', phone_number: number }), READ_DEADLINE_MS)
      if (!mounted.current || userIdRef.current !== actorId || accountEpoch.current !== epoch || sequence !== lookupSeq.current) return
      const parsed = parseLookup(result)
      if (!parsed) throw new Error('Invalid phone lookup')
      setLookup(parsed)
      const operator = parsed.operators[0]
      const product = operator?.products[0]
      setOperatorId(operator?.operator_id || '')
      setProductId(product?.product_id || '')
      setOptionMode(product?.packages.length ? 'package' : 'range')
      setPackageId(product?.packages[0]?.package_id || '')
      setUnitValueInput(product?.range ? String(product.range.min) : '')
      if (!operator) setMessage('No airtime packages are available for this number.')
    } catch {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch && sequence === lookupSeq.current) {
        setMessage('Could not check this number right now. Please try again.')
      }
    } finally {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch && sequence === lookupSeq.current) setLookupBusy(false)
    }
  }

  const selection = (): Record<string, unknown> | null => {
    if (!lookup || !selectedOperator || !selectedProduct) return null
    const base = { phone_number: lookup.recipient_phone, operator_id: selectedOperator.operator_id,
      product_id: selectedProduct.product_id }
    if (optionMode === 'package') {
      if (!selectedProduct.packages.some((item) => item.package_id === packageId)) return null
      return { ...base, package_id: packageId }
    }
    const value = Number(unitValueInput)
    const range = selectedProduct.range
    if (!range || !Number.isFinite(value) || value < range.min || value > range.max
      || Math.abs((value - range.min) / range.step - Math.round((value - range.min) / range.step)) > 0.000001) return null
    return { ...base, unit_value: value }
  }

  const getQuote = async () => {
    if (!user?.id || intent || busy || !lookup || !selectedOperator || !selectedProduct) return
    const chosen = selection()
    if (!chosen) { setMessage('Choose a valid package or amount first.'); return }
    const actorId = user.id
    const epoch = accountEpoch.current
    const sequence = ++quoteSeq.current
    const fingerprint = JSON.stringify(chosen)
    selectionRef.current = fingerprint
    setQuoteBusy(true)
    setQuote(null)
    setRecipientConfirmed(false)
    setMessage('')
    try {
      const result = await deadline(invokeAirtime<QuoteResponse>({ action: 'quote', ...chosen }), READ_DEADLINE_MS)
      if (!mounted.current || userIdRef.current !== actorId || accountEpoch.current !== epoch || sequence !== quoteSeq.current
        || selectionRef.current !== fingerprint) return
      if (!result?.success || !validQuote(result.quote, lookup, selectedOperator, selectedProduct, chosen)) {
        throw new Error('Invalid quote')
      }
      setQuote(result.quote)
    } catch {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch && sequence === quoteSeq.current) {
        setMessage('A verified price could not be obtained. Nothing was purchased.')
      }
    } finally {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch && sequence === quoteSeq.current) setQuoteBusy(false)
    }
  }

  const confirmPurchase = async () => {
    if (!user?.id || !quote || !recipientConfirmed || intent || purchaseLock.current || busy) return
    const chosen = selection()
    if (!chosen || JSON.stringify(chosen) !== selectionRef.current
      || quote.recipient_phone !== chosen.phone_number || quote.product_id !== chosen.product_id) return
    const actorId = user.id
    const epoch = accountEpoch.current
    const nextIntent: Intent = { userId: actorId, idempotencyKey: crypto.randomUUID(), orderId: null, createdAt: Date.now() }
    if (!saveIntent(nextIntent)) { setMessage('This browser cannot safely save the order request. Please enable storage and try again.'); return }
    purchaseLock.current = true
    setIntent(nextIntent)
    setPurchaseBusy(true)
    setMessage('Submitting one airtime order. Please keep this page open.')
    try {
      const result = await deadline(invokeAirtime<PurchaseResponse>({
        action: 'purchase', ...chosen, idempotency_key: nextIntent.idempotencyKey,
        expected_amount_ngn: quote.amount_ngn,
      }), PURCHASE_DEADLINE_MS)
      if (!mounted.current || userIdRef.current !== actorId || accountEpoch.current !== epoch) return
      if (result?.order && validOrder(result.order)
        && result.order.recipient_phone === quote.recipient_phone
        && result.order.product_name === quote.product_name
        && result.order.amount_ngn === quote.amount_ngn
        && result.order.currency === quote.currency) {
        const updated = { ...nextIntent, orderId: result.order.id }
        saveIntent(updated)
        setIntent(updated)
        setOrders((current) => [result.order!, ...current.filter((row) => row.id !== result.order!.id)].slice(0, 100))
        if (result.success === true && !result.outcome_unknown && FINAL_STATUSES.has(result.order.status)) {
          clearIntent(actorId)
          setIntent(null)
        }
        setMessage(result.outcome_unknown ? 'The order outcome is not confirmed. Check its status before placing another order.'
          : result.order.status === 'completed' ? 'Airtime delivery completed.'
            : result.order.status === 'failed' ? 'This order failed. Check its details before trying a new order.'
              : 'Your order is processing. Check its status before placing another order.')
      } else {
        setMessage('The order result could not be confirmed. Do not submit it again. Check history or contact support.')
      }
    } catch {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch) {
        setMessage('The order result could not be confirmed. Do not submit it again. Check history or contact support.')
      }
    } finally {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch) {
        purchaseLock.current = false
        setPurchaseBusy(false)
      }
    }
  }

  const checkStatus = async (orderId: string) => {
    if (!user?.id || !UUID.test(orderId) || checkingOrderId) return
    const actorId = user.id
    const epoch = accountEpoch.current
    setCheckingOrderId(orderId)
    try {
      const result = await deadline(invokeAirtime<StatusResponse>({ action: 'status', order_id: orderId }), READ_DEADLINE_MS)
      if (!mounted.current || userIdRef.current !== actorId || accountEpoch.current !== epoch) return
      if (!result?.success || !validOrder(result.order) || result.order.id !== orderId) throw new Error('Invalid status')
      setOrders((current) => [result.order, ...current.filter((row) => row.id !== orderId)].slice(0, 100))
      if (intent?.orderId === orderId && FINAL_STATUSES.has(result.order.status)) {
        clearIntent(actorId)
        setIntent(null)
      }
      setMessage(FINAL_STATUSES.has(result.order.status)
        ? `Order ${result.order.status}. Its status was checked without placing another order.`
        : 'This order is still pending. No new purchase was made.')
    } catch {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch) setMessage('Order status is unavailable. Do not submit another purchase yet.')
    } finally {
      if (mounted.current && userIdRef.current === actorId && accountEpoch.current === epoch) setCheckingOrderId(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950 dark:bg-[#05070d] dark:text-white">
      <Navbar />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-purple-600 dark:text-purple-300">Global top-ups</p>
          <h1 className="flex items-center gap-3 text-2xl font-black sm:text-3xl"><Globe2 className="h-7 w-7 text-purple-600" /> International airtime</h1>
          <p className="text-sm text-muted-foreground">Enter the full phone number, choose its operator and package, then review the final wallet price before confirming.</p>
        </div>

        {intent && (
          <Card className="border-amber-300 dark:border-amber-500/40">
            <CardContent className="space-y-3 p-5 text-sm">
              <p className="font-bold">An airtime order still needs a confirmed outcome.</p>
              <p>Another purchase is disabled for this account in this browser until this order is checked. The same request will not be sent again automatically.</p>
              {intent.orderId ? <Button type="button" variant="outline" disabled={checkingOrderId !== null}
                onClick={() => void checkStatus(intent.orderId!)}>Check order status</Button>
                : <p>Refresh order history below. If the order is not listed, contact support with the time of your attempt before trying again.</p>}
            </CardContent>
          </Card>
        )}
        {message && <p role="status" className="rounded-xl border bg-background p-4 text-sm">{message}</p>}

        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Phone className="h-5 w-5" /> Recipient and package</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="space-y-2 text-sm font-semibold">Full phone number, including country code
                <Input type="tel" inputMode="tel" autoComplete="tel" maxLength={16} placeholder="+447700900123"
                  value={phoneInput} disabled={!!intent || purchaseBusy}
                  onChange={(event) => { setPhoneInput(event.target.value); lookupSeq.current++; setLookupBusy(false); setLookup(null); clearQuote() }} />
              </label>
              <Button type="button" disabled={!!intent || busy} onClick={() => void checkPhone()}>
                {lookupBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check number
              </Button>
            </div>

            {lookup && lookup.operators.length > 0 && (
              <div className="space-y-4 border-t pt-5">
                <p className="text-sm">Number checked: <strong className="break-all">{lookup.recipient_phone}</strong> · {lookup.country_code}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm font-semibold">Operator
                    <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={operatorId}
                      disabled={!!intent || busy} onChange={(event) => chooseOperator(event.target.value)}>
                      {lookup.operators.map((item) => <option key={item.operator_id} value={item.operator_id}>{item.operator_name}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm font-semibold">Airtime product
                    <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={productId}
                      disabled={!!intent || busy} onChange={(event) => chooseProduct(event.target.value)}>
                      {selectedOperator?.products.map((item) => <option key={item.product_id} value={item.product_id}>{item.product_name}</option>)}
                    </select>
                  </label>
                </div>
                {!!selectedProduct?.packages.length && !!selectedProduct.range && (
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2"><input type="radio" name="airtime-option" checked={optionMode === 'package'} disabled={!!intent || busy}
                      onChange={() => { clearQuote(); setOptionMode('package') }} /> Package</label>
                    <label className="flex items-center gap-2"><input type="radio" name="airtime-option" checked={optionMode === 'range'} disabled={!!intent || busy}
                      onChange={() => { clearQuote(); setOptionMode('range') }} /> Custom amount</label>
                  </div>
                )}
                {optionMode === 'package' && selectedProduct?.packages.length ? (
                  <label className="block space-y-2 text-sm font-semibold">Provider package
                    <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={packageId}
                      disabled={!!intent || busy} onChange={(event) => { clearQuote(); setPackageId(event.target.value) }}>
                      {selectedProduct.packages.map((item) => <option key={item.package_id} value={item.package_id}>
                        {item.unit_value.toLocaleString()} {selectedProduct.currency}
                      </option>)}
                    </select>
                  </label>
                ) : selectedProduct?.range ? (
                  <label className="block space-y-2 text-sm font-semibold">Airtime value ({selectedProduct.currency})
                    <Input type="number" min={selectedProduct.range.min} max={selectedProduct.range.max}
                      step={selectedProduct.range.step} value={unitValueInput} disabled={!!intent || busy}
                      onChange={(event) => { clearQuote(); setUnitValueInput(event.target.value) }} />
                    <span className="block text-xs font-normal text-muted-foreground">
                      {selectedProduct.range.min}–{selectedProduct.range.max} {selectedProduct.currency}, steps of {selectedProduct.range.step}
                    </span>
                  </label>
                ) : null}
                <Button type="button" variant="outline" disabled={!!intent || busy || !selectedProduct} onClick={() => void getQuote()}>
                  {quoteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Get verified price
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {quote && !intent && (
          <Card className="rounded-2xl border-purple-300 dark:border-purple-500/40">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-purple-600" /> Confirm this top-up</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>Send <strong>{quote.unit_value.toLocaleString()} {quote.currency}</strong> of {quote.product_name} to <strong className="break-all">{quote.recipient_phone}</strong> on {quote.operator_name}.</p>
              <p className="text-xl font-black">Wallet charge: {formatNaira(quote.amount_ngn)}</p>
              <p className="text-xs text-muted-foreground">Your spendable wallet balance is checked by the server when you confirm. {walletBalanceUnavailable ? 'Balance display is temporarily unavailable.' : `Currently shown: ${formatNaira(walletBalance)}.`}</p>
              <label className="flex items-start gap-3 rounded-xl border p-3 font-semibold">
                <input type="checkbox" className="mt-1" checked={recipientConfirmed} onChange={(event) => setRecipientConfirmed(event.target.checked)} />
                <span>I checked the full recipient number {quote.recipient_phone} and the wallet charge {formatNaira(quote.amount_ngn)}.</span>
              </label>
              <Button type="button" className="w-full sm:w-auto" disabled={!recipientConfirmed || purchaseBusy}
                onClick={() => void confirmPurchase()}>
                {purchaseBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm and pay {formatNaira(quote.amount_ngn)}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-lg">Airtime orders</CardTitle>
            <Button type="button" size="sm" variant="outline" disabled={ordersBusy} onClick={() => void loadOrders()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {ordersBusy ? <p role="status" className="text-sm text-muted-foreground">Loading orders…</p>
              : ordersError ? <p role="alert" className="text-sm">Order history is unavailable. Refresh to try again.</p>
                : orders.length === 0 ? <p className="text-sm text-muted-foreground">No international airtime orders yet.</p>
                  : orders.map((order) => (
                    <div key={order.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4">
                      <div className="min-w-0 space-y-1 text-sm">
                        <p className="font-bold">{safeText(order.product_name)} · {formatNaira(order.amount_ngn)}</p>
                        <p className="break-all">{order.recipient_phone}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(order.created_at)} · Order {order.id}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={order.status === 'failed' ? 'destructive' : order.status === 'completed' ? 'default' : 'secondary'}>{safeText(order.status, 30)}</Badge>
                        <Button type="button" size="sm" variant="outline" disabled={checkingOrderId !== null}
                          onClick={() => void checkStatus(order.id)}>
                          {checkingOrderId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Check status'}
                        </Button>
                      </div>
                    </div>
                  ))}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  )
}
