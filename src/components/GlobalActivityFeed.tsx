import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ShoppingCart, X, ChevronDown, ChevronUp, Activity } from 'lucide-react'
import { getGlobalActivityFeed, type GlobalActivityItem } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/contexts/CurrencyContext'

// Site-wide "social proof" activity feed shown on every page. Mixes real,
// masked activity (deposits + completed orders, fetched via the
// get_recent_activity_feed Postgres function) with a small pool of simulated
// filler entries so the feed never looks empty or stale. Dismissible per
// browser session via sessionStorage.

const DISMISS_KEY = 'global_activity_feed_dismissed'
const GATEWAYS = ['Ercas Pay', 'PocketFi'] as const
const SIM_NAMES = ['Chi***', 'Tha***', 'Emm***', 'Big***', 'Uch***', 'Mar***', 'Dav***', 'Fav***', 'Pre***', 'Jos***']
const SIM_PRODUCT_LABELS = [
  'TikTok Aged Account',
  'Facebook Aged Account',
  'Instagram Account',
  'Twitter (X) Account',
  'HMA VPN',
  'SMS Verification Number',
  'Telegram Account',
]
const SIM_DEPOSIT_AMOUNTS = [500, 1000, 1500, 2000, 3000, 5000, 10000]

interface FeedRow {
  id: string
  kind: 'deposit' | 'order'
  maskedName: string
  amount: number
  label: string
  ts: number // ms epoch, used for relative time + sorting
}

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function makeSimulatedRow(): FeedRow {
  const isDeposit = Math.random() < 0.5
  const ts = Date.now() - Math.floor(Math.random() * 60_000)
  if (isDeposit) {
    return {
      id: `sim-${ts}-${Math.random()}`,
      kind: 'deposit',
      maskedName: randomFrom(SIM_NAMES),
      amount: randomFrom(SIM_DEPOSIT_AMOUNTS),
      label: `via ${randomFrom(GATEWAYS)}`,
      ts,
    }
  }
  return {
    id: `sim-${ts}-${Math.random()}`,
    kind: 'order',
    maskedName: randomFrom(SIM_NAMES),
    amount: 0,
    label: randomFrom(SIM_PRODUCT_LABELS),
    ts,
  }
}

function fromRealItem(item: GlobalActivityItem, index: number): FeedRow {
  return {
    id: `real-${index}-${item.createdAt}`,
    kind: item.kind,
    maskedName: item.maskedName,
    amount: item.amount,
    label: item.label,
    ts: new Date(item.createdAt).getTime() || Date.now(),
  }
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 30) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

const MAX_ROWS = 9

export default function GlobalActivityFeed() {
  const { formatPrice } = useCurrency()
  const [rows, setRows] = useState<FeedRow[]>([])
  const [dismissed, setDismissed] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [, forceTick] = useState(0)
  const rowsRef = useRef<FeedRow[]>([])

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  // Restore dismissal state (per browser session) and seed with simulated
  // rows immediately so the feed never renders empty while real data loads.
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === 'true')
    } catch {
      // sessionStorage unavailable (e.g. privacy mode) - default to shown
    }
    setRows(Array.from({ length: 5 }, makeSimulatedRow).sort((a, b) => b.ts - a.ts))
  }, [])

  // Pull real activity on mount and periodically, merging it in front of
  // whatever simulated rows are currently showing.
  useEffect(() => {
    let isMounted = true

    const loadReal = async () => {
      const real = await getGlobalActivityFeed(MAX_ROWS)
      if (!isMounted || real.length === 0) return

      setRows((prev) => {
        const realRows = real.map(fromRealItem)
        const simStillRecent = prev.filter((r) => r.id.startsWith('sim-'))
        const merged = [...realRows, ...simStillRecent]
          .sort((a, b) => b.ts - a.ts)
          .slice(0, MAX_ROWS)
        return merged
      })
    }

    loadReal()
    const refreshInterval = window.setInterval(loadReal, 60_000)
    return () => {
      isMounted = false
      window.clearInterval(refreshInterval)
    }
  }, [])

  // Periodically inject a fresh simulated row at the top so the feed feels
  // alive between real-data refreshes, capped at MAX_ROWS total.
  useEffect(() => {
    const interval = window.setInterval(() => {
      setRows((prev) => [makeSimulatedRow(), ...prev].slice(0, MAX_ROWS))
    }, 18_000 + Math.random() * 9_000)
    return () => window.clearInterval(interval)
  }, [])

  // Re-render every 30s purely to keep relative timestamps ("2m ago") fresh.
  useEffect(() => {
    const interval = window.setInterval(() => forceTick((t) => t + 1), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const handleDismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, 'true')
    } catch {
      // ignore
    }
  }

  if (dismissed) return null

  return (
    <div className="container mx-auto px-6 pt-10">
      <div className="w-full rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-primary/5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <p className="text-xs font-semibold truncate flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" />
              Live Activity
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              aria-label={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="max-h-[280px] overflow-y-auto divide-y">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2.5 px-3 py-2">
                <div
                  className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-full',
                    row.kind === 'deposit'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                      : 'bg-primary/10 text-primary',
                  )}
                >
                  {row.kind === 'deposit' ? (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  ) : (
                    <ShoppingCart className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">
                    {row.maskedName}{' '}
                    <span className="font-normal text-muted-foreground">
                      {row.kind === 'deposit'
                        ? `funded ${formatPrice(row.amount)} ${row.label}`
                        : `purchased ${row.label}`}
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">{formatRelativeTime(row.ts)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
