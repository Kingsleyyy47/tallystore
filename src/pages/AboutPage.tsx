import { Link } from 'react-router-dom'
import { ArrowRight, Clock, KeyRound, PackageCheck, ShieldCheck, Sparkles, WalletCards } from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import {
  RevampCard,
  RevampFeature,
  RevampHero,
  RevampPage,
  RevampSectionTitle,
  RevampVisual,
} from '@/components/RevampLayout'

const values = [
  {
    icon: ShieldCheck,
    title: 'Verified inventory',
    description: 'Products are structured for clear delivery, access details, and support follow-up after purchase.',
    tone: 'purple' as const,
  },
  {
    icon: WalletCards,
    title: 'Wallet-first checkout',
    description: 'Customers fund once, then buy faster across products, SMS numbers, and connected services.',
    tone: 'emerald' as const,
  },
  {
    icon: Clock,
    title: 'Fast handoff',
    description: 'Completed orders are available from Order History without waiting for manual messages.',
    tone: 'sky' as const,
  },
]

const process = [
  'Products are organized by category, stock, and delivery type.',
  'Payments and wallet movement are tracked from the customer account.',
  'Completed orders stay available through Order History.',
  'Support can trace problems with order IDs and payment references.',
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      <RevampPage>
        <RevampHero
          eyebrow="About TallyStore"
          title="A cleaner way to buy digital accounts,"
          accent="fund once and move fast."
          description="TallyStore brings premium social accounts, wallet funding, SMS numbers, and support workflows into one customer account. The goal is simple: clear stock, clear pricing, and delivery customers can find again."
          primaryHref="/products"
          primaryLabel="Browse Products"
          secondaryHref="/support"
          secondaryLabel="Contact Support"
        >
          <RevampVisual
            title="Digital delivery"
            subtitle="Accounts, wallet, support, and order history working together."
            icon={KeyRound}
          />
        </RevampHero>

        <section className="mt-10">
          <RevampSectionTitle
            eyebrow="What matters"
            title="Built around trust, speed, and access"
            description="The site is designed so customers can buy, fund, recover payments, and return to past orders without guessing where anything lives."
          />
          <div className="grid gap-4 md:grid-cols-3">
            {values.map((item) => (
              <RevampFeature key={item.title} {...item} />
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <RevampCard>
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-black text-slate-950 dark:text-white">What TallyStore offers</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
              Premium social media accounts, SMS numbers, wallet funding, crypto services, and support tools for customers who need direct access without scattered conversations.
            </p>
            <Link
              to="/how-it-works"
              className="mt-5 inline-flex items-center gap-2 text-sm font-black text-purple-700 dark:text-purple-300"
            >
              See how it works
              <ArrowRight className="h-4 w-4" />
            </Link>
          </RevampCard>

          <RevampCard>
            <h2 className="text-2xl font-black text-slate-950 dark:text-white">How the platform stays clear</h2>
            <div className="mt-5 grid gap-3">
              {process.map((item, index) => (
                <div key={item} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.035]">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-purple-600 text-xs font-black text-white">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{item}</p>
                </div>
              ))}
            </div>
          </RevampCard>
        </section>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-gradient-to-r from-purple-600 to-violet-800 p-5 text-white shadow-lg shadow-purple-500/15 dark:border-white/10 sm:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-black">
                <PackageCheck className="h-3.5 w-3.5" />
                Ready to shop
              </div>
              <h2 className="text-2xl font-black sm:text-3xl">Start from products or fund your wallet first.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
                Wallet funding keeps checkout fast, while Order History keeps completed access details easy to find.
              </p>
            </div>
            <Link
              to="/wallet"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-black text-purple-700 transition hover:bg-purple-50"
            >
              Open Wallet
            </Link>
          </div>
        </section>
      </RevampPage>
      <Footer />
    </div>
  )
}
