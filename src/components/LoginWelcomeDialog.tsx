import { useEffect, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X, MessageCircle, Radio, Megaphone } from 'lucide-react'
import { useAuth } from '@/contexts/SimpleAuth'
import { useSupportSettings } from '@/hooks/useSupportSettings'

const SESSION_KEY_PREFIX = 'login_welcome_shown:'

function safeSupportUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

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

export default function LoginWelcomeDialog() {
  const [open, setOpen] = useState(false)
  const { user, loading, roleLookupError, isAdmin, isStaff } = useAuth()
  const settings = useSupportSettings(user?.id)
  const userId = user?.id

  useEffect(() => {
    setOpen(false)
    if (!userId || loading || settings.loading || roleLookupError || isAdmin || isStaff) return
    try {
      if (sessionStorage.getItem(SESSION_KEY_PREFIX + userId) === settings.popupMessage) return
    } catch { /* Storage denial must not hide the announcement. */ }

    const timer = window.setTimeout(() => setOpen(true), 800)
    return () => window.clearTimeout(timer)
  }, [userId, loading, settings.loading, settings.popupMessage, roleLookupError, isAdmin, isStaff])

  const dismiss = () => {
    try {
      if (userId) sessionStorage.setItem(SESSION_KEY_PREFIX + userId, settings.popupMessage)
    } catch { /* Closing the dialog remains available when storage is denied. */ }
    setOpen(false)
  }

  if (!open || !userId || loading || settings.loading || roleLookupError || isAdmin || isStaff) return null

  const whatsappUrl = safeSupportUrl(settings.whatsappUrl)
  const telegramUrl = safeSupportUrl(settings.telegramUrl)
  const channelUrl = safeSupportUrl(settings.channelUrl)
  const hasLinks = whatsappUrl || telegramUrl || channelUrl

  return (
    <DialogPrimitive.Root open={open} onOpenChange={next => { if (!next) dismiss() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-black/65 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[201] flex max-h-[min(85dvh,680px)] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl outline-none">
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Megaphone className="h-4 w-4" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-bold text-foreground">Store announcement</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-muted-foreground">The latest update and ways to get help.</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Close announcement"><X className="h-4 w-4" /></DialogPrimitive.Close>
          </header>

          <div className="min-h-0 overflow-y-auto overscroll-contain md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section aria-label="Announcement message" className="min-w-0 border-b border-border bg-primary/[0.04] p-4 sm:p-5 md:border-b-0 md:border-r">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Please read</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]">{settings.popupMessage}</p>
            </section>
            <aside aria-label="Support and community" className="space-y-2 p-4">
              <h3 className="mb-3 text-xs font-semibold text-muted-foreground">Support &amp; community</h3>
          {channelUrl && (
            <a
              href={channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 transition-colors hover:bg-muted"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Radio className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-sm font-semibold">Join our channel</p>
                <p className="text-xs text-muted-foreground">Updates &amp; deals</p>
              </div>
            </a>
          )}

          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 transition-colors hover:bg-muted"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                <WhatsAppIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-sm font-semibold">WhatsApp support</p>
                <p className="text-xs text-muted-foreground">Wallet &amp; order help</p>
              </div>
            </a>
          )}

          {telegramUrl && (
            <a
              href={telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 transition-colors hover:bg-muted"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300">
                <TelegramIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-sm font-semibold">Telegram support</p>
                <p className="text-xs text-muted-foreground">Message our team</p>
              </div>
            </a>
          )}

          {!hasLinks && (
            <a
              href="/support"
              onClick={dismiss}
              className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 transition-colors hover:bg-muted"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-sm font-semibold">Help Centre</p>
                <p className="text-sm text-muted-foreground">Get help with your account</p>
              </div>
            </a>
          )}

            </aside>
          </div>
          <footer className="shrink-0 border-t border-border p-3">
            <button onClick={dismiss} className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Got it</button>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
