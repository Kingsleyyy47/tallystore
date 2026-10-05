import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const OWNER_USER_ID = 'c1396bda-86e2-4dfc-94bb-0d95469d1d36'
const REQUEST_DEADLINE_MS = 30_000
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ReconciliationCase = {
  order_id: string
  section: string
  state: string
  order_status: string
  amount_ngn: number
  created_at: string | null
  claimed_at: string | null
  probe_available: boolean
}

type CasesResponse = { success: true; cases: ReconciliationCase[]; next_page: number | null }
type ProbeResponse = {
  success: true
  case: ReconciliationCase
  observation: string
  financial_decision: 'none'
}

type Props = {
  ownerId: string
  active: boolean
  invoke: <T,>(payload: Record<string, unknown>) => Promise<T>
}

const sectionLabels: Record<string, string> = {
  sms: 'SMS', social_boost: 'Social boost', giftcards: 'Gift cards', telegram_stars: 'Telegram Stars',
}
const observationLabels: Record<string, string> = {
  reported_completed: 'Provider reports completion. The order still needs review.',
  invoice_complete_requires_order_review: 'Provider invoice is complete. Review the order separately.',
  reported_pending: 'Provider reports pending. Keep this order held.',
  reported_failure: 'Provider reports failure. Review before taking any financial action.',
  provider_id_unavailable: 'No matching provider ID is available for an automatic check.',
  inconclusive: 'Provider status is inconclusive. Keep this order held and investigate.',
}

function formatDate(value: string | null): string {
  if (!value) return 'Time unavailable'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Time unavailable'
}

function formatAmount(value: number): string {
  return Number.isFinite(value) && value >= 0
    ? `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Amount unavailable'
}

async function withDeadline<T>(request: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('request timeout')), REQUEST_DEADLINE_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function validCase(value: unknown): value is ReconciliationCase {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.order_id === 'string' && ORDER_ID.test(row.order_id)
    && typeof row.section === 'string' && typeof row.state === 'string'
    && typeof row.order_status === 'string' && typeof row.amount_ngn === 'number'
    && typeof row.probe_available === 'boolean'
}

export default function PartnerReconciliationPanel({ ownerId, active, invoke }: Props) {
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [cases, setCases] = useState<ReconciliationCase[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState(false)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [observations, setObservations] = useState<Record<string, string>>({})
  const [probeErrors, setProbeErrors] = useState<Record<string, boolean>>({})
  const generation = useRef(0)
  const ownerRef = useRef(ownerId)
  const activeRef = useRef(active)
  ownerRef.current = ownerId
  activeRef.current = active

  useEffect(() => {
    if (!active || ownerId !== OWNER_USER_ID) return
    const requestGeneration = ++generation.current
    setLoading(true)
    setReadError(false)
    setCheckingId(null)
    setObservations({})
    setProbeErrors({})
    void withDeadline(invoke<CasesResponse>({ action: 'admin_reconciliation_cases', page }))
      .then((result) => {
        if (requestGeneration !== generation.current || ownerRef.current !== ownerId || !activeRef.current) return
        if (!result?.success || !Array.isArray(result.cases)
          || !result.cases.every(validCase)
          || (result.next_page !== null && result.next_page !== page + 1)) throw new Error('Invalid case response')
        setCases(result.cases)
        setNextPage(result.next_page)
      })
      .catch(() => {
        if (requestGeneration !== generation.current || ownerRef.current !== ownerId || !activeRef.current) return
        setCases([])
        setNextPage(null)
        setReadError(true)
      })
      .finally(() => {
        if (requestGeneration === generation.current && ownerRef.current === ownerId && activeRef.current) setLoading(false)
      })
    return () => { generation.current += 1 }
  }, [active, ownerId, invoke, page, reload])

  const checkProvider = useCallback(async (entry: ReconciliationCase) => {
    if (!activeRef.current || ownerRef.current !== OWNER_USER_ID || !entry.probe_available || checkingId) return
    const requestGeneration = generation.current
    setCheckingId(entry.order_id)
    setProbeErrors((current) => ({ ...current, [entry.order_id]: false }))
    try {
      const result = await withDeadline(invoke<ProbeResponse>({ action: 'admin_reconciliation_probe', order_id: entry.order_id }))
      if (requestGeneration !== generation.current || ownerRef.current !== OWNER_USER_ID || !activeRef.current) return
      if (!result?.success || result.case?.order_id !== entry.order_id || result.financial_decision !== 'none'
        || typeof result.observation !== 'string'
        || !Object.prototype.hasOwnProperty.call(observationLabels, result.observation)) throw new Error('Invalid observation')
      setObservations((current) => ({ ...current, [entry.order_id]: result.observation }))
    } catch {
      if (requestGeneration === generation.current && ownerRef.current === OWNER_USER_ID && activeRef.current) {
        setProbeErrors((current) => ({ ...current, [entry.order_id]: true }))
      }
    } finally {
      if (requestGeneration === generation.current && ownerRef.current === OWNER_USER_ID && activeRef.current) setCheckingId(null)
    }
  }, [checkingId, invoke])

  if (!active || ownerId !== OWNER_USER_ID) return null

  return (
    <Card className="rounded-2xl border-amber-300/70 dark:border-amber-500/30">
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> External order review
          </CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            These partner orders have no confirmed provider outcome. Funds may be held. Checking the provider only reads its status; it does not retry a purchase, settle, refund, or change a balance.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setReload((value) => value + 1)}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading held orders…</p>
        ) : readError ? (
          <div role="alert" className="rounded-xl border border-red-300/60 p-4 text-sm">
            Could not read held orders. No order or balance was changed. Try Refresh.
          </div>
        ) : cases.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            {page === 0 ? 'No held external partner orders need review.' : 'No more held orders on this page.'}
          </p>
        ) : cases.map((entry) => (
          <div key={entry.order_id} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-bold">{Object.prototype.hasOwnProperty.call(sectionLabels, entry.section) ? sectionLabels[entry.section] : 'External order'} · {formatAmount(entry.amount_ngn)}</p>
                <p className="break-all font-mono text-xs text-muted-foreground">{entry.order_id}</p>
                <p className="text-xs text-muted-foreground">Created {formatDate(entry.created_at)} · Sent {formatDate(entry.claimed_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{entry.state === 'unknown' ? 'Unknown outcome' : entry.state === 'sending' ? 'Sending / held' : 'Needs review'}</Badge>
                <Badge variant="secondary">Order: {entry.order_status.slice(0, 40)}</Badge>
              </div>
            </div>
            {entry.probe_available ? (
              <Button type="button" size="sm" variant="outline" className="mt-3" disabled={checkingId !== null}
                onClick={() => void checkProvider(entry)}>
                {checkingId === entry.order_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Check provider
              </Button>
            ) : <p className="mt-3 text-xs text-muted-foreground">Automatic provider check unavailable: no matching provider ID is recorded.</p>}
            {observations[entry.order_id] && (
              <p role="status" className="mt-3 rounded-lg bg-muted/60 p-3 text-sm">{observationLabels[observations[entry.order_id]]}</p>
            )}
            {probeErrors[entry.order_id] && (
              <p role="alert" className="mt-3 text-sm text-red-600">Provider check could not finish. No order or balance was changed. You can try again.</p>
            )}
          </div>
        ))}
        {!loading && !readError && (
          <div className="flex items-center justify-between gap-3 pt-2 text-sm">
            <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button>
            <span>Page {page + 1}</span>
            <Button type="button" size="sm" variant="outline" disabled={nextPage === null || nextPage > 1000} onClick={() => setPage(nextPage!)}>Next</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
