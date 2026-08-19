import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Clock, HelpCircle, ShieldCheck, ReceiptText } from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import WalletBalanceWidget from '@/components/WalletBalanceWidget'
import { useSupportSettings } from '@/hooks/useSupportSettings'

// WhatsApp SVG icon
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

const faqItems = [
  {
    question: 'How quickly will I receive my account credentials?',
    answer: 'Account credentials are available in your account immediately after successful payment. Open Order History and download your credentials from the completed order.'
  },
  {
    question: 'What should I send when I need help?',
    answer: 'Send your account email, order ID, payment reference, and a clear description of the issue so support can trace it quickly.'
  },
  {
    question: 'What if my payment succeeded but wallet was not credited?',
    answer: 'Use the payment recovery option from your account first. If it still does not credit, send the payment reference and receipt to support.'
  },
  {
    question: 'Can I get a refund if I am not satisfied?',
    answer: 'Refunds are reviewed case by case for genuine account or delivery issues. Contact support within 24 hours with your order details.'
  },
  {
    question: 'How do I secure a purchased account?',
    answer: 'Download the credentials from Order History, sign in, change the password, and update any recovery information included with the account.'
  }
]

export default function SupportPage() {
  const support = useSupportSettings()
  const hasWhatsApp = Boolean(support.whatsappUrl)
  const hasTelegram = Boolean(support.telegramUrl)
  const hasAny = hasWhatsApp || hasTelegram

  const primaryUrl = support.whatsappUrl || support.telegramUrl || '#'
  const primaryLabel = hasWhatsApp ? 'Message on WhatsApp' : hasTelegram ? 'Message on Telegram' : 'Message support'
  const primaryColor = hasWhatsApp
    ? 'bg-white text-emerald-700 hover:bg-emerald-50'
    : 'bg-white text-sky-700 hover:bg-sky-50'

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />

      <div className="container mx-auto max-w-6xl px-4 pb-4 pt-24 sm:px-6">
        <WalletBalanceWidget showRefresh={true} />
      </div>

      <main className="container mx-auto max-w-6xl overflow-x-hidden px-4 pb-12 sm:px-6">
        <div className="mb-10 text-center">
          <h1 className="mb-4 text-4xl font-bold">Support Center</h1>
          <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
            {hasAny
              ? 'Reach our support team directly via the channels below.'
              : 'Browse the FAQ below or check your account for self-service options.'}
          </p>
          {hasAny && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {hasWhatsApp && (
                <a
                  href={support.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
                >
                  <WhatsAppIcon className="h-4 w-4" />
                  WhatsApp
                </a>
              )}
              {hasTelegram && (
                <a
                  href={support.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600"
                >
                  <TelegramIcon className="h-4 w-4" />
                  Telegram
                </a>
              )}
            </div>
          )}
        </div>

        {hasAny && (
          <Card className="mb-10 max-w-full overflow-hidden border-emerald-200">
            <div className="grid min-w-0 lg:grid-cols-[1.2fr_0.8fr]">
              <div className={`min-w-0 p-6 text-white sm:p-8 md:p-10 ${hasWhatsApp ? 'bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700' : 'bg-gradient-to-br from-sky-600 via-blue-600 to-indigo-700'}`}>
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 sm:mb-6 sm:h-14 sm:w-14">
                  {hasWhatsApp
                    ? <WhatsAppIcon className="h-6 w-6 sm:h-7 sm:w-7" />
                    : <TelegramIcon className="h-6 w-6 sm:h-7 sm:w-7" />}
                </div>
                <h2 className="mb-3 text-2xl font-bold leading-tight sm:text-3xl">Message support</h2>
                <p className="mb-6 max-w-xl text-sm leading-6 text-white/85 sm:mb-8 sm:text-base">
                  Relay all account, wallet, payment, and order problems to our support team so we can respond from one place.
                </p>
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Button asChild size="lg" className={`${primaryColor} w-full min-w-0 justify-center whitespace-normal text-xs sm:w-auto sm:text-sm`}>
                    <a href={primaryUrl} target="_blank" rel="noopener noreferrer">
                      {hasWhatsApp
                        ? <WhatsAppIcon className="mr-2 h-5 w-5" />
                        : <TelegramIcon className="mr-2 h-5 w-5" />}
                      {primaryLabel}
                    </a>
                  </Button>
                  {hasWhatsApp && hasTelegram && (
                    <Button asChild size="lg" variant="outline" className="w-full min-w-0 justify-center whitespace-normal border-white/40 bg-white/10 text-xs text-white hover:bg-white/20 sm:w-auto sm:text-sm">
                      <a href={support.telegramUrl} target="_blank" rel="noopener noreferrer">
                        <TelegramIcon className="mr-2 h-4 w-4" />
                        Telegram support
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              <CardContent className="min-w-0 space-y-5 p-6 sm:p-8 md:p-10">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                    <ReceiptText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold">Include useful details</h3>
                    <p className="text-sm text-muted-foreground">
                      Send your account email, order ID, payment reference, receipt, and a short issue summary.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold">Response window</h3>
                    <p className="text-sm text-muted-foreground">
                      We prioritize wallet, payment, and completed-order access issues first.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold">Account safety</h3>
                    <p className="text-sm text-muted-foreground">
                      Never share your TallyStore password. Support will only ask for order and payment details.
                    </p>
                  </div>
                </div>
              </CardContent>
            </div>
          </Card>
        )}

        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Before messaging</CardTitle>
              <CardDescription>These account actions solve the most common support requests.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <Alert>
                <AlertDescription>
                  If a payment was successful but delayed, run payment recovery from your account before contacting support.
                </AlertDescription>
              </Alert>
              <p>For purchased accounts, go to Order History and use Download Credentials on the completed order.</p>
              <p>For failed purchases, include the product, order ID if available, and a screenshot of the error.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                Frequently Asked Questions
              </CardTitle>
              <CardDescription>Quick answers to common questions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {faqItems.map((item) => (
                <div key={item.question} className="border-l-2 border-primary/20 pl-4">
                  <h4 className="mb-2 text-sm font-semibold">{item.question}</h4>
                  <p className="text-sm text-muted-foreground">{item.answer}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  )
}
