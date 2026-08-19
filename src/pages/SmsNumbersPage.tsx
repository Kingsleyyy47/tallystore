import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactCountryFlag from 'react-country-flag'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Copy,
  Inbox,
  Loader2,
  MessageSquareText,
  Minus,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import NavbarAuth from '@/components/NavbarAuth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useSupportSettings } from '@/hooks/useSupportSettings'

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

const NAIRA = '\u20a6'
const SERVICE_BATCH_SIZE = 12

type SmsApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
  configured?: boolean
  valid?: boolean
  balance?: SmsProviderBalance | null
  waiting?: boolean
  idempotency_hit?: boolean
  new_balance?: number
  refund?: unknown
  messages?: SmsMessage[]
  diagnostics?: SmsDiagnostics
}

type SmsDiagnostics = {
  provider_host?: string
  provider_base_configured?: boolean
  country_id?: number
  verification_ok?: boolean
  verification_services?: number
  prices_ok?: boolean
  prices_services?: number
  selected_source?: string
}

type SmsProviderBalance = {
  frozen: number
  balance: number
}

type SmsService = {
  service_id: string
  project_id: number
  service_name: string
  service_code?: string | null
  country_id: number
  country_code?: string | null
  provider_cost_usd: number
  margin_usd: number
  total_cost_usd: number
  exchange_rate: number
  price_ngn: number
  available_count: number
  customer_buy_count?: number
  recommended_score?: number
  is_enabled?: boolean
  is_favorite?: boolean
  provider_cost_ngn?: number
  margin_ngn?: number
  price_override_ngn?: number | null
  pricing_mode?: 'auto_markup' | 'manual_margin' | 'override'
}

type SmsRentalArea = {
  area_code: string
  area_title: string
  unit_price: number
  min_month: number
  total: number
  provider_monthly_usd: number
  margin_monthly_usd: number
  total_monthly_usd: number
  exchange_rate: number
  price_ngn_monthly: number
}

type SmsMessage = {
  content?: string
  code?: string | null
  received_at?: string
  receive_at?: string
}

type SmsOrder = {
  id: string
  reference: string
  order_type: 'otp' | 'rental'
  service_name: string
  phone_number?: string | null
  raw_phone_number?: string | null
  area_code?: string | null
  price_ngn: number
  status: string
  messages: SmsMessage[]
  expires_at?: string | null
  keep_at?: string | null
  rent_months?: number | null
  refunded_at?: string | null
  refund_amount_ngn?: number | null
  refund_reference?: string | null
  created_at: string
}

type SmsTab = 'otp' | 'rental' | 'orders'
type ServiceSort = 'recommended' | 'price_low' | 'stock'

const SERVICE_SORT_LABELS: Record<ServiceSort, string> = {
  recommended: 'Recommended',
  price_low: 'Lowest price',
  stock: 'Most available',
}

const QUICK_SERVICE_TERMS = ['WhatsApp', 'Google', 'Telegram', 'Instagram', 'Facebook', 'Amazon']

const RENTAL_AREA_META: Record<string, { countryCode: string; name: string; dialCode?: string }> = {
  US: { countryCode: 'US', name: 'United States', dialCode: '+1' },
  CA: { countryCode: 'CA', name: 'Canada', dialCode: '+1' },
  GB: { countryCode: 'GB', name: 'United Kingdom', dialCode: '+44' },
  UK: { countryCode: 'GB', name: 'United Kingdom', dialCode: '+44' },
}

function formatNaira(value: number) {
  return `${NAIRA}${Number(value || 0).toLocaleString('en-NG')}`
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return date.toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function normalize(value?: string | number | null) {
  return String(value || '').toLowerCase().trim()
}

function getAreaMeta(area?: Pick<SmsRentalArea, 'area_code' | 'area_title'> | null) {
  const code = String(area?.area_code || '').trim().toUpperCase()
  return RENTAL_AREA_META[code] || {
    countryCode: code || 'US',
    name: area?.area_title || code || 'United States',
  }
}

function FlagMark({
  countryCode,
  name,
  className,
}: {
  countryCode: string
  name: string
  className?: string
}) {
  const code = countryCode.toUpperCase()
  const baseClass = cn(
    'relative block h-6 w-8 overflow-hidden rounded shadow-sm ring-1 ring-slate-200/70',
    className,
  )

  if (code === 'US') {
    return (
      <span
        role="img"
        aria-label={`${name} flag`}
        className={baseClass}
        style={{ background: 'repeating-linear-gradient(to bottom,#b91c1c 0 7.7%,#ffffff 7.7% 15.4%)' }}
      >
        <span className="absolute left-0 top-0 h-[54%] w-[45%] bg-[#1e3a8a]" />
      </span>
    )
  }

  if (code === 'GB') {
    return (
      <span
        role="img"
        aria-label={`${name} flag`}
        className={baseClass}
        style={{
          background:
            'linear-gradient(27deg,transparent 43%,#fff 43%,#fff 57%,transparent 57%),linear-gradient(-27deg,transparent 43%,#fff 43%,#fff 57%,transparent 57%),linear-gradient(27deg,transparent 47%,#c8102e 47%,#c8102e 53%,transparent 53%),linear-gradient(-27deg,transparent 47%,#c8102e 47%,#c8102e 53%,transparent 53%),linear-gradient(90deg,transparent 42%,#fff 42%,#fff 58%,transparent 58%),linear-gradient(0deg,transparent 36%,#fff 36%,#fff 64%,transparent 64%),linear-gradient(90deg,transparent 46%,#c8102e 46%,#c8102e 54%,transparent 54%),linear-gradient(0deg,transparent 43%,#c8102e 43%,#c8102e 57%,transparent 57%),#012169',
        }}
      />
    )
  }

  if (code === 'CA') {
    return (
      <span
        role="img"
        aria-label={`${name} flag`}
        className={baseClass}
        style={{ background: 'linear-gradient(90deg,#e11d48 0 25%,#fff 25% 75%,#e11d48 75% 100%)' }}
      >
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[#e11d48]" />
      </span>
    )
  }

  return (
    <span
      role="img"
      aria-label={`${name} flag`}
      className={baseClass}
      style={{ background: 'linear-gradient(135deg,#e2e8f0,#94a3b8)' }}
    />
  )
}

function isTerminalStatus(status: string) {
  return ['completed', 'cancelled', 'expired', 'failed'].includes(status)
}

function statusClass(status: string) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
  if (status === 'cancelled' || status === 'expired' || status === 'failed') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200'
  }
  return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200'
}

function safeSmsError(error: unknown, fallback = 'SMS request failed') {
  const message = error instanceof Error ? error.message : fallback
  if (/smsbus|provider|daisy|daisysms|api key|token|secret|backend/i.test(message)) {
    return 'SMS numbers are temporarily unavailable. Please try again later.'
  }
  return message || fallback
}

async function invokeSms<T>(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke<SmsApiResponse<T>>('smsbus', {
    body: { action, ...payload },
  })

  if (error) {
    const context = (error as { context?: Response }).context
    if (context) {
      const bodyText = await context.clone().text().catch(() => '')
      if (bodyText) {
        let message = bodyText
        try {
          const parsed = JSON.parse(bodyText)
          message = parsed?.error || parsed?.message || bodyText
        } catch {
          message = bodyText
        }
        throw new Error(message)
      }
    }
    throw new Error(error.message || 'SMS request failed')
  }

  if (!data?.success) {
    throw new Error(data?.error || 'SMS request failed')
  }

  return data
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-3xl bg-slate-100 p-6 text-center dark:bg-muted">
      <Inbox className="mx-auto h-8 w-8 text-slate-400" />
      <p className="mt-3 text-sm font-black">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-muted-foreground">{body}</p>
    </div>
  )
}

function SmsOrderCard({
  order,
  busy,
  onCheck,
  onCancel,
  onLatest,
  onHistory,
  onRenew,
}: {
  order: SmsOrder
  busy: boolean
  onCheck: (order: SmsOrder) => void
  onCancel: (order: SmsOrder) => void
  onLatest: (order: SmsOrder) => void
  onHistory: (order: SmsOrder) => void
  onRenew: (order: SmsOrder) => void
}) {
  const lastMessage = order.messages?.[order.messages.length - 1]
  const support = useSupportSettings()

  const copyPhone = async () => {
    if (!order.phone_number) return
    await navigator.clipboard.writeText(order.phone_number)
    toast.success('Phone number copied')
  }

  return (
    <Card className="rounded-[1.5rem] border-0 bg-white shadow-card dark:bg-card">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn('rounded-full px-3 py-1 capitalize hover:bg-current/10', statusClass(order.status))}>
                {order.status}
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1 uppercase">
                {order.order_type}
              </Badge>
            </div>
            <h3 className="mt-3 break-words text-lg font-black tracking-tight">{order.service_name}</h3>
            <p className="mt-1 break-all text-sm text-slate-500 dark:text-muted-foreground">{order.reference}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-lg font-black">{formatNaira(order.price_ngn)}</p>
            <p className="text-xs text-slate-500 dark:text-muted-foreground">{formatDate(order.created_at)}</p>
            {order.status === 'cancelled' && (
              <p className={cn(
                'mt-1 text-xs font-semibold',
                order.refunded_at ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300',
              )}>
                {order.refunded_at
                  ? `Refunded ${formatNaira(order.refund_amount_ngn || order.price_ngn)}`
                  : 'Refund pending'}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl bg-slate-100 p-4 dark:bg-muted">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
              Phone
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-lg font-black">{order.phone_number || 'Not assigned'}</p>
              {order.phone_number && (
                <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-xl" onClick={copyPhone}>
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-100 p-4 dark:bg-muted">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
              Last SMS
            </p>
            <p className="mt-2 min-h-7 break-words text-sm font-semibold">
              {lastMessage?.code || lastMessage?.content || 'No message yet'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {order.order_type === 'otp' && !isTerminalStatus(order.status) && (
            <>
              <Button type="button" className="rounded-2xl" disabled={busy} onClick={() => onCheck(order)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Check SMS
              </Button>
              <Button type="button" variant="outline" className="rounded-2xl" disabled={busy} onClick={() => onCancel(order)}>
                <XCircle className="h-4 w-4" />
                Cancel
              </Button>
            </>
          )}

          {order.order_type === 'rental' && !isTerminalStatus(order.status) && (
            <>
              <Button type="button" className="rounded-2xl" disabled={busy} onClick={() => onLatest(order)}>
                <MessageSquareText className="h-4 w-4" />
                Latest SMS
              </Button>
              <Button type="button" variant="outline" className="rounded-2xl" disabled={busy} onClick={() => onHistory(order)}>
                <Inbox className="h-4 w-4" />
                History
              </Button>
              <Button type="button" variant="outline" className="rounded-2xl" disabled={busy} onClick={() => onRenew(order)}>
                <RefreshCw className="h-4 w-4" />
                Renew
              </Button>
              <Button type="button" variant="outline" className="rounded-2xl" disabled={busy} onClick={() => onCancel(order)}>
                <XCircle className="h-4 w-4" />
                Cancel
              </Button>
            </>
          )}
        </div>

        {/* Message support row */}
        {(support.whatsappUrl || support.telegramUrl) && (
          <div className="mt-4 flex items-center gap-3 border-t pt-4 dark:border-white/10">
            <p className="text-xs text-slate-500 dark:text-muted-foreground">Need help?</p>
            {support.whatsappUrl && (
              <a
                href={support.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
              >
                <WhatsAppIcon className="h-3.5 w-3.5" />
                WhatsApp support
              </a>
            )}
            {support.telegramUrl && (
              <a
                href={support.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-xl bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
              >
                <TelegramIcon className="h-3.5 w-3.5" />
                Telegram support
              </a>
            )}
          </div>
        )}

        {order.order_type === 'rental' && (
          <div className="mt-4 grid gap-2 text-xs text-slate-500 dark:text-muted-foreground sm:grid-cols-2">
            <p>Expires: {formatDate(order.expires_at)}</p>
            <p>Renew before: {formatDate(order.keep_at)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 rounded-2xl border-slate-200 bg-white pl-11 pr-4 text-sm font-semibold shadow-none dark:border-white/10 dark:bg-background"
      />
    </div>
  )
}

function SmsMessageSupportCard() {
  const support = useSupportSettings()
  if (!support.whatsappUrl && !support.telegramUrl) return null

  return (
    <Card className="h-fit rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
      <CardContent className="p-5 sm:p-6">
        <h3 className="font-black tracking-tight">Message support</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
          Having trouble? Reach our team directly.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {support.whatsappUrl && (
            <a
              href={support.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
            >
              <WhatsAppIcon className="h-5 w-5 shrink-0" />
              WhatsApp support
            </a>
          )}
          {support.telegramUrl && (
            <a
              href={support.telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
            >
              <TelegramIcon className="h-5 w-5 shrink-0" />
              Telegram support
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SmsNumbersSurface() {
  const [activeTab, setActiveTab] = useState<SmsTab>('otp')
  const [health, setHealth] = useState<SmsApiResponse<never> | null>(null)
  const [smsDiagnostics, setSmsDiagnostics] = useState<SmsDiagnostics | null>(null)
  const [services, setServices] = useState<SmsService[]>([])
  const [areas, setAreas] = useState<SmsRentalArea[]>([])
  const [orders, setOrders] = useState<SmsOrder[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [selectedAreaCode, setSelectedAreaCode] = useState('US')
  const [rentalMonths, setRentalMonths] = useState(1)
  const [serviceQuery, setServiceQuery] = useState('')
  const [serviceSort, setServiceSort] = useState<ServiceSort>('recommended')
  const [visibleServiceCount, setVisibleServiceCount] = useState(SERVICE_BATCH_SIZE)
  const [rentalQuery, setRentalQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const configured = health?.configured === true
  const numbersReady = configured && health?.valid !== false
  const selectedService = services.find((service) => service.service_id === selectedServiceId)
  const selectedArea = areas.find((area) => area.area_code === selectedAreaCode)
  const activeOrders = useMemo(
    () => orders.filter((order) => !isTerminalStatus(order.status)),
    [orders],
  )

  const serviceStats = useMemo(() => {
    const priced = services.filter((service) => Number(service.price_ngn) > 0)
    const lowest = priced.length ? Math.min(...priced.map((service) => service.price_ngn)) : 0
    const stock = services.reduce((total, service) => total + Number(service.available_count || 0), 0)
    return { lowest, stock }
  }, [services])

  const filteredServices = useMemo(() => {
    const query = normalize(serviceQuery)
    const matches = services.filter((service) => {
      if (!query) return true
      return [
        service.service_name,
        service.service_code,
        service.project_id,
        service.available_count,
        service.price_ngn,
      ].some((value) => normalize(value).includes(query))
    })

    return [...matches].sort((a, b) => {
      if (serviceSort === 'recommended') {
        const scoreRank = Number(b.recommended_score || 0) - Number(a.recommended_score || 0)
        if (scoreRank !== 0) return scoreRank
        return Number(b.customer_buy_count || 0) - Number(a.customer_buy_count || 0) || b.available_count - a.available_count || a.price_ngn - b.price_ngn
      }
      const favoriteRank = Number(b.is_favorite === true) - Number(a.is_favorite === true)
      if (favoriteRank !== 0) return favoriteRank
      if (serviceSort === 'price_low') return a.price_ngn - b.price_ngn
      return b.available_count - a.available_count
    })
  }, [services, serviceQuery, serviceSort])

  const visibleServices = filteredServices.slice(0, visibleServiceCount)
  const smsDiagnosticText = useMemo(() => {
    if (!smsDiagnostics) return ''
    const country = smsDiagnostics.country_id ? `Country: ${smsDiagnostics.country_id}` : ''
    const verification = `getPricesVerification: ${smsDiagnostics.verification_services ?? 0}`
    const prices = `getPrices: ${smsDiagnostics.prices_services ?? 0}`
    return [country, verification, prices].filter(Boolean).join(' · ')
  }, [smsDiagnostics])

  const filteredAreas = useMemo(() => {
    const query = normalize(rentalQuery)
    return areas
      .filter((area) => {
        if (!query) return true
        const meta = getAreaMeta(area)
        return [area.area_code, area.area_title, meta.name, meta.dialCode].some((value) => normalize(value).includes(query))
      })
      .sort((a, b) => b.total - a.total || a.price_ngn_monthly - b.price_ngn_monthly)
  }, [areas, rentalQuery])

  useEffect(() => {
    setVisibleServiceCount(SERVICE_BATCH_SIZE)
  }, [serviceQuery, serviceSort])

  useEffect(() => {
    if (!selectedServiceId && services[0]) {
      setSelectedServiceId(services[0].service_id)
    }
  }, [selectedServiceId, services])

  useEffect(() => {
    if (areas.length > 0 && !areas.some((area) => area.area_code === selectedAreaCode)) {
      setSelectedAreaCode(areas[0].area_code)
    }
  }, [areas, selectedAreaCode])

  useEffect(() => {
    if (!selectedArea) return
    setRentalMonths((current) => Math.min(12, Math.max(selectedArea.min_month || 1, current || 1)))
  }, [selectedArea])

  const loadSmsNumbers = useCallback(async () => {
    setLoading(true)
    try {
      const [healthResult, orderResult] = await Promise.all([
        invokeSms<never>('health'),
        invokeSms<SmsOrder[]>('orders'),
      ])

      setHealth(healthResult)
      setOrders(orderResult.data || [])
      window.dispatchEvent(new Event('transactionAdded'))

      if (healthResult.configured && healthResult.valid !== false) {
        const [serviceResult, areaResult] = await Promise.all([
          invokeSms<SmsService[]>('services', { country_code: 'us' }),
          invokeSms<SmsRentalArea[]>('rental_areas'),
        ])

        setSmsDiagnostics(serviceResult.diagnostics || null)
        setServices(serviceResult.data || [])
        setAreas(areaResult.data || [])

        if (serviceResult.data?.[0]) {
          setSelectedServiceId((current) => current || serviceResult.data?.[0]?.service_id || '')
        }
      } else {
        setSmsDiagnostics(null)
        setServices([])
        setAreas([])
      }
    } catch (error) {
      toast.error(safeSmsError(error, 'Failed to load SMS numbers'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSmsNumbers()
  }, [loadSmsNumbers])

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusyAction(label)
    try {
      await action()
    } catch (error) {
      toast.error(safeSmsError(error, 'SMS action failed'))
    } finally {
      setBusyAction(null)
    }
  }

  const refreshOrders = useCallback(async () => {
    const result = await invokeSms<SmsOrder[]>('orders')
    setOrders(result.data || [])
    window.dispatchEvent(new Event('transactionAdded'))
  }, [])

  useEffect(() => {
    if (activeOrders.length === 0) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshOrders().catch((error) => console.error('Failed to refresh SMS orders:', error))
      }
    }, 30000)
    return () => window.clearInterval(timer)
  }, [activeOrders.length, refreshOrders])

  const buyOtp = () => runAction('buy-otp', async () => {
    if (!selectedService) throw new Error('Select an OTP service first')

    const result = await invokeSms<SmsOrder>('create_otp', {
      country_id: selectedService.country_id,
      service_id: selectedService.service_id,
      expected_price_ngn: selectedService.price_ngn,
      idempotency_key: `sms-otp-${selectedService.service_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    })

    toast.success('OTP number purchased')
    if (typeof result.new_balance === 'number') {
      window.dispatchEvent(new Event('transactionAdded'))
    }
    await refreshOrders()
    setActiveTab('orders')
  })

  const rentNumber = () => runAction('rent-number', async () => {
    if (!selectedArea) throw new Error('Select a rental country first')

    const result = await invokeSms<SmsOrder>('rent_number', {
      area_code: selectedArea.area_code,
      months: rentalMonths,
      idempotency_key: `sms-rental-${selectedArea.area_code}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    })

    toast.success('Rental number purchased')
    if (typeof result.new_balance === 'number') {
      window.dispatchEvent(new Event('transactionAdded'))
    }
    await refreshOrders()
    setActiveTab('orders')
  })

  const checkOtp = (order: SmsOrder) => runAction(`check-${order.id}`, async () => {
    const result = await invokeSms<SmsOrder>('check_otp', { order_id: order.id })
    toast.success(result.waiting ? 'Still waiting for SMS' : 'SMS status updated')
    await refreshOrders()
  })

  const cancelOrder = (order: SmsOrder) => runAction(`cancel-${order.id}`, async () => {
    await invokeSms<SmsOrder>(order.order_type === 'otp' ? 'cancel_otp' : 'cancel_rental', { order_id: order.id })
    toast.success('Order cancelled')
    window.dispatchEvent(new Event('transactionAdded'))
    await refreshOrders()
  })

  const loadRentalSms = (order: SmsOrder, mode: 'latest' | 'history') => runAction(`${mode}-${order.id}`, async () => {
    await invokeSms<SmsOrder>('rental_sms', { order_id: order.id, mode })
    toast.success(mode === 'latest' ? 'Latest SMS checked' : 'SMS history loaded')
    await refreshOrders()
  })

  const renewRental = (order: SmsOrder) => runAction(`renew-${order.id}`, async () => {
    const result = await invokeSms<SmsOrder>('renew_rental', { order_id: order.id, months: 1 })
    toast.success('Rental renewed for one month')
    if (typeof result.new_balance === 'number') {
      window.dispatchEvent(new Event('transactionAdded'))
    }
    await refreshOrders()
  })

  const unavailable = !loading && (!configured || health?.valid === false)
  const selectedAreaMeta = getAreaMeta(selectedArea)
  const rentalTotal = selectedArea ? selectedArea.price_ngn_monthly * rentalMonths : 0

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 sm:space-y-6">
      <Card className="overflow-hidden rounded-2xl border border-purple-200/70 bg-[radial-gradient(circle_at_88%_20%,rgba(34,211,238,0.22),transparent_12rem),linear-gradient(135deg,#2d145c_0%,#171827_58%,#10131f_100%)] text-white shadow-[0_18px_55px_rgba(88,64,179,0.22)] dark:border-white/10">
        <CardContent className="relative p-4 sm:p-6">
          <div className="absolute bottom-0 right-0 h-24 w-40 rounded-tl-full bg-purple-400/10 blur-2xl" />
          <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="mb-3 flex min-w-0 items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/10 sm:h-12 sm:w-12">
                  <ReactCountryFlag countryCode="US" svg className="text-2xl" aria-label="United States" />
                </span>
                <div className="min-w-0">
                  <Badge className="mb-1 rounded-full bg-cyan-300/15 px-3 py-1 text-[11px] text-cyan-100 hover:bg-cyan-300/15">
                    US numbers
                  </Badge>
                  <h1 className="truncate text-2xl font-black tracking-tight sm:text-3xl">SMS Numbers</h1>
                </div>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-200">
                Pick an OTP service, rent a number, or return to active numbers without digging through a long page.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <Button type="button" className="h-10 rounded-xl bg-white px-3 text-xs font-black text-[#5637aa] hover:bg-cyan-50 sm:px-4 sm:text-sm" onClick={loadSmsNumbers}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
              <Button asChild className="h-10 rounded-xl bg-white/10 px-3 text-xs font-black text-white hover:bg-white/15 hover:text-white sm:px-4 sm:text-sm">
                <Link to="/dashboard">
                  <ArrowLeft className="h-4 w-4" />
                  Wallet
                </Link>
              </Button>
            </div>
          </div>

          <div className="relative mt-4 grid grid-cols-4 gap-1.5 sm:gap-3">
            {[
              { icon: Wallet, label: 'Wallet', value: numbersReady ? 'Ready' : 'Paused' },
              { icon: PhoneCall, label: 'OTP', value: loading ? '...' : services.length.toLocaleString() },
              { icon: CalendarDays, label: 'Rentals', value: loading ? '...' : areas.length.toLocaleString() },
              { icon: Inbox, label: 'Mine', value: activeOrders.length.toLocaleString() },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.07] p-2 text-center sm:rounded-2xl sm:p-3">
                  <Icon className="mx-auto h-4 w-4 text-cyan-200 sm:h-5 sm:w-5" />
                  <p className="mt-1 truncate text-[10px] font-bold text-slate-300 sm:text-xs">{item.label}</p>
                  <p className="truncate text-sm font-black sm:text-lg">{item.value}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {unavailable && (
        <Card className="rounded-[1.75rem] border border-amber-200 bg-amber-50 shadow-card dark:border-amber-500/20 dark:bg-amber-500/10">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight">SMS numbers are temporarily unavailable</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-muted-foreground">
                Live stock could not be loaded right now. Your wallet and existing orders are unaffected.
              </p>
            </div>
            <Badge className="w-fit rounded-full bg-amber-200 px-4 py-2 text-amber-900 hover:bg-amber-200">
              Please try again later
            </Badge>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1.5 shadow-card dark:bg-card sm:inline-grid sm:gap-2 sm:rounded-3xl sm:p-2">
        {[
          { id: 'otp' as const, label: 'OTP numbers', icon: PhoneCall },
          { id: 'rental' as const, label: 'Rentals', icon: CalendarDays },
          { id: 'orders' as const, label: 'My numbers', icon: Inbox },
        ].map((tab) => {
          const Icon = tab.icon
          return (
            <Button
              key={tab.id}
              type="button"
              variant="ghost"
              className={cn(
                'h-10 min-w-0 justify-center rounded-xl px-2 text-[11px] font-black sm:h-11 sm:rounded-2xl sm:px-4 sm:text-sm',
                activeTab === tab.id
                  ? 'bg-slate-950 text-white shadow-sm hover:bg-slate-900 hover:text-white dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100'
                  : 'text-slate-700 hover:bg-violet-50 hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-white/10 dark:hover:text-foreground',
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{tab.label}</span>
            </Button>
          )
        })}
      </div>

      {activeTab === 'otp' && (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-w-0 rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight">Choose a service</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
                    {loading ? 'Loading available services...' : `${filteredServices.length.toLocaleString()} matches from ${services.length.toLocaleString()} services`}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit rounded-full px-3 py-1">
                  United States
                </Badge>
              </div>

              <div className="mt-6 flex min-w-0 flex-col gap-3 lg:flex-row">
                <SearchField value={serviceQuery} onChange={setServiceQuery} placeholder="Search WhatsApp, Google, Telegram..." />
                <div className="relative lg:w-56">
                  <SlidersHorizontal className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    value={serviceSort}
                    onChange={(event) => setServiceSort(event.target.value as ServiceSort)}
                    className="h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-white pl-11 pr-8 text-sm font-semibold outline-none focus:border-violet-400 dark:border-white/10 dark:bg-background"
                  >
                    {(Object.keys(SERVICE_SORT_LABELS) as ServiceSort[]).map((key) => (
                      <option key={key} value={key}>{SERVICE_SORT_LABELS[key]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {QUICK_SERVICE_TERMS.map((term) => (
                  <Button
                    key={term}
                    type="button"
                    variant={serviceQuery === term ? 'default' : 'outline'}
                    className="h-9 shrink-0 rounded-full px-4 text-xs"
                    onClick={() => setServiceQuery(serviceQuery === term ? '' : term)}
                  >
                    {term}
                  </Button>
                ))}
              </div>

              <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {loading && services.length === 0 ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-36 animate-pulse rounded-3xl bg-slate-100 dark:bg-muted" />
                  ))
                ) : visibleServices.length === 0 ? (
                  <div className="md:col-span-2 xl:col-span-3">
                    <EmptyState
                      title={services.length === 0 ? 'No OTP services available' : 'No service found'}
                      body={services.length === 0 ? 'The SMS provider did not return live stock for this country.' : 'Try another app name or clear the search.'}
                    />
                    {services.length === 0 && smsDiagnosticText && (
                      <p className="mt-3 text-center text-xs text-slate-500 dark:text-muted-foreground">
                        {smsDiagnosticText}
                      </p>
                    )}
                  </div>
                ) : visibleServices.map((service) => {
                  const selected = selectedServiceId === service.service_id
                  return (
                    <button
                      key={service.service_id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedServiceId(service.service_id)}
                      className={cn(
                        'min-w-0 rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card',
                        selected
                          ? 'border-violet-400 bg-violet-50 shadow-[0_16px_40px_rgba(91,55,183,0.14)] dark:bg-violet-500/10'
                          : 'border-slate-100 bg-slate-50 dark:border-white/10 dark:bg-background',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-black tracking-tight">{service.service_name}</p>
                          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                            {service.service_code || `ID ${service.project_id}`}
                          </p>
                        </div>
                        <ChevronRight className={cn('h-5 w-5 shrink-0', selected ? 'text-violet-600' : 'text-slate-300')} />
                      </div>
                      <div className="mt-5 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xl font-black">{formatNaira(service.price_ngn)}</p>
                          <p className="text-xs text-slate-500 dark:text-muted-foreground">per number</p>
                        </div>
                        <Badge variant="outline" className="rounded-full bg-white/70 px-3 py-1 dark:bg-white/5">
                          {service.available_count.toLocaleString()} left
                        </Badge>
                      </div>
                    </button>
                  )
                })}
              </div>

              {filteredServices.length > visibleServiceCount && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-5 h-11 w-full rounded-2xl"
                  onClick={() => setVisibleServiceCount((count) => count + SERVICE_BATCH_SIZE)}
                >
                  Show more services
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
            <CardContent className="p-5 sm:p-6">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200">
                <PhoneCall className="h-6 w-6" />
              </div>
              <h3 className="mt-5 text-xl font-black tracking-tight">Selected number</h3>

              <div className="mt-5 rounded-3xl bg-slate-100 p-4 dark:bg-muted">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                  Service
                </p>
                <p className="mt-2 break-words text-lg font-black">
                  {selectedService ? selectedService.service_name : 'Choose a service'}
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-3xl bg-slate-100 p-4 dark:bg-muted">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                    Price
                  </p>
                  <p className="mt-2 text-xl font-black">{selectedService ? formatNaira(selectedService.price_ngn) : '-'}</p>
                </div>
                <div className="rounded-3xl bg-slate-100 p-4 dark:bg-muted">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                    Stock
                  </p>
                  <p className="mt-2 text-xl font-black">{selectedService ? selectedService.available_count.toLocaleString() : '-'}</p>
                </div>
              </div>

              <Button
                type="button"
                className="mt-5 h-12 w-full rounded-2xl px-6"
                disabled={!numbersReady || !selectedService || busyAction === 'buy-otp'}
                onClick={buyOtp}
              >
                {busyAction === 'buy-otp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                Buy OTP Number
              </Button>

              <div className="mt-5 grid gap-3 text-sm text-slate-600 dark:text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <span>Lowest price</span>
                  <strong className="text-slate-950 dark:text-foreground">{serviceStats.lowest ? formatNaira(serviceStats.lowest) : '-'}</strong>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Total stock</span>
                  <strong className="text-slate-950 dark:text-foreground">{serviceStats.stock.toLocaleString()}</strong>
                </div>
              </div>
            </CardContent>
          </Card>

          <SmsMessageSupportCard />
        </div>
      )}

      {activeTab === 'rental' && (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-w-0 rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight">Choose a rental country</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
                    {loading ? 'Loading rental countries...' : `${filteredAreas.length.toLocaleString()} countries available`}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit rounded-full px-3 py-1">
                  Monthly rentals
                </Badge>
              </div>

              <div className="mt-6">
                <SearchField value={rentalQuery} onChange={setRentalQuery} placeholder="Search country or dial code..." />
              </div>

              <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {loading && areas.length === 0 ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-40 animate-pulse rounded-3xl bg-slate-100 dark:bg-muted" />
                  ))
                ) : filteredAreas.length === 0 ? (
                  <div className="md:col-span-2 xl:col-span-3">
                    <EmptyState title="No rental country found" body="Try searching by country name or dial code." />
                  </div>
                ) : filteredAreas.map((area) => {
                  const meta = getAreaMeta(area)
                  const selected = selectedAreaCode === area.area_code
                  return (
                    <button
                      key={area.area_code}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedAreaCode(area.area_code)}
                      className={cn(
                        'min-w-0 rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card',
                        selected
                          ? 'border-cyan-400 bg-cyan-50 shadow-[0_16px_40px_rgba(14,165,233,0.14)] dark:bg-cyan-500/10'
                          : 'border-slate-100 bg-slate-50 dark:border-white/10 dark:bg-background',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white shadow-sm dark:bg-white/10">
                          <FlagMark countryCode={meta.countryCode} name={meta.name} />
                        </span>
                        <Badge variant="outline" className="rounded-full bg-white/70 px-3 py-1 dark:bg-white/5">
                          {meta.dialCode || area.area_code}
                        </Badge>
                      </div>
                      <p className="mt-5 truncate text-lg font-black tracking-tight">{meta.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">{area.total.toLocaleString()} numbers available</p>
                      <div className="mt-5 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xl font-black">{formatNaira(area.price_ngn_monthly)}</p>
                          <p className="text-xs text-slate-500 dark:text-muted-foreground">per month</p>
                        </div>
                        <ChevronRight className={cn('h-5 w-5 shrink-0', selected ? 'text-cyan-700' : 'text-slate-300')} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="h-fit rounded-[1.75rem] border-0 bg-white shadow-card dark:bg-card">
            <CardContent className="p-5 sm:p-6">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
                <CalendarDays className="h-6 w-6" />
              </div>
              <h3 className="mt-5 text-xl font-black tracking-tight">Rental summary</h3>

              <div className="mt-5 rounded-3xl bg-slate-100 p-4 dark:bg-muted">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                  Country
                </p>
                <div className="mt-2 flex min-w-0 items-center gap-3">
                  <FlagMark countryCode={selectedAreaMeta.countryCode} name={selectedAreaMeta.name} />
                  <p className="min-w-0 truncate text-lg font-black">{selectedArea ? selectedAreaMeta.name : 'Choose a country'}</p>
                </div>
              </div>

              <div className="mt-3 rounded-3xl bg-slate-100 p-4 dark:bg-muted">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                  Months
                </p>
                <div className="mt-3 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-2xl"
                    disabled={!selectedArea || rentalMonths <= (selectedArea.min_month || 1)}
                    onClick={() => setRentalMonths((months) => Math.max(selectedArea?.min_month || 1, months - 1))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min={selectedArea?.min_month || 1}
                    max={12}
                    value={rentalMonths}
                    onChange={(event) => {
                      const next = Number(event.target.value || selectedArea?.min_month || 1)
                      setRentalMonths(Math.min(12, Math.max(selectedArea?.min_month || 1, next)))
                    }}
                    className="h-11 rounded-2xl text-center text-lg font-black"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-2xl"
                    disabled={!selectedArea || rentalMonths >= 12}
                    onClick={() => setRentalMonths((months) => Math.min(12, months + 1))}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-3xl bg-slate-100 p-4 dark:bg-muted">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                    Monthly
                  </p>
                  <p className="mt-2 text-xl font-black">{selectedArea ? formatNaira(selectedArea.price_ngn_monthly) : '-'}</p>
                </div>
                <div className="rounded-3xl bg-slate-100 p-4 dark:bg-muted">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-muted-foreground">
                    Total
                  </p>
                  <p className="mt-2 text-xl font-black">{selectedArea ? formatNaira(rentalTotal) : '-'}</p>
                </div>
              </div>

              <Button
                type="button"
                className="mt-5 h-12 w-full rounded-2xl px-6"
                disabled={!numbersReady || !selectedArea || busyAction === 'rent-number'}
                onClick={rentNumber}
              >
                {busyAction === 'rent-number' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                Rent Number
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight">My SMS numbers</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
                Active OTP and rental numbers appear here.
              </p>
            </div>
            <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={refreshOrders}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          {orders.length === 0 ? (
            <EmptyState title="No SMS numbers yet" body="Your OTP and rental numbers will appear here after purchase." />
          ) : orders.map((order) => (
            <SmsOrderCard
              key={order.id}
              order={order}
              busy={busyAction?.endsWith(order.id) === true}
              onCheck={checkOtp}
              onCancel={cancelOrder}
              onLatest={(item) => loadRentalSms(item, 'latest')}
              onHistory={(item) => loadRentalSms(item, 'history')}
              onRenew={renewRental}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SmsNumbersPage() {
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f6f7fb] text-slate-950 dark:bg-background dark:text-foreground">
      <NavbarAuth />

      <main className="container mx-auto max-w-full overflow-x-hidden px-4 py-6 sm:px-6 lg:py-10">
        <div className="mx-auto mb-6 flex w-full max-w-7xl items-center gap-3 text-sm font-semibold text-slate-500 dark:text-muted-foreground">
          <Sparkles className="h-4 w-4 text-violet-500" />
          SMS Numbers
        </div>

        <SmsNumbersSurface />
      </main>
    </div>
  )
}
