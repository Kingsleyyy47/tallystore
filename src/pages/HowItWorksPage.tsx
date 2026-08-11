import { Link } from 'react-router-dom'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { BackToHome } from '@/components/ui/back-button'
import {
  Search,
  ShoppingCart,
  Wallet,
  KeyRound,
  CreditCard,
  Landmark,
  RefreshCw,
  CheckCircle2,
  Gift,
  Link2,
  Users,
  Banknote,
  ShieldCheck,
  Tag,
  Sparkles,
} from 'lucide-react'

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />

      <div className="container mx-auto px-4 sm:px-6 pt-24 pb-16 max-w-5xl">
        <div className="mb-6">
          <BackToHome />
        </div>

        {/* Hero */}
        <div className="text-center mb-16">
          <Badge variant="outline" className="mb-4">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Guide
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-display font-bold mb-4">
            How TallyStore Works
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need to know about buying accounts, funding your wallet,
            earning through referrals, and getting help if something's unclear.
          </p>
        </div>

        {/* ===================== HOW TO PURCHASE ===================== */}
        <section className="mb-20">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600">
              <ShoppingCart className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold">How to Purchase</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Search,
                title: '1. Browse',
                desc: 'Pick a category (Instagram, TikTok, Twitter, Facebook, and more) and find a product that fits what you need.',
                color: 'from-blue-500 to-blue-600',
              },
              {
                icon: Wallet,
                title: '2. Fund Your Wallet',
                desc: 'Top up your wallet balance first — every purchase on TallyStore is paid for from your wallet, not card-by-card.',
                color: 'from-purple-500 to-purple-600',
              },
              {
                icon: CheckCircle2,
                title: '3. Checkout',
                desc: 'Choose your quantity, review the price (bulk discounts apply automatically), enter a discount code if you have one, and confirm.',
                color: 'from-green-500 to-green-600',
              },
              {
                icon: KeyRound,
                title: '4. Get Instant Access',
                desc: 'Your account login details are delivered immediately to your Orders page — no waiting, no manual handoff.',
                color: 'from-orange-500 to-orange-600',
              },
            ].map((step) => {
              const Icon = step.icon
              return (
                <Card key={step.title} className="border-border/50 hover:border-primary/40 transition-colors">
                  <CardContent className="p-6 text-center">
                    <div className={`w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-r ${step.color} flex items-center justify-center`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="font-semibold mb-2">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">{step.desc}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <Card className="mt-6 bg-muted/40 border-border/50">
            <CardContent className="p-5 flex items-start gap-3">
              <Tag className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                Buying more than one account at once often unlocks an automatic quantity discount —
                look for the "Buy more, save more" hint on a product page. Store-wide or product-specific
                discount codes can also be entered at checkout.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* ===================== HOW TO DEPOSIT ===================== */}
        <section className="mb-20">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600">
              <Wallet className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold">How to Deposit</h2>
          </div>

          <p className="text-muted-foreground mb-6">
            You can fund your wallet using either of two payment gateways. They work differently,
            so pick whichever fits how you like to pay:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <CreditCard className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <CardTitle>Ercas Pay</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Enter the amount you want to top up, then you're redirected to a secure checkout
                  where you can pay by card, bank transfer, or USSD.
                </p>
                <p>
                  <span className="font-medium text-foreground">Heads up:</span> because Ercas Pay
                  generates a fresh checkout session every time, the bank account number you're
                  asked to pay into can be different on each top-up. That's normal — always pay into
                  whichever account number is shown on the checkout screen in front of you at that
                  moment, not one you remember from last time.
                </p>
                <p>Funds land in your wallet automatically once the payment confirms.</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <Landmark className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <CardTitle>PocketFi</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  PocketFi gives you <span className="font-medium text-foreground">one permanent virtual
                  bank account</span> tied to your TallyStore account — it's generated once and stays
                  the same every time.
                </p>
                <p>
                  Save that account number. Whenever you want to top up, just transfer to it directly
                  from your bank app — no need to open TallyStore first or generate a new checkout.
                  Your wallet is credited automatically as soon as the transfer lands.
                </p>
                <p>This is the easier option if you don't want to look up a new account number every time.</p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6 bg-muted/40 border-border/50">
            <CardContent className="p-5 flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                Both gateways are connected directly to your account, and both credit your wallet
                automatically — you never need to message support to confirm a deposit went through.
                If a deposit doesn't reflect after a few minutes, check Wallet → Transaction History
                before reaching out.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* ===================== HOW TO REFER ===================== */}
        <section className="mb-20">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600">
              <Gift className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold">How to Refer</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-border/50">
              <CardContent className="p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 flex items-center justify-center">
                  <Link2 className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold mb-2">1. Get Your Link</h3>
                <p className="text-sm text-muted-foreground">
                  Every account has a unique referral code and link on the Referrals page. Copy it
                  and share it however you like — DMs, group chats, your own posts.
                </p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 flex items-center justify-center">
                  <Users className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold mb-2">2. They Sign Up</h3>
                <p className="text-sm text-muted-foreground">
                  Anyone who registers through your link (or types your code in at signup) is linked
                  to you as your referral, permanently.
                </p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 flex items-center justify-center">
                  <Banknote className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold mb-2">3. You Earn</h3>
                <p className="text-sm text-muted-foreground">
                  Every time they make a purchase, a percentage is credited to your referral balance.
                  Withdraw it whenever you like from the Referrals page.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 text-center">
            <Link to="/referrals">
              <Button>
                <Gift className="h-4 w-4 mr-2" />
                Go to Your Referrals Page
              </Button>
            </Link>
          </div>
        </section>

        {/* ===================== FAQ ===================== */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2.5 rounded-xl bg-gradient-to-r from-slate-500 to-slate-600">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold">Frequently Asked Questions</h2>
          </div>

          <Card className="border-border/50">
            <CardContent className="p-6">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="q1">
                  <AccordionTrigger>How fast do I get my account after buying?</AccordionTrigger>
                  <AccordionContent>
                    Instantly. As soon as your payment is confirmed, the login details are released
                    to your Orders page — there's no manual approval step.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="q2">
                  <AccordionTrigger>Why does Ercas Pay show me a different account number each time?</AccordionTrigger>
                  <AccordionContent>
                    Ercas Pay creates a brand-new secure checkout session for every top-up, and the
                    bank account tied to that session can change. Always use the number shown on the
                    screen at the time of payment — it's still your money landing in your wallet, just
                    routed through a fresh session each time.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="q3">
                  <AccordionTrigger>What's the difference between Ercas Pay and PocketFi?</AccordionTrigger>
                  <AccordionContent>
                    Ercas Pay is a one-time checkout (card, bank transfer, or USSD) that you go
                    through each time you top up. PocketFi gives you one fixed account number you can
                    save and transfer to anytime, without going through checkout again.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="q4">
                  <AccordionTrigger>My deposit hasn't shown up yet — what do I do?</AccordionTrigger>
                  <AccordionContent>
                    Give it a few minutes — both gateways credit automatically. Check Wallet →
                    Transaction History first. If it still hasn't appeared after that, contact
                    Support with your payment reference.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="q5">
                  <AccordionTrigger>How do quantity discounts and discount codes work together?</AccordionTrigger>
                  <AccordionContent>
                    Quantity discounts apply automatically based on how many you're buying. A
                    discount code, if you enter one at checkout, is applied on top of that. Both are
                    validated and calculated securely when your order is processed.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="q6">
                  <AccordionTrigger>Is there a limit to how much I can earn from referrals?</AccordionTrigger>
                  <AccordionContent>
                    No cap — every qualifying purchase from everyone you've referred earns you a
                    commission, for as long as they keep buying.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="q7">
                  <AccordionTrigger>Are the accounts I buy safe and verified?</AccordionTrigger>
                  <AccordionContent>
                    Every account listed goes through a verification step before it's made available
                    for purchase, and stock levels are shown honestly — including when something is
                    running low.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Still have a question?{' '}
            <Link to="/support" className="text-primary hover:underline font-medium">
              Reach out to Support
            </Link>
          </div>
        </section>
      </div>

      <Footer />
    </div>
  )
}
