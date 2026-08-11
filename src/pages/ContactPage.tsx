import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { MessageCircle, Clock, CreditCard, PackageCheck, ShieldCheck } from 'lucide-react'
import { BackToHome } from '@/components/ui/back-button'
import { useSupportSettings } from '@/hooks/useSupportSettings'

const helpTopics = [
  {
    title: 'Wallet or payment issue',
    description: 'Send your account email, payment reference, amount, and receipt.',
    icon: CreditCard,
  },
  {
    title: 'Purchased account issue',
    description: 'Send the order ID, product name, and a short description of what went wrong.',
    icon: PackageCheck,
  },
  {
    title: 'Account safety',
    description: 'Do not share your TallyStore password. Support only needs order and payment details.',
    icon: ShieldCheck,
  },
]

const ContactPage = () => {
  const support = useSupportSettings()
  const primaryUrl = support.whatsappUrl || support.telegramUrl || ''
  const primaryLabel = support.whatsappUrl ? 'Open WhatsApp' : support.telegramUrl ? 'Open Telegram' : 'Message support'
  const hasSupport = Boolean(primaryUrl)

  return (
    <div className="min-h-screen bg-gray-50 py-8 dark:bg-gray-900">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mb-8">
          <BackToHome />
        </div>

        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3">
            Support
          </Badge>
          <h1 className="mb-4 text-4xl font-bold text-gray-900 dark:text-white">
            Contact TallyStore
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-gray-600 dark:text-gray-400">
            {hasSupport ? 'Reach our support team directly for account, wallet, and order issues.' : 'Visit the Support Center for help with common issues.'}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="overflow-hidden border-emerald-200">
            <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 p-8 text-white md:p-10">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
                <MessageCircle className="h-7 w-7" />
              </div>
              <h2 className="mb-3 text-3xl font-bold">Message support</h2>
              <p className="mb-8 max-w-xl text-emerald-50">
                Relay account, wallet, payment, and order issues to our support team directly.
              </p>
              {hasSupport ? (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="bg-white text-emerald-700 hover:bg-emerald-50">
                    <a href={primaryUrl} target="_blank" rel="noopener noreferrer">
                      {primaryLabel}
                    </a>
                  </Button>
                  {support.whatsappUrl && support.telegramUrl && (
                    <Button asChild size="lg" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
                      <a href={support.telegramUrl} target="_blank" rel="noopener noreferrer">
                        Telegram support
                      </a>
                    </Button>
                  )}
                </div>
              ) : (
                <Button asChild size="lg" className="bg-white text-emerald-700 hover:bg-emerald-50">
                  <Link to="/support">Visit Support Center</Link>
                </Button>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Response details</CardTitle>
              <CardDescription>What to expect when you message support.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Priority support</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Wallet credits, payment recovery, and completed-order access issues are handled first.
                  </p>
                </div>
              </div>
              <Separator />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Send one clear message with all details so we can investigate without asking for the same information again.
              </p>
              <Button asChild className="w-full">
                <Link to="/support">View Support Center</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {helpTopics.map((topic) => {
            const Icon = topic.icon

            return (
              <Card key={topic.title}>
                <CardContent className="p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">{topic.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{topic.description}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Frequently Asked Questions</CardTitle>
            <CardDescription>Quick answers before you message support.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Do you offer phone calls?</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  No. WhatsApp chat is the active support channel for now.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">What should I include?</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Include your account email, order ID, payment reference, receipt, and the issue you need fixed.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Where do I get credentials?</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Open Order History and download credentials from the completed order.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Can I track old support tickets?</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Ticket tracking is not active. Use the WhatsApp handle for current support.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Separator className="my-8" />

        <div className="text-center">
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Link to="/support" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Support Center
            </Link>
            <Link to="/terms" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Terms of Service
            </Link>
            <Link to="/privacy" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Privacy Policy
            </Link>
            <Link to="/about" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              About Us
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ContactPage
