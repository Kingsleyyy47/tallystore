import { ArrowLeft, Braces, CircleDashed, Smartphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import Navbar from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { Button } from '@/components/ui/button'

const features = {
  circle: { name: 'Tally Circle', icon: CircleDashed, description: 'Our referral rewards are getting ready. We’ll share the details when Tally Circle launches.' },
  api: { name: 'API Access', icon: Braces, description: 'Connect your tools to TallyStore. Customer API access will be available when it is ready.' },
  bills: { name: 'Bills & Airtime', icon: Smartphone, description: 'This service is currently unavailable. Explore our available services from Home.' },
}

export default function UpcomingFeaturePage({ feature }: { feature: keyof typeof features }) {
  const { name, icon: Icon, description } = features[feature]
  return <div className="min-h-screen bg-background">
    <Navbar />
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-28 sm:pt-32">
      <section className="rounded-3xl border border-border bg-card p-7 text-center sm:p-12">
        <img src="/icon-192x192.png" alt="TallyStore" className="mx-auto h-14 w-14 object-contain" />
        <span className="mx-auto mt-7 grid h-16 w-16 place-items-center rounded-2xl bg-teal-500/10 text-teal-600 dark:text-teal-300"><Icon className="h-8 w-8" /></span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{feature === 'bills' ? 'Currently unavailable' : 'Coming soon'}</p>
        <h1 className="mt-2 text-3xl font-bold">{name}</h1>
        <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted-foreground">{description}</p>
        <Button asChild className="mt-7 rounded-full"><Link to="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" />Back to Home</Link></Button>
      </section>
    </main>
    <Footer />
  </div>
}
