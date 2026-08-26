import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import { Clock, CreditCard, LifeBuoy, MessageCircle, PackageCheck, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { useSupportSettings } from '@/hooks/useSupportSettings'
import {
  RevampCard,
  RevampFeature,
  RevampHero,
  RevampPage,
  RevampSectionTitle,
  RevampVisual,
} from '@/components/RevampLayout'
import { trackRevenueEvent } from '@/lib/revenue-os'

const helpTopics = [
  {
    title: 'Wallet or payment issue',
    description: 'Send account email, amount, payment reference, and receipt.',
    icon: CreditCard,
    tone: 'emerald' as const,
  },
  {
    title: 'Purchased account issue',
    description: 'Send order ID, product name, and what happened after login.',
    icon: PackageCheck,
    tone: 'purple' as const,
  },
  {
    title: 'Account safety',
    description: 'Never share your TallyStore password. Support only needs order and payment details.',
    icon: ShieldCheck,
    tone: 'sky' as const,
  },
]

export default function ContactPage() {
  const support = useSupportSettings()
  const primaryUrl = support.whatsappUrl || support.telegramUrl || ''
  const primaryLabel = support.whatsappUrl ? 'Open WhatsApp' : support.telegramUrl ? 'Open Telegram' : 'Visit Support Center'
  const hasSupport = Boolean(primaryUrl)

  useEffect(() => {
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      surface: 'contact',
      metadata: { has_direct_support: hasSupport },
    })
  }, [hasSupport])

  const trackContactCta = (surface: string, destination: string) => {
    trackRevenueEvent({
      eventType: surface.includes('support') ? 'SUPPORT_HANDOFF' : 'OFFER_ACCEPTED',
      surface,
      metadata: { destination },
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      <RevampPage>
        <RevampHero
          eyebrow="Contact"
          title="Need help with an order,"
          accent="wallet, or payment?"
          description="Send one clear message with your account email, order ID, payment reference, and a short description. That gives support enough context to trace the issue quickly."
          primaryHref="/support"
          primaryLabel="Support Center"
          secondaryHref="/orders"
          secondaryLabel="Order History"
        >
          <RevampVisual
            title="Support ready"
            subtitle="Payment, wallet, and delivery issues routed from one place."
            icon={LifeBuoy}
          />
        </RevampHero>

        <section className="mt-10 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <RevampCard className="overflow-hidden p-0">
            <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 p-6 text-white sm:p-8">
              <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-white/15">
                <MessageCircle className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-black sm:text-3xl">Message support</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-emerald-50">
                Wallet credits, payment recovery, and completed-order access issues get priority.
              </p>
              <div className="mt-6 grid gap-3 sm:flex">
                {hasSupport ? (
                  <Button asChild size="lg" className="bg-white text-emerald-700 hover:bg-emerald-50">
                    <a href={primaryUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackContactCta('contact_primary_support', primaryLabel)}>
                      {primaryLabel}
                    </a>
                  </Button>
                ) : (
                  <Button asChild size="lg" className="bg-white text-emerald-700 hover:bg-emerald-50">
                    <Link to="/support" onClick={() => trackContactCta('contact_support_center', '/support')}>{primaryLabel}</Link>
                  </Button>
                )}
                {support.whatsappUrl && support.telegramUrl && (
                  <Button asChild size="lg" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
                    <a href={support.telegramUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackContactCta('contact_secondary_support', 'telegram')}>
                      Telegram support
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </RevampCard>

          <RevampCard>
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
              <Clock className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-black text-slate-950 dark:text-white">Before you message</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
              Open Wallet for funding issues and Order History for completed purchases. If you still need help, include screenshots and references in one message.
            </p>
            <div className="mt-5 grid gap-2">
              <Button asChild variant="outline" className="justify-start">
                <Link to="/wallet" onClick={() => trackContactCta('contact_wallet_cta', '/wallet')}>Open Wallet</Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link to="/orders" onClick={() => trackContactCta('contact_orders_cta', '/orders')}>Open Order History</Link>
              </Button>
            </div>
          </RevampCard>
        </section>

        <section className="mt-10">
          <RevampSectionTitle
            eyebrow="What to include"
            title="Send the details that solve it faster"
          />
          <div className="grid gap-4 md:grid-cols-3">
            {helpTopics.map((topic) => (
              <RevampFeature key={topic.title} {...topic} />
            ))}
          </div>
        </section>
      </RevampPage>
      <Footer />
    </div>
  )
}
