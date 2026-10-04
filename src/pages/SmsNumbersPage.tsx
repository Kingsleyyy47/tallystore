import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactCountryFlag from 'react-country-flag'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock,
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
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import NavbarAuth from '@/components/NavbarAuth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useSupportSettings } from '@/hooks/useSupportSettings'
import { useAuth } from '@/contexts/SimpleAuth'
import { blockStaffPurchase } from '@/lib/staffPurchaseGuard'
import { getRevenueRequestContext, getRevenueVisitorId, trackRevenueEvent } from '@/lib/revenue-os'
import { RecommendationStrip } from '@/components/RecommendationCard'
import { useRecommendations } from '@/hooks/useRecommendations'

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
  code?: string
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
  exchange_rate?: number
  price_ngn: number
  available_count: number
  customer_buy_count?: number
  personal_buy_count?: number
  recommended_score?: number
  is_enabled?: boolean
  is_favorite?: boolean
  price_override_ngn?: number | null
  pricing_mode?: 'auto_markup' | 'manual_margin' | 'override'
}

type SmsRentalArea = {
  area_code: string
  area_title: string
  unit_price: number
  min_month: number
  total: number
  exchange_rate?: number
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
  service_id?: string | null
  service_code?: string | null
  service_name: string
  phone_number?: string | null
  area_code?: string | null
  price_ngn: number
  status: string
  messages: SmsMessage[]
  expires_at?: string | null
  keep_at?: string | null
  rent_months?: number | null
  refunded_at?: string | null
  refund_amount_ngn?: number | null
  created_at: string
}

type SmsTab = 'otp' | 'rental' | 'orders'
type ServiceSort = 'recommended' | 'price_low' | 'stock'

const SMS_SERVICE_ICONS: Record<string, string> = {
  google: 'google', gmail: 'gmail', whatsapp: 'whatsapp', telegram: 'telegram',
  facebook: 'facebook', instagram: 'instagram', signal: 'signal',
  tiktok: 'tiktok', discord: 'discord', snapchat: 'snapchat',
  netflix: 'netflix', spotify: 'spotify', paypal: 'paypal',
  amazon: 'amazon', microsoft: 'microsoft', apple: 'apple',
  twitter: 'x', outlook: 'microsoftoutlook', zoom: 'zoom',
}
const SMS_FALLBACK_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236366f1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z'/%3E%3C/svg%3E"

function SmsServiceIcon({ service, className = '' }: { service: SmsService; className?: string }) {
  const name = service.service_name.toLowerCase()
  const slug = Object.entries(SMS_SERVICE_ICONS).find(([term]) => name.includes(term))?.[1]
  return (
    <span className={cn('grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 dark:bg-white/10', className)}>
      <img
        src={slug ? `https://cdn.simpleicons.org/${slug}` : SMS_FALLBACK_ICON}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-6 w-6 object-contain"
        onError={(event) => {
          if (event.currentTarget.src !== SMS_FALLBACK_ICON) event.currentTarget.src = SMS_FALLBACK_ICON
        }}
      />
    </span>
  )
}

const SERVICE_SORT_LABELS: Record<ServiceSort, string> = {
  recommended: 'Recommended',
  price_low: 'Lowest price',
  stock: 'Most available',
}

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

function serviceQuickTerm(service: SmsService) {
  const raw = String(service.service_name || service.service_code || '').trim()
  const withoutFlag = raw.replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, '')
  const cleaned = withoutFlag
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[_|/\\:;,+-]+/g, ' ')
    .replace(/\b(?:otp|sms|verify|verification|number|numbers|code|codes|service|usa|united states|canada)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const firstWords = cleaned.split(' ').filter(Boolean).slice(0, 3).join(' ')
  return firstWords || raw.slice(0, 24)
}

function smsServiceIdentity(service: Pick<SmsService, 'service_id' | 'service_code' | 'service_name'>) {
  return [
    service.service_id,
    service.service_code,
    normalize(service.service_name),
  ].filter(Boolean) as string[]
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
  if (/smsbus|daisy|daisysms|provider|api key|token|secret|backend|ngn_usd_rate|app settings/i.test(message)) {
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
    if (data?.code === 'SMS_OUTCOME_REVIEW_REQUIRED') {
      throw new Error('Order outcome needs review. No refund has been confirmed yet.')
    }
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

const OTP_TIMEOUT_SECONDS = 180 // 3 minutes

function useOtpCountdown(order: SmsOrder, onExpire: (order: SmsOrder) => void) {
  const [secsLeft, setSecsLeft] = useState<number | null>(null)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)
  const orderRef = useRef(order)
  const messagesLen = (order.messages ?? []).length

  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    orderRef.current = order
  }, [order])

  useEffect(() => {
    if (order.order_type !== 'otp' || isTerminalStatus(order.status)) return
    // Code has arrived — stop the timer and never auto-cancel
    if (messagesLen > 0) {
      setSecsLeft(null)
      return
    }

    expiredRef.current = false // reset each time effect re-runs with no code
    const created = new Date(order.created_at).getTime()
    const deadline = created + OTP_TIMEOUT_SECONDS * 1000

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecsLeft(remaining)
      if (remaining === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpireRef.current(orderRef.current)
      }
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [order.id, order.status, order.order_type, order.created_at, messagesLen])

  return secsLeft
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
  const secsLeft = useOtpCountdown(order, onCancel)

  const timerMins = secsLeft !== null ? String(Math.floor(secsLeft / 60)).padStart(2, '0') : null
  const timerSecs = secsLeft !== null ? String(secsLeft % 60).padStart(2, '0') : null
  const timerPct = secsLeft !== null ? (secsLeft / OTP_TIMEOUT_SECONDS) * 100 : 100
  const timerUrgent = secsLeft !== null && secsLeft <= 30

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
                  : 'Refund under review'}
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

        {/* OTP countdown timer */}
        {order.order_type === 'otp' && !isTerminalStatus(order.status) && secsLeft !== null && !(order.messages && order.messages.length > 0) && (
          <div className="mt-4">
            <div className={cn(
              'flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold transition-colors',
              timerUrgent
                ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
            )}>
              <div className="flex items-center gap-2">
                <Clock className={cn('h-4 w-4', timerUrgent && 'animate-pulse')} />
                <span>
                  {secsLeft === 0
                    ? 'Cancelling automatically…'
                    : `Auto-cancels in ${timerMins}:${timerSecs}`}
                </span>
              </div>
              <span className="text-xs font-normal opacity-75">No code = full refund</span>
            </div>
            {/* Progress bar */}
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-1000',
                  timerUrgent ? 'bg-red-500' : 'bg-amber-400',
                )}
                style={{ width: `${timerPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {order.order_type === 'otp' && !isTerminalStatus(order.status) && (
            <>
              <Button type="button" className="rounded-2xl" disabled={busy} onClick={() => onCheck(order)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Check SMS
              </Button>
              <Button type="button" variant="outline" className="rounded-2xl" disabled={busy} onClick={() => onCancel(order)}>
                <XCircle className="h-4 w-4" />
                Cancel order
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
  const { user, isStaff, isAdmin, walletBalance, walletLoading, walletBalanceUnavailable } = useAuth()
  const [activeTab, setActiveTab] = useState<SmsTab>('otp')
  const [health, setHealth] = useState<SmsApiResponse<never> | null>(null)
  const [services, setServices] = useState<SmsService[]>([])
  const [areas, setAreas] = useState<SmsRentalArea[]>([])
  const [orders, setOrders] = useState<SmsOrder[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [purchaseOpen, setPurchaseOpen] = useState(false)
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
  const rentalsAvailable = areas.length > 0
  const activeOrders = useMemo(
    () => orders.filter((order) => !isTerminalStatus(order.status)),
    [orders],
  )
  const localSmsServiceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    orders.forEach((order) => {
      if (order.order_type !== 'otp') return
      if (order.refunded_at) return
      if (String(order.status || '').toLowerCase() !== 'completed') return
      const keys = [
        order.service_id,
        order.service_code,
        normalize(order.service_name),
      ].filter(Boolean) as string[]
      keys.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1))
    })
    return counts
  }, [orders])
  const getCustomerSmsServiceCount = useCallback((service: SmsService) => {
    const localCount = Math.max(0, ...smsServiceIdentity(service).map((key) => localSmsServiceCounts.get(key) || 0))
    return Math.max(Number(service.personal_buy_count || 0), localCount)
  }, [localSmsServiceCounts])

  const quickServiceTerms = useMemo(() => {
    const seen = new Set<string>()
    return [...services]
      .filter((service) => Number(service.price_ngn) > 0 && Number(service.available_count || 0) > 0)
      .sort((a, b) =>
        Number(b.is_favorite === true) - Number(a.is_favorite === true) ||
        getCustomerSmsServiceCount(b) - getCustomerSmsServiceCount(a) ||
        Number(b.customer_buy_count || 0) - Number(a.customer_buy_count || 0) ||
        Number(b.recommended_score || 0) - Number(a.recommended_score || 0) ||
        Number(b.available_count || 0) - Number(a.available_count || 0) ||
        Number(a.price_ngn || 0) - Number(b.price_ngn || 0),
      )
      .map(serviceQuickTerm)
      .filter((term) => {
        const key = normalize(term)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 6)
  }, [getCustomerSmsServiceCount, services])

  const serviceSearchPlaceholder = quickServiceTerms.length > 0
    ? `Search ${quickServiceTerms.slice(0, 3).join(', ')}...`
    : 'Search live SMS services...'

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
        const favoriteRank = Number(b.is_favorite === true) - Number(a.is_favorite === true)
        if (favoriteRank !== 0) return favoriteRank
        const personalRank = getCustomerSmsServiceCount(b) - getCustomerSmsServiceCount(a)
        if (personalRank !== 0) return personalRank
        const customerRank = Number(b.customer_buy_count || 0) - Number(a.customer_buy_count || 0)
        if (customerRank !== 0) return customerRank
        const scoreRank = Number(b.recommended_score || 0) - Number(a.recommended_score || 0)
        if (scoreRank !== 0) return scoreRank
        return b.available_count - a.available_count || a.price_ngn - b.price_ngn
      }
      const favoriteRank = Number(b.is_favorite === true) - Number(a.is_favorite === true)
      if (favoriteRank !== 0) return favoriteRank
      if (serviceSort === 'price_low') return a.price_ngn - b.price_ngn
      return b.available_count - a.available_count
    })
  }, [getCustomerSmsServiceCount, services, serviceQuery, serviceSort])

  const visibleServices = filteredServices.slice(0, visibleServiceCount)
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
    if (selectedServiceId && !services.some((service) => service.service_id === selectedServiceId)) {
      setSelectedServiceId('')
    }
  }, [selectedServiceId, services])

  useEffect(() => {
    if (areas.length > 0 && !areas.some((area) => area.area_code === selectedAreaCode)) {
      setSelectedAreaCode(areas[0].area_code)
    }
  }, [areas, selectedAreaCode])

  useEffect(() => {
    if (!rentalsAvailable && activeTab === 'rental') {
      setActiveTab('otp')
    }
  }, [activeTab, rentalsAvailable])

  useEffect(() => {
    if (!selectedArea) return
    setRentalMonths((current) => Math.min(12, Math.max(selectedArea.min_month || 1, current || 1)))
  }, [selectedArea])

  const selectOtpService = (service: SmsService) => {
    setSelectedServiceId(service.service_id)
    trackRevenueEvent({
      eventType: 'PRODUCT_CLICKED',
      userId: user?.id || null,
      surface: 'sms_otp_services',
      eventId: `PRODUCT_CLICKED:${crypto.randomUUID()}:sms_otp:${service.country_id}:${service.service_id}`,
      metadata: {
        service_id: service.service_id,
        service_name: service.service_name,
        service_code: service.service_code || null,
        country_id: service.country_id,
        country_code: service.country_code || null,
        price_ngn: service.price_ngn,
        available_count: service.available_count,
        customer_targeted_count: getCustomerSmsServiceCount(service),
        customer_buy_count: service.customer_buy_count || 0,
        personal_buy_count: service.personal_buy_count || 0,
        recommended_score: service.recommended_score || 0,
        pricing_mode: service.pricing_mode || null,
      },
    })
  }

  const selectRentalArea = (area: SmsRentalArea) => {
    setSelectedAreaCode(area.area_code)
    trackRevenueEvent({
      eventType: 'PRODUCT_CLICKED',
      userId: user?.id || null,
      surface: 'sms_rental_areas',
      eventId: `PRODUCT_CLICKED:${crypto.randomUUID()}:sms_rental:${area.area_code}`,
      metadata: {
        area_code: area.area_code,
        area_title: area.area_title,
        price_ngn_monthly: area.price_ngn_monthly,
        min_month: area.min_month,
      },
    })
  }

  const loadSmsNumbers = useCallback(async () => {
    setLoading(true)
    // Fire sync silently so externally cancelled orders are reflected locally.
    invokeSms('sync_cancelled').catch(() => {})
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

        setServices(serviceResult.data || [])
        setAreas(areaResult.data || [])

      } else {
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

  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10)
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      userId: user?.id || null,
      surface: 'sms_numbers',
      eventId: `PAGE_VIEWED:${day}:sms_numbers:${user?.id || 'anon'}`,
      metadata: { active_tab: activeTab },
    })
  }, [activeTab, user?.id])

  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    trackRevenueEvent({
      eventType: 'FILTER_USED',
      userId: user?.id || null,
      surface: 'sms_numbers',
      eventId: `FILTER_USED:${day}:${actorKey}:sms_tab:${activeTab}`,
      metadata: { filter: 'sms_tab', value: activeTab },
    })
  }, [activeTab, user?.id])

  useEffect(() => {
    if (activeTab !== 'otp') return
    const day = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    trackRevenueEvent({
      eventType: 'SORT_USED',
      userId: user?.id || null,
      surface: 'sms_otp_services',
      eventId: `SORT_USED:${day}:${actorKey}:sms_otp:${serviceSort}`,
      metadata: { sort: serviceSort },
    })
  }, [activeTab, serviceSort, user?.id])

  useEffect(() => {
    const query = serviceQuery.trim()
    if (activeTab !== 'otp' || query.length < 2) return
    const day = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    const queryKey = normalize(query).replace(/[^a-z0-9]+/g, '_').slice(0, 60) || 'query'
    trackRevenueEvent({
      eventType: 'SEARCHED',
      userId: user?.id || null,
      surface: 'sms_otp_services',
      eventId: `SEARCHED:${day}:${actorKey}:sms_otp:${queryKey}`,
      metadata: {
        query,
        result_count: filteredServices.length,
        total_services: services.length,
        sort: serviceSort,
      },
    })
  }, [activeTab, filteredServices.length, serviceQuery, serviceSort, services.length, user?.id])

  useEffect(() => {
    if (activeTab !== 'otp' || !selectedService) return
    const day = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    trackRevenueEvent({
      eventType: 'PRODUCT_VIEWED',
      userId: user?.id || null,
      surface: 'sms_otp',
      eventId: `PRODUCT_VIEWED:${day}:${actorKey}:sms_otp:${selectedService.country_id}:${selectedService.service_id}:${selectedService.price_ngn}`,
      metadata: {
        service_id: selectedService.service_id,
        service_name: selectedService.service_name,
        service_code: selectedService.service_code || null,
        country_id: selectedService.country_id,
        country_code: selectedService.country_code || null,
        price_ngn: selectedService.price_ngn,
        available_count: selectedService.available_count,
        is_favorite: selectedService.is_favorite === true,
        customer_buy_count: selectedService.customer_buy_count || 0,
        personal_buy_count: selectedService.personal_buy_count || 0,
        customer_targeted_count: getCustomerSmsServiceCount(selectedService),
        recommended_score: selectedService.recommended_score || 0,
        pricing_mode: selectedService.pricing_mode || null,
      },
    })
  }, [activeTab, getCustomerSmsServiceCount, selectedService, user?.id])

  useEffect(() => {
    if (visibleServices.length === 0) return
    const day = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    visibleServices.slice(0, 30).forEach((service, index) => {
      trackRevenueEvent({
        eventType: 'PRODUCT_IMPRESSION',
        userId: user?.id || null,
        surface: 'sms_otp_services',
        eventId: `PRODUCT_IMPRESSION:${day}:${actorKey}:sms_otp:${serviceQuery || 'browse'}:${serviceSort}:${service.country_id}:${service.service_id}`,
        metadata: {
          service_id: service.service_id,
          service_name: service.service_name,
          service_code: service.service_code || null,
          country_id: service.country_id,
          country_code: service.country_code || null,
          price_ngn: service.price_ngn,
          available_count: service.available_count,
          is_favorite: service.is_favorite === true,
          is_enabled: service.is_enabled !== false,
          customer_buy_count: service.customer_buy_count || 0,
          personal_buy_count: service.personal_buy_count || 0,
          customer_targeted_count: getCustomerSmsServiceCount(service),
          recommended_score: service.recommended_score || 0,
          pricing_mode: service.pricing_mode || null,
          position: index + 1,
        },
      })
    })
  }, [getCustomerSmsServiceCount, serviceQuery, serviceSort, user?.id, visibleServices])

  useEffect(() => {
    if (areas.length === 0) return
    const day = new Date().toISOString().slice(0, 10)
    const actorKey = user?.id || getRevenueVisitorId() || 'anonymous'
    areas.slice(0, 30).forEach((area, index) => {
      trackRevenueEvent({
        eventType: 'PRODUCT_IMPRESSION',
        userId: user?.id || null,
        surface: 'sms_rental_areas',
        eventId: `PRODUCT_IMPRESSION:${day}:${actorKey}:sms_rental:${area.area_code}`,
        metadata: {
          area_code: area.area_code,
          area_title: area.area_title,
          price_ngn_monthly: area.price_ngn_monthly,
          min_month: area.min_month,
          position: index + 1,
        },
      })
    })
  }, [areas, user?.id])

  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10)
    if (activeTab === 'otp' && selectedService) {
      trackRevenueEvent({
        eventType: 'PAYMENT_PROVIDER_LOADED',
        userId: user?.id || null,
        surface: 'sms_otp',
        eventId: `PAYMENT_PROVIDER_LOADED:${day}:sms_otp:${user?.id || 'anon'}:${selectedService.country_id}:${selectedService.service_id}:${selectedService.price_ngn}`,
        metadata: {
          provider: 'wallet',
          service_id: selectedService.service_id,
          service_name: selectedService.service_name,
          service_code: selectedService.service_code || null,
          country_id: selectedService.country_id,
          country_code: selectedService.country_code || null,
          expected_price_ngn: selectedService.price_ngn,
          customer_targeted_count: getCustomerSmsServiceCount(selectedService),
          personal_buy_count: selectedService.personal_buy_count || 0,
          recommended_score: selectedService.recommended_score || 0,
          pricing_mode: selectedService.pricing_mode || null,
        },
      })
    }

    if (activeTab === 'rental' && selectedArea) {
      const expectedPriceNgn = Number(selectedArea.price_ngn_monthly || 0) * rentalMonths
      trackRevenueEvent({
        eventType: 'PAYMENT_PROVIDER_LOADED',
        userId: user?.id || null,
        surface: 'sms_rental',
        eventId: `PAYMENT_PROVIDER_LOADED:${day}:sms_rental:${user?.id || 'anon'}:${selectedArea.area_code}:${rentalMonths}:${expectedPriceNgn}`,
        metadata: {
          provider: 'wallet',
          area_code: selectedArea.area_code,
          area_title: selectedArea.area_title,
          months: rentalMonths,
          expected_price_ngn: expectedPriceNgn,
          min_month: selectedArea.min_month,
        },
      })
    }
  }, [activeTab, getCustomerSmsServiceCount, rentalMonths, selectedArea, selectedService, user?.id])

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
    if (blockStaffPurchase(isStaff, isAdmin, ({ title, description }) => toast.error(String(title || 'Purchase blocked'), { description: description ? String(description) : undefined }))) return
    if (!selectedService) throw new Error('Select an OTP service first')
    const idempotencyKey = `sms-otp-${selectedService.service_id}-${Date.now()}-${crypto.randomUUID()}`

    trackRevenueEvent({
      eventType: 'BUY_CLICKED',
      userId: user?.id || null,
      surface: 'sms_otp',
      eventId: `BUY_CLICKED:sms_otp:${idempotencyKey}`,
      metadata: {
        service_id: selectedService.service_id,
        service_name: selectedService.service_name,
        service_code: selectedService.service_code || null,
        country_id: selectedService.country_id,
        country_code: selectedService.country_code || null,
        expected_price_ngn: selectedService.price_ngn,
        customer_targeted_count: getCustomerSmsServiceCount(selectedService),
        customer_buy_count: selectedService.customer_buy_count || 0,
        personal_buy_count: selectedService.personal_buy_count || 0,
        recommended_score: selectedService.recommended_score || 0,
        pricing_mode: selectedService.pricing_mode || null,
      },
    })

    const result = await invokeSms<SmsOrder>('create_otp', {
      country_id: selectedService.country_id,
      service_id: selectedService.service_id,
      expected_price_ngn: selectedService.price_ngn,
      idempotency_key: idempotencyKey,
      revenue_context: getRevenueRequestContext(),
    })

    setPurchaseOpen(false)
    toast.success('OTP number purchased')
    if (typeof result.new_balance === 'number') {
      window.dispatchEvent(new Event('transactionAdded'))
    }
    await refreshOrders()
    setActiveTab('orders')
  })

  const rentNumber = () => runAction('rent-number', async () => {
    if (blockStaffPurchase(isStaff, isAdmin, ({ title, description }) => toast.error(String(title || 'Purchase blocked'), { description: description ? String(description) : undefined }))) return
    if (!selectedArea) throw new Error('Select a rental country first')
    const idempotencyKey = `sms-rental-${selectedArea.area_code}-${Date.now()}-${crypto.randomUUID()}`
    const expectedPriceNgn = Number(selectedArea.price_ngn_monthly || 0) * rentalMonths

    trackRevenueEvent({
      eventType: 'BUY_CLICKED',
      userId: user?.id || null,
      surface: 'sms_rental',
      eventId: `BUY_CLICKED:sms_rental:${idempotencyKey}`,
      metadata: {
        area_code: selectedArea.area_code,
        area_title: selectedArea.area_title,
        months: rentalMonths,
        expected_price_ngn: expectedPriceNgn,
      },
    })

    const result = await invokeSms<SmsOrder>('rent_number', {
      area_code: selectedArea.area_code,
      months: rentalMonths,
      idempotency_key: idempotencyKey,
      revenue_context: getRevenueRequestContext(),
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
    // Always fetch the live order before cancelling — the closure may be stale
    const { data: live } = await supabase
      .from('sms_orders')
      .select('id, status, messages')
      .eq('id', order.id)
      .single()
    if (live && (isTerminalStatus(live.status) || (live.messages && live.messages.length > 0))) {
      toast.error('Cannot cancel — a code has already been received for this order.')
      await refreshOrders()
      return
    }
    const result = await invokeSms<SmsOrder>(order.order_type === 'otp' ? 'cancel_otp' : 'cancel_rental', { order_id: order.id })
    toast.success(order.order_type !== 'otp'
      ? 'Order cancelled'
      : result.data?.refunded_at ? 'Order cancelled and refunded' : 'Order cancelled; refund under review')
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
  const smsTabs = [
    { id: 'otp' as const, label: 'OTP numbers', icon: PhoneCall },
    rentalsAvailable ? { id: 'rental' as const, label: 'Rentals', icon: CalendarDays } : null,
    { id: 'orders' as const, label: 'My numbers', icon: Inbox },
  ].filter((tab): tab is { id: SmsTab; label: string; icon: typeof PhoneCall } => tab !== null)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      {activeTab === 'otp' && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#8075ff] to-[#6366f1] p-5 text-white shadow-[0_4px_20px_rgba(128,117,255,0.3)]">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10" />
          <div className="absolute -bottom-10 -left-5 h-24 w-24 rounded-full bg-white/[0.08]" />
          <div className="relative space-y-4">
            <div>
              <p className="text-sm text-white/90">Available wallet balance</p>
              {walletLoading ? (
                <Loader2 className="mt-2 h-6 w-6 animate-spin" />
              ) : (
                <h2 className="mt-1 text-3xl font-bold">{walletBalanceUnavailable ? 'Unavailable' : formatNaira(walletBalance)}</h2>
              )}
              {user?.email && <p className="mt-1 truncate text-xs text-white/70">{user.email}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="h-10 min-w-28 flex-1 rounded-lg bg-white font-semibold text-[#6c5ff2] hover:bg-white/90 hover:text-[#6c5ff2]">
                <Link to="/wallet">+ Add Funds</Link>
              </Button>
              <Button type="button" className="h-10 min-w-28 flex-1 rounded-lg border border-white/30 bg-white/20 font-semibold text-white hover:bg-white/30" onClick={() => setActiveTab('orders')}>
                History
              </Button>
            </div>
            {orders.length > 0 && (
              <div className="space-y-2 border-t border-white/20 pt-3">
                <p className="text-xs font-medium text-white/70">Recent orders</p>
                {orders.slice(0, 3).map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-medium">{order.service_name}</span>
                    <span className="shrink-0 capitalize text-white/75">{order.status}</span>
                    <span className="shrink-0 font-semibold">{formatNaira(order.price_ngn)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button asChild type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-lg" aria-label="Back to dashboard">
          <Link to="/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ReactCountryFlag countryCode="US" svg className="shrink-0 text-2xl" aria-label="United States" />
            US &amp; Canada Numbers
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">Choose a service and get a number for your code.</p>
        </div>
        <Button type="button" variant="ghost" className="h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-[#6c5ff2]" onClick={loadSmsNumbers} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

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

      <div className={cn(
        'grid gap-1 rounded-2xl bg-white p-1.5 shadow-card dark:bg-card sm:inline-grid sm:gap-2 sm:rounded-3xl sm:p-2',
        rentalsAvailable ? 'grid-cols-3' : 'grid-cols-2',
      )}>
        {smsTabs.map((tab) => {
          const Icon = tab.icon
          return (
            <Button
              key={tab.id}
              type="button"
              variant="ghost"
              className={cn(
                'h-10 min-w-0 justify-center rounded-xl px-2 text-[11px] font-black sm:h-11 sm:rounded-2xl sm:px-4 sm:text-sm',
                activeTab === tab.id
                  ? 'bg-[#8075ff] text-white shadow-sm hover:bg-[#6c5ff2] hover:text-white'
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
        <>
        <Dialog open={purchaseOpen} onOpenChange={(open) => {
          if (busyAction !== 'buy-otp') setPurchaseOpen(open)
        }}>
          <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-5 sm:p-6">
            <DialogHeader className="pr-7 text-left">
              <DialogTitle className="text-xl font-bold">Buy OTP number</DialogTitle>
              <DialogDescription>Confirm the service and price before your wallet is charged.</DialogDescription>
            </DialogHeader>
            <div className="rounded-xl bg-[#8075ff]/[0.08] p-4 dark:bg-[#8075ff]/15">
              <p className="break-words text-lg font-black">{selectedService?.service_name || 'Choose a service'}</p>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500 dark:text-muted-foreground">Price per number</span>
                <strong>{selectedService ? formatNaira(selectedService.price_ngn) : '-'}</strong>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500 dark:text-muted-foreground">Available now</span>
                <strong>{selectedService ? selectedService.available_count.toLocaleString() : '-'}</strong>
              </div>
            </div>
            <Button
              type="button"
              className="h-12 w-full rounded-xl bg-[#8075ff] text-white hover:bg-[#6c5ff2]"
              disabled={!numbersReady || !selectedService || selectedService.available_count <= 0 || busyAction !== null}
              onClick={buyOtp}
            >
              {busyAction === 'buy-otp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
              {selectedService ? `Buy for ${formatNaira(selectedService.price_ngn)}` : 'Buy OTP Number'}
            </Button>
          </DialogContent>
        </Dialog>
        <div className="space-y-5">
          <Card className="min-w-0 rounded-2xl border-0 bg-white shadow-card dark:bg-card">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Choose a service</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">
                    {loading ? 'Loading available services...' : `${filteredServices.length.toLocaleString()} matches from ${services.length.toLocaleString()} services`}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex min-w-0 flex-col gap-3 sm:flex-row">
                <SearchField value={serviceQuery} onChange={setServiceQuery} placeholder={serviceSearchPlaceholder} />
                <div className="relative sm:w-44 sm:shrink-0">
                  <SlidersHorizontal className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    value={serviceSort}
                    onChange={(event) => setServiceSort(event.target.value as ServiceSort)}
                    aria-label="Sort services"
                    className="h-12 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-11 pr-8 text-sm font-semibold outline-none focus:border-[#8075ff] dark:border-white/10 dark:bg-background"
                  >
                    {(Object.keys(SERVICE_SORT_LABELS) as ServiceSort[]).map((key) => (
                      <option key={key} value={key}>{SERVICE_SORT_LABELS[key]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {loading && services.length === 0 ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-muted" />
                  ))
                ) : visibleServices.length === 0 ? (
                  <EmptyState
                    title={services.length === 0 ? 'No OTP services available' : 'No service found'}
                    body={services.length === 0 ? 'No live SMS stock is available for this country right now. Please try again shortly.' : 'Try another app name or clear the search.'}
                  />
                ) : visibleServices.map((service) => {
                  const selected = selectedServiceId === service.service_id
                  return (
                    <button
                      key={service.service_id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectOtpService(service)}
                      disabled={service.available_count <= 0}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition hover:border-[#8075ff] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60 sm:p-3.5',
                        selected
                          ? 'border-[#8075ff] bg-[#8075ff]/[0.08] dark:bg-[#8075ff]/15'
                          : 'border-slate-200 bg-white dark:border-white/10 dark:bg-background',
                      )}
                    >
                      <SmsServiceIcon service={service} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold sm:text-base">{service.service_name}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                          {service.available_count.toLocaleString()} available
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-gradient-to-r from-[#8075ff] to-[#6366f1] px-3 py-1.5 text-sm font-bold text-white">
                        {formatNaira(service.price_ngn)}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  )
                })}
              </div>

              {filteredServices.length > visibleServiceCount && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 h-11 w-full rounded-xl"
                  onClick={() => setVisibleServiceCount((count) => count + SERVICE_BATCH_SIZE)}
                >
                  Show more services
                </Button>
              )}
            </CardContent>
          </Card>

          <SmsMessageSupportCard />
        </div>
        {selectedService && (
          <>
            <div className="h-24" aria-hidden="true" />
            <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-40 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-6px_24px_rgba(15,23,42,0.1)] backdrop-blur dark:border-white/10 dark:bg-card/95 md:bottom-0">
              <div className="mx-auto flex max-w-2xl items-center gap-3">
                <SmsServiceIcon service={selectedService} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{selectedService.service_name}</p>
                  <p className="text-xs font-semibold text-[#6c5ff2]">{formatNaira(selectedService.price_ngn)}</p>
                </div>
                <Button type="button" className="h-11 shrink-0 rounded-xl bg-[#8075ff] px-5 font-bold text-white hover:bg-[#6c5ff2]" disabled={!numbersReady || selectedService.available_count <= 0 || busyAction !== null} onClick={() => setPurchaseOpen(true)}>
                  Buy number
                </Button>
              </div>
            </div>
          </>
        )}
        </>
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
                      onClick={() => selectRentalArea(area)}
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
  const { recommendations: recs } = useRecommendations({ limit: 3 })
  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f6f7fb] text-slate-950 dark:bg-background dark:text-foreground">
      <NavbarAuth />

      <main className="container mx-auto max-w-full overflow-x-hidden px-4 py-5 sm:px-6 lg:py-8">
        <SmsNumbersSurface />

        {recs.length > 0 && (
          <div className="mx-auto mt-10 max-w-2xl">
            <RecommendationStrip products={recs} surface="sms_numbers_page" actionType="SHOW_ALTERNATIVE" title="Explore more products" />
          </div>
        )}
      </main>
    </div>
  )
}
