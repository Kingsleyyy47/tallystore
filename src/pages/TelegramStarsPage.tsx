import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Star, Crown, Search, CheckCircle2, Clock, RefreshCw, User } from 'lucide-react'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { useAuth } from '@/contexts/SimpleAuth'
import { RecommendationStrip } from '@/components/RecommendationCard'
import { useRecommendations } from '@/hooks/useRecommendations'
import { format } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────
type MarkupTier = { min_qty: number; max_qty: number | null; markup_ngn: number }

type StarPricing = {
  cost_per_star_usdt: number
  markup_tiers: MarkupTier[]
  usdt_to_ngn: number
}

type PremiumProduct = {
  id: string
  label: string
  months: number
  price_ngn: number
}

type TelegramOrder = {
  id: string
  order_type: 'stars' | 'premium'
  username: string
  quantity?: number
  months?: number
  price_ngn: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message?: string
  refunded_at?: string
  created_at: string
}

type RecipientInfo = { recipient: string; name: string; photo?: string; myself: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────────
async function invokeTg<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('telegram-stars', { body: { action, ...body } })
  if (error) throw error
  if (!data?.success) throw new Error(data?.error || 'Something went wrong')
  return data.data as T
}

function calcStarPrice(quantity: number, pricing: StarPricing): number {
  if (!pricing || pricing.cost_per_star_usdt <= 0) return 0
  const base = pricing.cost_per_star_usdt * quantity * pricing.usdt_to_ngn
  const tier = pricing.markup_tiers.find(t =>
    quantity >= t.min_qty && (t.max_qty === null || quantity <= t.max_qty)
  )
  return Math.ceil((base + (tier ? tier.markup_ngn : 0)) / 10) * 10
}

function statusBadge(status: TelegramOrder['status']) {
  const map: Record<string, [string, string]> = {
    completed:  ['bg-green-500/15 text-green-600 border-green-200', 'Delivered'],
    processing: ['bg-blue-500/15 text-blue-600 border-blue-200', 'Processing'],
    failed:     ['bg-red-500/15 text-red-600 border-red-200', 'Failed'],
    pending:    ['bg-amber-500/15 text-amber-600 border-amber-200', 'Pending'],
  }
  const [cls, label] = map[status] || map.pending
  return <Badge className={cls}>{label}</Badge>
}

const STAR_PRESETS = [50, 150, 250, 1000, 2500]

// ── Recipient display ─────────────────────────────────────────────────────────
function RecipientCard({ info }: { info: RecipientInfo }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-900/20">
      {info.photo
        ? <img src={info.photo} alt={info.name} className="h-10 w-10 rounded-full object-cover" />
        : <div className="grid h-10 w-10 place-items-center rounded-full bg-purple-200 dark:bg-purple-700"><User className="h-5 w-5 text-purple-600 dark:text-purple-300" /></div>
      }
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{info.name}</p>
        <p className="text-xs text-muted-foreground">Verified Telegram user</p>
      </div>
      <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
    </div>
  )
}

// ── Stars tab ─────────────────────────────────────────────────────────────────
function StarsTab({ pricing, onOrderCreated }: { pricing: StarPricing | null; onOrderCreated: () => void }) {
  const { toast } = useToast()
  const [username, setUsername] = useState('')
  const [selectedQty, setSelectedQty] = useState<number | 'custom'>(50)
  const [customQty, setCustomQty] = useState('')
  const [searching, setSearching] = useState(false)
  const [recipient, setRecipient] = useState<RecipientInfo | null>(null)
  const [buying, setBuying] = useState(false)

  const activeQty = selectedQty === 'custom' ? Math.round(Number(customQty) || 0) : selectedQty
  const price = pricing && activeQty >= 50 ? calcStarPrice(activeQty, pricing) : 0
  const priceReady = pricing && activeQty >= 50 && price > 0

  const searchRecipient = async () => {
    if (!username.trim() || activeQty < 50) return
    setSearching(true)
    setRecipient(null)
    try {
      const data = await invokeTg<RecipientInfo>('search_recipient_stars', {
        username: username.replace(/^@/, ''),
        quantity: activeQty,
      })
      setRecipient(data)
    } catch (err: any) {
      toast({ title: 'User not found', description: err.message, variant: 'destructive' })
    } finally {
      setSearching(false)
    }
  }

  const buy = async () => {
    if (!recipient || activeQty < 50 || !price) return
    setBuying(true)
    try {
      await invokeTg('create_stars_order', {
        username: username.replace(/^@/, ''),
        recipient_hash: recipient.recipient,
        recipient_name: recipient.name,
        quantity: activeQty,
      })
      toast({ title: '⭐ Order placed!', description: `${activeQty.toLocaleString()} stars on their way to @${username.replace(/^@/, '')}` })
      setUsername('')
      setRecipient(null)
      setSelectedQty(50)
      setCustomQty('')
      onOrderCreated()
    } catch (err: any) {
      toast({ title: 'Order failed', description: err.message, variant: 'destructive' })
    } finally {
      setBuying(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Amount selector */}
      <div>
        <label className="mb-2 block text-sm font-medium">Select Amount</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {STAR_PRESETS.map(qty => {
            const p = pricing ? calcStarPrice(qty, pricing) : null
            return (
              <button
                key={qty}
                onClick={() => setSelectedQty(qty)}
                className={`rounded-xl border p-2.5 text-center transition-all ${
                  selectedQty === qty
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 ring-2 ring-purple-400'
                    : 'border-border hover:border-purple-300'
                }`}
              >
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                  <span className="font-bold text-sm">{qty >= 1000 ? `${qty / 1000}k` : qty}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{p ? `₦${p.toLocaleString()}` : '—'}</p>
              </button>
            )
          })}
          <button
            onClick={() => setSelectedQty('custom')}
            className={`rounded-xl border p-2.5 text-center transition-all ${
              selectedQty === 'custom'
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 ring-2 ring-purple-400'
                : 'border-border hover:border-purple-300'
            }`}
          >
            <span className="font-bold text-sm block">Custom</span>
            <p className="text-[11px] text-muted-foreground">Any qty</p>
          </button>
        </div>

        {selectedQty === 'custom' && (
          <div className="mt-3 space-y-1">
            <Input
              type="number"
              min={50}
              max={1000000}
              placeholder="Enter quantity (min 50)"
              value={customQty}
              onChange={e => setCustomQty(e.target.value)}
            />
            {pricing && activeQty >= 50 && (
              <p className="text-sm text-muted-foreground">
                Price: <span className="font-semibold text-foreground">₦{calcStarPrice(activeQty, pricing).toLocaleString()}</span>
                {(() => {
                  const tier = pricing.markup_tiers.find(t => activeQty >= t.min_qty && (t.max_qty === null || activeQty <= t.max_qty))
                  return tier ? <span className="text-xs ml-1">(incl. ₦{tier.markup_ngn.toLocaleString()} markup)</span> : null
                })()}
              </p>
            )}
            {activeQty > 0 && activeQty < 50 && <p className="text-xs text-red-500">Minimum is 50 stars</p>}
          </div>
        )}
      </div>

      {/* Username */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">Recipient Username</label>
        <div className="flex gap-2">
          <Input
            placeholder="@username"
            value={username}
            onChange={e => { setUsername(e.target.value); setRecipient(null) }}
            onKeyDown={e => e.key === 'Enter' && searchRecipient()}
            className="flex-1"
          />
          <Button variant="outline" onClick={searchRecipient} disabled={searching || !username.trim() || activeQty < 50}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
        {recipient && <div className="mt-2"><RecipientCard info={recipient} /></div>}
      </div>

      {/* Buy */}
      <Button
        className="w-full bg-purple-600 hover:bg-purple-700"
        disabled={!recipient || !priceReady || buying}
        onClick={buy}
      >
        {buying
          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Placing order…</>
          : priceReady
            ? <><Star className="mr-2 h-4 w-4" />Send {activeQty.toLocaleString()} Stars — ₦{price.toLocaleString()}</>
            : <><Star className="mr-2 h-4 w-4" />Select amount & recipient</>
        }
      </Button>
    </div>
  )
}

// ── Premium tab ───────────────────────────────────────────────────────────────
function PremiumTab({ products, onOrderCreated }: { products: PremiumProduct[]; onOrderCreated: () => void }) {
  const { toast } = useToast()
  const [username, setUsername] = useState('')
  const [searching, setSearching] = useState(false)
  const [recipient, setRecipient] = useState<RecipientInfo | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<PremiumProduct | null>(null)
  const [buying, setBuying] = useState(false)

  const searchRecipient = async () => {
    if (!username.trim() || !selectedProduct) return
    setSearching(true)
    setRecipient(null)
    try {
      const data = await invokeTg<RecipientInfo>('search_recipient_premium', {
        username: username.replace(/^@/, ''),
        months: selectedProduct.months,
      })
      setRecipient(data)
    } catch (err: any) {
      toast({ title: 'User not found', description: err.message, variant: 'destructive' })
    } finally {
      setSearching(false)
    }
  }

  const buy = async () => {
    if (!recipient || !selectedProduct) return
    setBuying(true)
    try {
      await invokeTg('create_premium_order', {
        username: username.replace(/^@/, ''),
        recipient_hash: recipient.recipient,
        recipient_name: recipient.name,
        product_id: selectedProduct.id,
      })
      toast({ title: '👑 Order placed!', description: `${selectedProduct.months}-month Telegram Premium gifted to @${username.replace(/^@/, '')}` })
      setUsername('')
      setRecipient(null)
      setSelectedProduct(null)
      onOrderCreated()
    } catch (err: any) {
      toast({ title: 'Order failed', description: err.message, variant: 'destructive' })
    } finally {
      setBuying(false)
    }
  }

  if (products.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No premium packages available right now.</p>

  return (
    <div className="space-y-5">
      {/* Duration */}
      <div>
        <label className="mb-2 block text-sm font-medium">Select Duration</label>
        <div className="grid grid-cols-3 gap-3">
          {products.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelectedProduct(p); setRecipient(null) }}
              className={`rounded-xl border p-4 text-center transition-all ${
                selectedProduct?.id === p.id
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 ring-2 ring-purple-400'
                  : 'border-border hover:border-purple-300'
              }`}
            >
              <Crown className="h-5 w-5 text-purple-500 mx-auto mb-1" />
              <p className="font-bold text-sm">{p.months} Months</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {p.price_ngn > 0 ? `₦${Number(p.price_ngn).toLocaleString()}` : 'Price TBD'}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Username */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">Recipient Username</label>
        <div className="flex gap-2">
          <Input
            placeholder="@username"
            value={username}
            onChange={e => { setUsername(e.target.value); setRecipient(null) }}
            onKeyDown={e => e.key === 'Enter' && searchRecipient()}
            className="flex-1"
          />
          <Button variant="outline" onClick={searchRecipient} disabled={searching || !username.trim() || !selectedProduct}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
        {recipient && <div className="mt-2"><RecipientCard info={recipient} /></div>}
      </div>

      <Button
        className="w-full bg-purple-600 hover:bg-purple-700"
        disabled={!recipient || !selectedProduct || buying}
        onClick={buy}
      >
        {buying
          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Placing order…</>
          : selectedProduct
            ? <><Crown className="mr-2 h-4 w-4" />Gift {selectedProduct.months}-Month Premium — ₦{Number(selectedProduct.price_ngn).toLocaleString()}</>
            : <><Crown className="mr-2 h-4 w-4" />Select duration & recipient</>
        }
      </Button>
    </div>
  )
}

// ── Order history ─────────────────────────────────────────────────────────────
function OrderHistory({ orders, loading, onRefresh, onPoll }: {
  orders: TelegramOrder[]; loading: boolean; onRefresh: () => void; onPoll: (o: TelegramOrder) => void
}) {
  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  if (orders.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No orders yet.</p>
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="mr-2 h-3 w-3" />Refresh</Button>
      </div>
      {orders.map(order => (
        <div key={order.id} className="rounded-xl border p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              {order.order_type === 'stars'
                ? <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                : <Crown className="h-4 w-4 text-purple-500" />}
              <span className="font-semibold text-sm">
                {order.order_type === 'stars' ? `${order.quantity?.toLocaleString()} Stars` : `${order.months}-Month Premium`}
              </span>
              <span className="text-muted-foreground text-sm">→ @{order.username}</span>
            </div>
            {statusBadge(order.status)}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>₦{Number(order.price_ngn).toLocaleString()}</span>
            <span>{format(new Date(order.created_at), 'dd MMM yyyy, HH:mm')}</span>
          </div>
          {order.error_message && <p className="text-xs text-red-500">{order.error_message}</p>}
          {order.refunded_at && <p className="text-xs text-green-600">Refunded ₦{Number(order.price_ngn).toLocaleString()}</p>}
          {order.status === 'processing' && (
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => onPoll(order)}>
              <Clock className="mr-1.5 h-3 w-3" />Check delivery status
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TelegramStarsPage() {
  const { toast } = useToast()
  const { user, isAdmin, isStaff } = useAuth()
  const { recommendations: recs } = useRecommendations({ limit: 3 })
  const [starPricing, setStarPricing] = useState<StarPricing | null>(null)
  const [premiumProducts, setPremiumProducts] = useState<PremiumProduct[]>([])
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [orders, setOrders] = useState<TelegramOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [tab, setTab] = useState<'stars' | 'premium'>('stars')

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true)
    try {
      const [pricing, products] = await Promise.all([
        invokeTg<StarPricing>('get_star_pricing'),
        invokeTg<PremiumProduct[]>('get_premium_products'),
      ])
      setStarPricing(pricing)
      setPremiumProducts(products)
    } catch (err: any) {
      toast({ title: 'Failed to load pricing', description: err.message, variant: 'destructive' })
    } finally {
      setLoadingConfig(false)
    }
  }, [])

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const data = await invokeTg<TelegramOrder[]>('get_my_orders')
      setOrders(data)
    } catch { /* silent */ } finally {
      setOrdersLoading(false)
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  const pollOrder = async (order: TelegramOrder) => {
    try {
      const updated = await invokeTg<TelegramOrder>('poll_order', { order_id: order.id })
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o))
      if (updated.status === 'completed') {
        toast({ title: '✅ Delivered!' })
        window.dispatchEvent(new Event('transactionAdded'))
      } else if (updated.status === 'failed') {
        toast({ title: 'Order failed', description: updated.error_message || 'You have been refunded.', variant: 'destructive' })
        window.dispatchEvent(new Event('transactionAdded'))
      }
    } catch (err: any) {
      toast({ title: 'Could not check status', description: err.message, variant: 'destructive' })
    }
  }

  const onOrderCreated = () => {
    loadOrders()
    window.dispatchEvent(new Event('transactionAdded'))
  }

  // Only admin and staff can access — everyone else sees coming soon
  if (!isAdmin && !isStaff) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="text-center max-w-md space-y-5">
            <div className="flex items-center justify-center gap-3 mb-2">
              <Star className="h-10 w-10 text-amber-400 fill-amber-400" />
              <Crown className="h-10 w-10 text-purple-500" />
            </div>
            <h1 className="text-3xl font-bold">Telegram Stars & Premium</h1>
            <p className="text-muted-foreground">
              We're working on something exciting! Telegram Stars and Premium gifting is coming soon.
              You'll be able to send Stars and Telegram Premium to any user instantly.
            </p>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
              <Clock className="h-4 w-4" />
              Coming Soon
            </div>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Star className="h-7 w-7 text-amber-400 fill-amber-400" />
            <Crown className="h-7 w-7 text-purple-500" />
          </div>
          <h1 className="text-2xl font-bold">Telegram Stars & Premium</h1>
          <p className="text-muted-foreground text-sm">Gift stars or Telegram Premium to any user instantly</p>
        </div>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Buy Now</CardTitle></CardHeader>
          <CardContent>
            {loadingConfig
              ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              : (
                <Tabs value={tab} onValueChange={v => setTab(v as any)}>
                  <TabsList className="w-full mb-5">
                    <TabsTrigger value="stars" className="flex-1 gap-1.5">
                      <Star className="h-4 w-4 text-amber-400 fill-amber-400" />Stars
                    </TabsTrigger>
                    <TabsTrigger value="premium" className="flex-1 gap-1.5">
                      <Crown className="h-4 w-4 text-purple-500" />Premium
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="stars">
                    <StarsTab pricing={starPricing} onOrderCreated={onOrderCreated} />
                  </TabsContent>
                  <TabsContent value="premium">
                    <PremiumTab products={premiumProducts} onOrderCreated={onOrderCreated} />
                  </TabsContent>
                </Tabs>
              )
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">My Orders</CardTitle>
              {orders.length === 0 && !ordersLoading && (
                <Button variant="ghost" size="sm" onClick={loadOrders}>
                  <RefreshCw className="mr-1.5 h-3 w-3" />Load orders
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <OrderHistory orders={orders} loading={ordersLoading} onRefresh={loadOrders} onPoll={pollOrder} />
          </CardContent>
        </Card>

        {recs.length > 0 && (
          <RecommendationStrip
            products={recs}
            surface="telegram_stars_page"
            actionType="SHOW_ALTERNATIVE"
            title="Explore more products"
          />
        )}
      </main>
      <Footer />
    </div>
  )
}
