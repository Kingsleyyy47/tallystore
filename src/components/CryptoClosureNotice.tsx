import { useEffect, useState } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/SimpleAuth'
import { useSupportSettings } from '@/hooks/useSupportSettings'

const DISMISS_KEY = 'crypto_closure_dismissed_at'
// Show again after 24 hours even if dismissed
const REDISPLAY_MS = 24 * 60 * 60 * 1000

// Whatsapp SVG icon (inline, same style as TravelVisaPage)
function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function TelegramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

// Deadline: 7 days from first render (stored in localStorage so it's consistent)
function getDeadline(): Date {
  const stored = localStorage.getItem('crypto_closure_deadline')
  if (stored) return new Date(stored)
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  localStorage.setItem('crypto_closure_deadline', deadline.toISOString())
  return deadline
}

function formatDeadline(date: Date) {
  return date.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function CryptoClosureNotice() {
  const { user } = useAuth()
  const support = useSupportSettings()
  const [open, setOpen] = useState(false)
  const [cryptoBalance, setCryptoBalance] = useState<number>(0)
  const [deadline] = useState(() => getDeadline())

  useEffect(() => {
    if (!user) return

    supabase
      .from('profiles')
      .select('crypto_balance')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const bal = data?.crypto_balance ?? 0
        setCryptoBalance(bal)
        if (bal <= 0) return

        // Only show if not dismissed within 24h
        const dismissedAt = localStorage.getItem(DISMISS_KEY)
        if (dismissedAt && Date.now() - Number(dismissedAt) < REDISPLAY_MS) return
        setOpen(true)
      })
  }, [user])

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setOpen(false)
  }

  const whatsappMsg = encodeURIComponent(
    'Hi! I have a crypto balance on TallyStore and I want to arrange a direct transfer before the deadline.'
  )
  const whatsappUrl = support.whatsappUrl
    ? `${support.whatsappUrl.replace(/\?.*$/, '')}?text=${whatsappMsg}`
    : null
  const telegramUrl = support.telegramUrl || null

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss() }}>
      <DialogContent className="max-w-md p-0 overflow-hidden" hideClose>
        {/* Header */}
        <div className="bg-amber-500 px-6 pt-6 pb-4 text-white relative">
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            <X size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-2">
              <AlertTriangle size={22} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-medium text-white/80 uppercase tracking-wide">Important Notice</p>
              <h2 className="text-lg font-bold leading-tight">Crypto Balance Closing</h2>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            Due to our crypto withdrawal provider discontinuing their service, we are closing the crypto balance feature on TallyStore.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-1">
            <p className="text-sm font-semibold text-amber-800">Your crypto balance</p>
            <p className="text-2xl font-bold text-amber-700">
              ₦{cryptoBalance.toLocaleString('en-NG')}
            </p>
          </div>

          <div className="space-y-2 text-sm text-gray-600">
            <p>
              <span className="font-semibold text-gray-800">Option 1  -  Direct transfer:</span>{' '}
              Message support to arrange a direct crypto transfer to your external wallet before the deadline.
            </p>
            <p>
              <span className="font-semibold text-gray-800">Option 2  -  Auto-convert:</span>{' '}
              Do nothing. On <span className="font-semibold text-gray-800">{formatDeadline(deadline)}</span>, your full crypto balance will be automatically moved to your Naira wallet.
            </p>
          </div>

          {/* Support buttons */}
          <div className="flex gap-3 pt-1">
            {whatsappUrl && (
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button className="w-full bg-green-500 hover:bg-green-600 text-white gap-2 text-sm">
                  <WhatsAppIcon size={16} />
                  WhatsApp Support
                </Button>
              </a>
            )}
            {telegramUrl && (
              <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button className="w-full bg-sky-500 hover:bg-sky-600 text-white gap-2 text-sm">
                  <TelegramIcon size={16} />
                  Telegram Support
                </Button>
              </a>
            )}
          </div>

          <button
            onClick={handleDismiss}
            className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors pt-1"
          >
            Remind me later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
