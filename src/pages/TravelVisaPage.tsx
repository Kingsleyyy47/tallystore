import { useSupportSettings } from '@/hooks/useSupportSettings'
import {
  Plane,
  GraduationCap,
  Briefcase,
  Heart,
  Users,
  Globe,
  ShieldCheck,
  Clock,
  BadgeCheck,
  Star,
  MessageCircle,
  ArrowRight,
  MapPin,
  FileText,
  CheckCircle,
  Zap,
  DollarSign,
  HeadphonesIcon,
} from 'lucide-react'

const VISA_CATEGORIES = [
  {
    icon: Plane,
    label: 'Tourist / Holiday',
    color: 'text-sky-500',
    bg: 'bg-sky-50 dark:bg-sky-900/20',
    border: 'border-sky-200 dark:border-sky-800',
    desc: 'Visit any country for leisure, tourism, and sightseeing. Short and long-stay options.',
  },
  {
    icon: GraduationCap,
    label: 'Student Visa',
    color: 'text-violet-500',
    bg: 'bg-violet-50 dark:bg-violet-900/20',
    border: 'border-violet-200 dark:border-violet-800',
    desc: 'Study abroad at universities, colleges, language schools, or short courses worldwide.',
  },
  {
    icon: Briefcase,
    label: 'Work Visa',
    color: 'text-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    desc: 'Employment, skilled worker, seasonal work, and intra-company transfer visas.',
  },
  {
    icon: Heart,
    label: 'Family & Spouse',
    color: 'text-rose-500',
    bg: 'bg-rose-50 dark:bg-rose-900/20',
    border: 'border-rose-200 dark:border-rose-800',
    desc: 'Reunite with family abroad. Spousal, dependent, and family reunification visas.',
  },
  {
    icon: Users,
    label: 'Business Visa',
    color: 'text-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800',
    desc: 'Attend meetings, conferences, trade shows, or negotiate contracts internationally.',
  },
  {
    icon: Globe,
    label: 'Any Other Purpose',
    color: 'text-primary',
    bg: 'bg-primary/5 dark:bg-primary/10',
    border: 'border-primary/20',
    desc: 'Medical, transit, digital nomad, religious, research  -  if it exists, we handle it.',
  },
]

const TOP_DESTINATIONS = [
  { flag: '🇺🇸', name: 'United States' },
  { flag: '🇬🇧', name: 'United Kingdom' },
  { flag: '🇨🇦', name: 'Canada' },
  { flag: '🇦🇺', name: 'Australia' },
  { flag: '🇩🇪', name: 'Germany' },
  { flag: '🇳🇱', name: 'Netherlands' },
  { flag: '🇫🇷', name: 'France' },
  { flag: '🇦🇪', name: 'UAE / Dubai' },
  { flag: '🇸🇬', name: 'Singapore' },
  { flag: '🇯🇵', name: 'Japan' },
  { flag: '🇨🇳', name: 'China' },
  { flag: '🇿🇦', name: 'South Africa' },
  { flag: '🇮🇹', name: 'Italy' },
  { flag: '🇪🇸', name: 'Spain' },
  { flag: '🇵🇹', name: 'Portugal' },
  { flag: '🇨🇿', name: 'Czech Republic' },
  { flag: '🇳🇴', name: 'Norway' },
  { flag: '🇸🇪', name: 'Sweden' },
  { flag: '🇧🇷', name: 'Brazil' },
  { flag: '🇲🇾', name: 'Malaysia' },
  { flag: '🇮🇳', name: 'India' },
  { flag: '🇹🇷', name: 'Turkey' },
  { flag: '🇲🇹', name: 'Malta' },
  { flag: '+ Any Country', name: 'Worldwide' },
]

const WHY_US = [
  {
    icon: BadgeCheck,
    color: 'text-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    title: '100% Success Rate',
    desc: 'We only take on cases we can win. If we say yes, your visa is getting done.',
  },
  {
    icon: DollarSign,
    color: 'text-sky-500',
    bg: 'bg-sky-50 dark:bg-sky-900/20',
    title: 'Highly Affordable',
    desc: 'Transparent pricing, no hidden charges. You know what you pay before you start.',
  },
  {
    icon: Zap,
    color: 'text-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    title: 'Fast Processing',
    desc: 'We know the timelines. We prepare early so you never miss a travel window.',
  },
  {
    icon: FileText,
    color: 'text-violet-500',
    bg: 'bg-violet-50 dark:bg-violet-900/20',
    title: 'End-to-End Support',
    desc: 'From document prep to embassy appointment to approval  -  we handle everything.',
  },
  {
    icon: ShieldCheck,
    color: 'text-rose-500',
    bg: 'bg-rose-50 dark:bg-rose-900/20',
    title: 'Genuine & Legitimate',
    desc: 'All applications are fully authentic. No fake docs, no shortcuts  -  just results.',
  },
  {
    icon: HeadphonesIcon,
    color: 'text-primary',
    bg: 'bg-primary/5 dark:bg-primary/10',
    title: '24/7 Dedicated Help',
    desc: 'Reach us on WhatsApp or Telegram any time  -  before, during, and after your application.',
  },
]

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Tell Us Your Plans',
    desc: 'Contact us on WhatsApp or Telegram. Share the country, purpose, and travel date you have in mind.',
    icon: MessageCircle,
  },
  {
    step: '02',
    title: 'We Assess Your Case',
    desc: 'Our team reviews your profile and tells you exactly what's needed  -  quickly and honestly.',
    icon: FileText,
  },
  {
    step: '03',
    title: 'Document Preparation',
    desc: 'We guide you through every document, checklist, and form. Nothing is missed.',
    icon: CheckCircle,
  },
  {
    step: '04',
    title: 'Application & Follow-up',
    desc: 'We submit on your behalf and track the application until your visa lands in your hands.',
    icon: BadgeCheck,
  },
]

export default function TravelVisaPage() {
  const support = useSupportSettings()
  const whatsappUrl = support.whatsappUrl || ''
  const telegramUrl = support.telegramUrl || ''

  const contactMessage = encodeURIComponent('Hi! I\'m interested in getting a visa. Can you help me?')
  const whatsappLink = whatsappUrl
    ? `${whatsappUrl}${whatsappUrl.includes('?') ? '&' : '?'}text=${contactMessage}`
    : `https://wa.me/?text=${contactMessage}`
  const telegramLink = telegramUrl || 'https://t.me/'

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-sky-600 pb-24 pt-20 text-white">
        {/* decorative blobs */}
        <div className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />

        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/15 px-4 py-1.5 text-sm font-semibold backdrop-blur-sm">
            <Star className="h-4 w-4 fill-yellow-300 text-yellow-300" />
            100% Visa Success Rate  -  Guaranteed
          </div>

          <h1 className="mb-6 text-4xl font-black leading-tight sm:text-5xl md:text-6xl">
            Your Visa.
            <br />
            <span className="text-yellow-300">Any Country. Any Reason.</span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-white/85 sm:text-xl">
            Whether you're going on holiday, studying abroad, relocating for work, or visiting family  - 
            we handle your visa application start to finish. Affordable. Stress-free. Always approved.
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#25D366] px-8 py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#20bc5a] sm:w-auto"
            >
              {/* WhatsApp SVG */}
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Apply on WhatsApp
            </a>

            <a
              href={telegramLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#2AABEE] px-8 py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#1d96d4] sm:w-auto"
            >
              {/* Telegram SVG */}
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
              Apply on Telegram
            </a>
          </div>
        </div>

        {/* floating flags */}
        <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex justify-center gap-3 text-3xl opacity-30 sm:opacity-50">
          {['🇺🇸','🇬🇧','🇨🇦','🇦🇺','🇩🇪','🇫🇷','🇦🇪','🇸🇬','🇯🇵'].map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      </section>

      {/* ── VISA TYPES ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-14 text-center">
          <h2 className="mb-3 text-3xl font-black text-gray-900 dark:text-white sm:text-4xl">
            Every Type of Visa, Covered
          </h2>
          <p className="mx-auto max-w-xl text-gray-500 dark:text-gray-400">
            Whatever your reason for travelling, we've handled it before  -  and we'll handle yours.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {VISA_CATEGORIES.map(({ icon: Icon, label, color, bg, border, desc }) => (
            <div
              key={label}
              className={`rounded-2xl border p-6 transition hover:shadow-lg ${bg} ${border}`}
            >
              <div className={`mb-4 inline-flex items-center justify-center rounded-xl p-3 ${bg}`}>
                <Icon className={`h-7 w-7 ${color}`} />
              </div>
              <h3 className="mb-2 text-lg font-bold text-gray-900 dark:text-white">{label}</h3>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── WHY CHOOSE US ── */}
      <section className="bg-gray-50 dark:bg-gray-900 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <h2 className="mb-3 text-3xl font-black text-gray-900 dark:text-white sm:text-4xl">
              Why People Trust Us
            </h2>
            <p className="mx-auto max-w-xl text-gray-500 dark:text-gray-400">
              No empty promises. Just real results backed by a team that knows exactly what embassies want.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_US.map(({ icon: Icon, color, bg, title, desc }) => (
              <div key={title} className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6 shadow-sm transition hover:shadow-md">
                <div className={`mb-4 inline-flex items-center justify-center rounded-xl p-3 ${bg}`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </div>
                <h3 className="mb-2 font-bold text-gray-900 dark:text-white">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="mb-14 text-center">
          <h2 className="mb-3 text-3xl font-black text-gray-900 dark:text-white sm:text-4xl">
            How It Works
          </h2>
          <p className="text-gray-500 dark:text-gray-400">Simple steps. Zero stress.</p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map(({ step, title, desc, icon: Icon }) => (
            <div key={step} className="relative text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 dark:bg-primary/20">
                <Icon className="h-7 w-7 text-primary" />
              </div>
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-6xl font-black text-gray-100 dark:text-gray-800 select-none -z-10">
                {step}
              </div>
              <h3 className="mb-2 font-bold text-gray-900 dark:text-white">{title}</h3>
              <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── DESTINATIONS ── */}
      <section className="bg-gray-50 dark:bg-gray-900 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-black text-gray-900 dark:text-white sm:text-4xl">
              Popular Destinations
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              We cover every country in the world. Here are some of the most requested.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {TOP_DESTINATIONS.map(({ flag, name }) => (
              <div
                key={name}
                className="flex items-center gap-2 rounded-full border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 shadow-sm transition hover:border-primary hover:text-primary"
              >
                <span className="text-lg">{flag}</span>
                {name}
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-gray-400 dark:text-gray-500">
            Don't see your destination? <span className="font-semibold text-primary">Contact us</span>  -  we cover every country worldwide.
          </p>
        </div>
      </section>

      {/* ── GUARANTEE BANNER ── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-primary to-sky-500 p-10 text-center text-white shadow-xl">
          <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="mb-4 flex justify-center">
              <ShieldCheck className="h-12 w-12 text-yellow-300" />
            </div>
            <h2 className="mb-3 text-3xl font-black sm:text-4xl">100% Visa Guaranteed</h2>
            <p className="mx-auto mb-8 max-w-xl text-white/85 text-lg">
              We don't play with people's dreams. Every case we take, we see through to approval.
              No drama, no fails, no refund requests  -  just visas.
            </p>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#25D366] px-8 py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#20bc5a] sm:w-auto"
              >
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Get Started on WhatsApp
              </a>

              <a
                href={telegramLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white/20 border border-white/40 backdrop-blur-sm px-8 py-4 text-base font-bold text-white shadow-lg transition hover:bg-white/30 sm:w-auto"
              >
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                Chat on Telegram
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-gray-50 dark:bg-gray-900 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-black text-gray-900 dark:text-white">Common Questions</h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: 'Do you guarantee visa approval?',
                a: 'Yes. We have a 100% success rate. We only take cases we are confident in. If we accept your application, it will be approved.',
              },
              {
                q: 'How much does it cost?',
                a: 'Pricing depends on the country and visa type. We are competitively priced and transparent  -  no surprise fees. Contact us for a free quote.',
              },
              {
                q: 'How long does it take?',
                a: 'Processing times vary by country and embassy. We guide you on timelines upfront so you can plan your travel accordingly.',
              },
              {
                q: 'Do I need to come in person?',
                a: 'For most applications, the process is handled remotely. Some embassies require in-person biometrics  -  we will tell you in advance.',
              },
              {
                q: 'What documents do I need?',
                a: 'It depends on the visa type and country. Once you contact us, we provide a clear, personalised checklist  -  nothing more, nothing less.',
              },
              {
                q: 'Can you help with refusals or previous rejections?',
                a: 'Yes. We have successfully overturned previous refusals. Contact us with your history and we will assess your options honestly.',
              },
            ].map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 open:shadow-sm">
                <summary className="flex cursor-pointer items-center justify-between font-bold text-gray-900 dark:text-white list-none">
                  {q}
                  <ArrowRight className="h-4 w-4 shrink-0 text-primary transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="mx-auto max-w-2xl px-6 py-20 text-center">
        <MapPin className="mx-auto mb-4 h-10 w-10 text-primary" />
        <h2 className="mb-4 text-3xl font-black text-gray-900 dark:text-white sm:text-4xl">
          Ready to Travel?
        </h2>
        <p className="mb-8 text-gray-500 dark:text-gray-400">
          Send us a message now. It takes two minutes. We'll take it from there.
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#25D366] px-8 py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#20bc5a] sm:w-auto"
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            WhatsApp Us
          </a>
          <a
            href={telegramLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#2AABEE] px-8 py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#1d96d4] sm:w-auto"
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
            Telegram Us
          </a>
        </div>
      </section>
    </div>
  )
}
