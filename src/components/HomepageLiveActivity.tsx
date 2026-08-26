import { useEffect, useMemo, useState } from 'react'
import { getGlobalActivityFeed, type GlobalActivityItem } from '@/lib/supabase'
import { useCurrency } from '@/contexts/CurrencyContext'

type ActivityRow = {
  id: string
  kind: 'deposit' | 'order'
  maskedName: string
  amount: number
  label: string
  quantity?: number
  ts: number
}

function fromRealItem(item: GlobalActivityItem, index: number): ActivityRow {
  return {
    id: `real-${index}-${item.createdAt}`,
    kind: item.kind,
    maskedName: item.maskedName,
    amount: item.amount,
    label: item.label,
    quantity: item.kind === 'order' ? 1 : undefined,
    ts: new Date(item.createdAt).getTime() || Date.now(),
  }
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

export default function HomepageLiveActivity() {
  const { formatPrice } = useCurrency()
  const [realRows, setRealRows] = useState<ActivityRow[]>([])
  const [, forceTick] = useState(0)

  useEffect(() => {
    let mounted = true

    async function loadActivity() {
      const activity = await getGlobalActivityFeed(6)
      if (!mounted) return
      setRealRows(activity.map(fromRealItem))
    }

    loadActivity()
    const refresh = window.setInterval(loadActivity, 60_000)
    const tick = window.setInterval(() => forceTick((value) => value + 1), 30_000)

    return () => {
      mounted = false
      window.clearInterval(refresh)
      window.clearInterval(tick)
    }
  }, [])

  const rows = useMemo(() => {
    return [...realRows]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 6)
  }, [realRows])

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
      <div className="border-y border-slate-200 py-10 dark:border-white/10">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.85)]" />
            <h2 className="text-lg font-black tracking-normal text-slate-950 dark:text-white">Live activity</h2>
          </div>
          <p className="hidden text-sm font-semibold text-slate-500 dark:text-slate-500 sm:block">Real transactions, right now</p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-4 py-5 text-sm font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-400">
            Verified purchases and deposits will appear here once customers complete them.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {rows.map((row) => (
            <article
              key={row.id}
              className="flex min-h-[80px] items-center gap-3 rounded-lg border border-slate-200 bg-white/85 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${row.kind === 'order' ? 'bg-emerald-400' : 'bg-violet-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <strong className="truncate text-sm font-black text-slate-950 dark:text-white">{row.maskedName}</strong>
                  <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-500">{formatRelativeTime(row.ts)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-slate-600 dark:text-slate-400">
                  {row.kind === 'deposit'
                    ? `Deposited ${formatPrice(row.amount)}`
                    : `Bought ${row.quantity || 1}x ${row.label}`}
                </p>
              </div>
            </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
