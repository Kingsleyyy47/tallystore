import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, ClipboardCopy, Flag, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/contexts/SimpleAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  checkPocketfiPayments, flagPocketfiPayment, listPocketfiReviews, resolvePocketfiReview,
  pocketfiCustomerSummary, pocketfiNgn, pocketfiNigeriaDate, pocketfiStatusLabels,
  type PocketfiPaymentCheck, type PocketfiPaymentRow, type PocketfiPaymentReview,
  type PocketfiReviewQueue, type PocketfiSearchType,
} from '@/lib/pocketfiPaymentCheck'

const fieldClass = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
const webhookLabels: Record<PocketfiPaymentRow['webhook_state'], string> = {
  verified_success: 'Verified: successful', verified_failed: 'Verified: failed',
  verified_pending: 'Verified: pending', unverified: 'Confirmation not verified', not_found: 'No webhook found',
}
const creditLabels: Record<PocketfiPaymentRow['credit_state'], string> = {
  credited: 'Matching wallet credit found', not_found: 'No matching wallet credit found',
  review: 'Wallet evidence needs review', unavailable: 'Wallet evidence unavailable',
}
const statusColour: Record<PocketfiPaymentRow['status'], string> = {
  paid_and_credited: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  paid_credit_missing: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  pending: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  no_webhook: 'border-border bg-muted text-muted-foreground',
  needs_review: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
}

export default function PocketfiPaymentChecker({ active = true, admin = false }: { active?: boolean; admin?: boolean }) {
  const { user } = useAuth()
  if (!active || !user) return null
  // An account/role change unmounts all sensitive results and cancels outstanding requests.
  return <PaymentCheckerAccount key={`${user.id}:${admin}`} userId={user.id} admin={admin} />
}

function PaymentCheckerAccount({ userId, admin }: { userId: string; admin: boolean }) {
  const mounted = useRef(true)
  const accountAbort = useRef(new AbortController())
  const searchAbort = useRef<AbortController | null>(null)
  const queueAbort = useRef<AbortController | null>(null)
  const searchSequence = useRef(0)
  const queueSequence = useRef(0)
  const mutationLock = useRef(false)
  const [mode, setMode] = useState<'check' | 'reviews'>('check')
  const [searchType, setSearchType] = useState<PocketfiSearchType>('reference')
  const [search, setSearch] = useState('')
  const [check, setCheck] = useState<PocketfiPaymentCheck | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [flaggedKeys, setFlaggedKeys] = useState<string[]>([])
  const [flagRow, setFlagRow] = useState<PocketfiPaymentRow | null>(null)
  const [flagNote, setFlagNote] = useState('')
  const [flagging, setFlagging] = useState(false)
  const [queueStatus, setQueueStatus] = useState<'pending' | 'reviewed'>('pending')
  const [queue, setQueue] = useState<PocketfiReviewQueue | null>(null)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [reviewRow, setReviewRow] = useState<PocketfiPaymentReview | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    const currentSearchSequence = searchSequence
    const currentQueueSequence = queueSequence
    mounted.current = true
    if (accountAbort.current.signal.aborted) accountAbort.current = new AbortController()
    return () => {
      mounted.current = false
      currentSearchSequence.current++
      currentQueueSequence.current++
      accountAbort.current.abort()
      searchAbort.current?.abort()
      queueAbort.current?.abort()
    }
  }, [])

  const clearSearch = () => {
    searchSequence.current++
    searchAbort.current?.abort()
    setCheck(null); setLoading(false); setError(''); setNotice('')
    setFlagRow(null); setFlagNote(''); setFlaggedKeys([])
  }

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault()
    if (mutationLock.current) return
    const sequence = ++searchSequence.current
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    setLoading(true); setError(''); setNotice(''); setCheck(null)
    setFlagRow(null); setFlagNote(''); setFlaggedKeys([])
    try {
      const result = await checkPocketfiPayments(searchType, search, { expectedUserId: userId, signal: controller.signal })
      if (!mounted.current || sequence !== searchSequence.current) return
      setCheck(result)
    } catch (failure) {
      if (mounted.current && sequence === searchSequence.current) setError(failure instanceof Error ? failure.message : 'Payment checking is unavailable. Please retry.')
    } finally {
      if (mounted.current && sequence === searchSequence.current) setLoading(false)
    }
  }

  const loadQueue = useCallback(async () => {
    if (!admin) return
    const sequence = ++queueSequence.current
    queueAbort.current?.abort()
    const controller = new AbortController()
    queueAbort.current = controller
    setQueueLoading(true); setQueueError(''); setQueue(null); setReviewRow(null); setReviewNote('')
    try {
      const result = await listPocketfiReviews(queueStatus, { expectedUserId: userId, signal: controller.signal })
      if (mounted.current && sequence === queueSequence.current) setQueue(result)
    } catch (failure) {
      if (mounted.current && sequence === queueSequence.current) setQueueError(failure instanceof Error ? failure.message : 'The review queue is unavailable. Please retry.')
    } finally {
      if (mounted.current && sequence === queueSequence.current) setQueueLoading(false)
    }
  }, [admin, queueStatus, userId])

  useEffect(() => { if (mode === 'reviews') void loadQueue() }, [mode, loadQueue])

  const copySummary = async (row: PocketfiPaymentRow, checkedAt?: string) => {
    try {
      await navigator.clipboard.writeText(pocketfiCustomerSummary(row, checkedAt))
      if (mounted.current) setNotice('Customer-safe summary copied.')
    } catch { if (mounted.current) setNotice('Copy is unavailable in this browser. Please try again.') }
  }

  const submitFlag = async (event: FormEvent) => {
    event.preventDefault()
    if (!check || !flagRow || mutationLock.current) return
    mutationLock.current = true
    setFlagging(true); setError(''); setNotice('')
    try {
      const result = await flagPocketfiPayment(check.check_id, flagRow.result_key, flagNote,
        { expectedUserId: userId, signal: accountAbort.current.signal })
      if (!mounted.current) return
      setFlaggedKeys(current => [...current, flagRow.result_key])
      setFlagRow(null); setFlagNote('')
      setNotice(result.already_flagged ? 'This payment is already in the admin review queue.' : 'Sent to the admin review queue. No wallet balance was changed.')
    } catch {
      if (mounted.current) setError('The review flag could not be confirmed. Recheck the payment before trying again; it may already be in the admin queue.')
    } finally {
      mutationLock.current = false
      if (mounted.current) setFlagging(false)
    }
  }

  const submitReview = async (event: FormEvent) => {
    event.preventDefault()
    if (!admin || !reviewRow || mutationLock.current) return
    mutationLock.current = true
    setReviewing(true); setQueueError(''); setNotice('')
    try {
      await resolvePocketfiReview(reviewRow.id, reviewNote, { expectedUserId: userId, signal: accountAbort.current.signal })
      if (!mounted.current) return
      setNotice('Review recorded. No wallet balance was changed.')
      await loadQueue()
    } catch {
      if (mounted.current) setQueueError('The review update could not be confirmed. Reload the queue before trying again; it may already be recorded.')
    } finally {
      mutationLock.current = false
      if (mounted.current) setReviewing(false)
    }
  }

  return <section className="space-y-5" aria-labelledby="pocketfi-check-title">
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-primary/10 p-2 text-primary"><ShieldCheck size={23} aria-hidden="true" /></span>
        <div><h2 id="pocketfi-check-title" className="text-xl font-semibold">PocketFi Payment Check</h2>
          <p className="mt-1 text-sm text-muted-foreground">Check payment confirmation and the matching wallet credit separately.</p></div>
      </div>
      <p className="mt-4 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Checks use saved payment evidence. Recheck does not contact the provider, credit a wallet or resend a payment.</p>
      {admin && <div className="mt-4 flex flex-wrap gap-2" aria-label="Payment tools">
        <Button size="sm" variant={mode === 'check' ? 'default' : 'outline'} onClick={() => { setMode('check'); setNotice('') }} disabled={reviewing}>Check payment</Button>
        <Button size="sm" variant={mode === 'reviews' ? 'default' : 'outline'} onClick={() => { setMode('reviews'); setNotice('') }} disabled={flagging}>Admin review queue</Button>
      </div>}
    </div>

    {notice && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">{notice}</p>}

    {mode === 'check' ? <>
      <form onSubmit={runSearch} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
          <div><label htmlFor="pocketfi-search-type" className="mb-1.5 block text-sm font-medium">Search by</label>
            <select id="pocketfi-search-type" className={fieldClass} value={searchType} disabled={flagging} onChange={event => { clearSearch(); setSearchType(event.target.value as PocketfiSearchType); setSearch('') }}>
              <option value="reference">Payment reference</option><option value="email">Customer email</option><option value="account_number">Receiving account</option>
            </select></div>
          <div><label htmlFor="pocketfi-search" className="mb-1.5 block text-sm font-medium">{searchType === 'reference' ? 'Full payment reference' : searchType === 'email' ? 'Customer email address' : 'Full receiving account number'}</label>
            <Input id="pocketfi-search" value={search} type={searchType === 'email' ? 'email' : 'text'} inputMode={searchType === 'account_number' ? 'numeric' : undefined}
              autoComplete="off" maxLength={searchType === 'email' ? 254 : searchType === 'account_number' ? 24 : 256} disabled={flagging} placeholder={searchType === 'email' ? 'customer@example.com' : searchType === 'account_number' ? 'Account number' : 'Paste the payment reference'}
              onChange={event => { clearSearch(); setSearch(event.target.value) }} /></div>
          <Button type="submit" disabled={loading || flagging || !search.trim()}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="mr-2 h-4 w-4" aria-hidden="true" />}Check payment</Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Use the exact reference or full customer details. A missing webhook is not proof that a payment failed.</p>
      </form>

      {loading && <p role="status" className="py-4 text-center text-sm text-muted-foreground">Checking saved payment and wallet records…</p>}
      {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{error}</p>
        <Button className="mt-3" variant="outline" size="sm" onClick={() => void runSearch()} disabled={loading || flagging || !search.trim()}>Retry / Recheck</Button></div>}

      {check && <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground">Checked {pocketfiNigeriaDate(check.checked_at)} · {check.results.length} result{check.results.length === 1 ? '' : 's'}</p>
          <Button variant="outline" size="sm" onClick={() => void runSearch()} disabled={loading || flagging}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Recheck</Button>
        </div>
        {!check.results.length && <div className="rounded-2xl border border-border bg-card p-5"><h3 className="font-semibold">No matching payment evidence found</h3><p className="mt-2 text-sm text-muted-foreground">This does not prove the payment failed or that the customer was not debited. Confirm the reference and receiving account, then recheck or ask the admin to investigate.</p></div>}
        {check.truncated && <p className="rounded-xl bg-amber-500/10 p-3 text-sm">Only the latest 50 matches are shown. Search with the payment reference to identify a specific deposit.</p>}
        {check.results.map(row => <PaymentEvidence key={row.result_key} row={row}>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copySummary(row, check.checked_at)}><ClipboardCopy className="mr-2 h-4 w-4" aria-hidden="true" />Copy customer summary</Button>
            {row.can_flag && <Button size="sm" variant="outline" disabled={flagging || flaggedKeys.includes(row.result_key)} onClick={() => { setFlagRow(row); setFlagNote(''); setError(''); setNotice('') }}>
              <Flag className="mr-2 h-4 w-4" aria-hidden="true" />{flaggedKeys.includes(row.result_key) ? 'Sent for review' : 'Flag for admin'}</Button>}
          </div>
          {flagRow?.result_key === row.result_key && <form onSubmit={submitFlag} className="mt-4 space-y-3 rounded-xl border border-border bg-muted/30 p-3">
            <label className="block text-sm font-medium" htmlFor="pocketfi-flag-note">Note for the admin</label>
            <textarea id="pocketfi-flag-note" className={fieldClass} rows={3} minLength={3} maxLength={1000} required value={flagNote} disabled={flagging} onChange={event => setFlagNote(event.target.value)} placeholder="Explain what the customer reported. Do not include passwords or bank card details." />
            <div className="flex flex-wrap items-center gap-2"><Button size="sm" type="submit" disabled={flagging || flagNote.trim().length < 3}>{flagging && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}Send for review</Button><Button size="sm" type="button" variant="ghost" disabled={flagging} onClick={() => { setFlagRow(null); setFlagNote('') }}>Cancel</Button></div>
            <p className="text-xs text-muted-foreground">This creates a review record only. It does not add or remove money.</p>
          </form>}
        </PaymentEvidence>)}
      </div>}
    </> : <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="min-w-40"><label htmlFor="pocketfi-review-status" className="mb-1.5 block text-sm font-medium">Review status</label>
          <select id="pocketfi-review-status" className={fieldClass} value={queueStatus} disabled={reviewing} onChange={event => { queueSequence.current++; queueAbort.current?.abort(); setQueue(null); setQueueError(''); setQueueStatus(event.target.value as 'pending' | 'reviewed') }}><option value="pending">Needs admin review</option><option value="reviewed">Reviewed</option></select></div>
        <Button size="sm" variant="outline" disabled={queueLoading || reviewing} onClick={() => void loadQueue()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Reload queue</Button>
        <p className="w-full text-sm text-muted-foreground">Only payments explicitly flagged for review appear here. Each card preserves the evidence from when it was flagged; use Check payment for the latest result.</p>
      </div>
      {queueLoading && <p role="status" className="py-4 text-center text-sm text-muted-foreground">Loading review queue…</p>}
      {queueError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{queueError}</p><Button variant="outline" size="sm" className="mt-3" disabled={queueLoading || reviewing} onClick={() => void loadQueue()}>Retry / Reload queue</Button></div>}
      {queue && !queue.reviews.length && <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">No {queueStatus === 'pending' ? 'pending' : 'completed'} payment reviews.</p>}
      {queue?.truncated && <p className="rounded-xl bg-amber-500/10 p-3 text-sm">Only the latest 50 reviews are shown.</p>}
      {queue?.reviews.map(review => <PaymentEvidence key={review.id} row={review.snapshot}>
        <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
          <p className="text-xs text-muted-foreground">Flagged {pocketfiNigeriaDate(review.created_at)} by {review.flagged_by_email || 'Staff'}</p>
          <p className="whitespace-pre-wrap break-words">{review.note}</p>
          {review.status === 'reviewed' && <><p className="flex items-center gap-2 font-medium"><CheckCircle2 size={16} aria-hidden="true" />Review recorded {pocketfiNigeriaDate(review.reviewed_at)}</p><p className="whitespace-pre-wrap break-words">{review.review_note}</p></>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void copySummary(review.snapshot, review.created_at)}><ClipboardCopy className="mr-2 h-4 w-4" aria-hidden="true" />Copy customer summary</Button>
          {review.status === 'pending' && <Button size="sm" variant="outline" disabled={reviewing} onClick={() => { setReviewRow(review); setReviewNote(''); setQueueError('') }}>Record admin review</Button>}</div>
        {reviewRow?.id === review.id && <form onSubmit={submitReview} className="mt-4 space-y-3 rounded-xl border border-border p-3">
          <label className="block text-sm font-medium" htmlFor="pocketfi-review-note">Admin review note</label>
          <textarea id="pocketfi-review-note" className={fieldClass} rows={3} required minLength={3} maxLength={1000} disabled={reviewing} value={reviewNote} onChange={event => setReviewNote(event.target.value)} placeholder="Record your findings and any separate follow-up needed." />
          <p className="text-xs text-muted-foreground">Marking reviewed records your findings only. It does not confirm payment success or change the customer’s wallet.</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={reviewing || reviewNote.trim().length < 3}>{reviewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}Mark reviewed</Button><Button type="button" size="sm" variant="ghost" disabled={reviewing} onClick={() => { setReviewRow(null); setReviewNote('') }}>Cancel</Button></div>
        </form>}
      </PaymentEvidence>)}
    </div>}
  </section>
}

function PaymentEvidence({ row, children }: { row: PocketfiPaymentRow; children?: React.ReactNode }) {
  return <article className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment reference</p><h3 className="mt-1 break-all font-semibold">{row.reference || 'Reference not available'}</h3></div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusColour[row.status]}`}>{pocketfiStatusLabels[row.status]}</span></div>
    <dl className="mt-4 grid grid-cols-1 gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
      <Detail label="Customer" value={row.customer_email || 'Not matched to a customer'} />
      <Detail label="Receiving account (masked)" value={row.account_number || 'Not recorded'} />
      <Detail label="Payment amount" value={pocketfiNgn(row.amount_ngn)} />
      <Detail label="Expected wallet credit" value={pocketfiNgn(row.expected_credit_ngn)} />
      <Detail label="Provider fee" value={row.fee_ngn === null ? 'Not confirmed separately' : pocketfiNgn(row.fee_ngn)} />
      <Detail label="Webhook received" value={pocketfiNigeriaDate(row.received_at)} />
    </dl>
    {row.fee_note && <p className="mt-3 text-xs text-muted-foreground">{row.fee_note}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-border bg-muted/30 p-3"><h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Webhook evidence</h4><p className="mt-2 text-sm font-semibold">{webhookLabels[row.webhook_state]}</p></div>
      <div className="rounded-xl border border-border bg-muted/30 p-3"><h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Wallet credit evidence</h4><p className="mt-2 text-sm font-semibold">{creditLabels[row.credit_state]}</p>
        {row.credit_state === 'credited' && <p className="mt-1 text-sm">{pocketfiNgn(row.credited_amount_ngn)} · {pocketfiNigeriaDate(row.credited_at)}</p>}
        {row.transaction_id && <p className="mt-2 break-all font-mono text-xs"><span className="font-sans text-muted-foreground">Transaction ID: </span>{row.transaction_id}</p>}
      </div>
    </div>
    {row.reasons.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{row.reasons.map((reason, index) => <li key={index} className="break-words">{reason}</li>)}</ul>}
    {row.status === 'no_webhook' && <p className="mt-3 text-sm font-medium">No webhook found does not mean the payment failed.</p>}
    {children}
  </article>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>
}
