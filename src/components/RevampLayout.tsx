import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck, Sparkles, WalletCards } from 'lucide-react'
import { cn } from '@/lib/utils'

type IconType = ComponentType<{ className?: string }>

export function RevampPage({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <main className={cn('mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8', className)}>
      {children}
    </main>
  )
}

export function RevampHero({
  eyebrow,
  title,
  accent,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  children,
}: {
  eyebrow?: string
  title: string
  accent?: string
  description: string
  primaryHref?: string
  primaryLabel?: string
  secondaryHref?: string
  secondaryLabel?: string
  children?: ReactNode
}) {
  return (
    <section className="grid items-center gap-6 rounded-2xl border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035] sm:p-7 lg:grid-cols-[1.05fr_0.95fr] lg:p-8">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-4 inline-flex max-w-full items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-normal text-purple-700 dark:border-purple-400/20 dark:bg-purple-400/10 dark:text-purple-200">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{eyebrow}</span>
          </div>
        )}
        <h1 className="max-w-3xl text-3xl font-black leading-[1.05] tracking-normal text-slate-950 dark:text-white sm:text-5xl">
          {title}
          {accent && <span className="block text-purple-600 dark:text-purple-300">{accent}</span>}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
          {description}
        </p>
        {(primaryHref || secondaryHref) && (
          <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
            {primaryHref && primaryLabel && (
              <Link
                to={primaryHref}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-violet-700 px-5 text-sm font-black text-white shadow-lg shadow-purple-500/20 transition hover:from-purple-400 hover:to-violet-600"
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            {secondaryHref && secondaryLabel && (
              <Link
                to={secondaryHref}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white/80 px-5 text-sm font-black text-slate-900 transition hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:text-white dark:hover:bg-white/[0.07]"
              >
                {secondaryLabel}
              </Link>
            )}
          </div>
        )}
      </div>
      {children ?? <RevampVisual />}
    </section>
  )
}

export function RevampVisual({
  title = 'TallyStore',
  subtitle = 'Instant access, secure wallet, clean delivery.',
  icon: Icon = WalletCards,
}: {
  title?: string
  subtitle?: string
  icon?: IconType
}) {
  return (
    <div className="relative min-h-[220px] overflow-hidden rounded-2xl border border-purple-200 bg-[radial-gradient(circle_at_20%_10%,rgba(168,85,247,.26),transparent_38%),linear-gradient(135deg,#0b1020,#24113f_55%,#4c1d95)] p-5 text-white shadow-xl shadow-purple-500/10 dark:border-white/10">
      <div className="absolute inset-x-10 top-8 h-24 rounded-full bg-purple-400/25 blur-3xl" />
      <div className="relative z-10 flex h-full min-h-[180px] flex-col justify-between">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verified access
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black">24/7</span>
        </div>
        <div className="mx-auto grid h-28 w-36 place-items-center rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-purple-400 to-violet-800 shadow-2xl shadow-purple-900/40">
          <Icon className="h-14 w-14 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-black">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-white/75">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

export function RevampSectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string
  title: string
  description?: string
}) {
  return (
    <div className="mb-5 flex flex-col gap-1 sm:mb-6">
      {eyebrow && <span className="text-xs font-black uppercase text-purple-600 dark:text-purple-300">{eyebrow}</span>}
      <h2 className="text-2xl font-black tracking-normal text-slate-950 dark:text-white sm:text-3xl">{title}</h2>
      {description && <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>}
    </div>
  )
}

export function RevampCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]', className)}>
      {children}
    </div>
  )
}

export function RevampFeature({
  icon: Icon,
  title,
  description,
  tone = 'purple',
}: {
  icon: IconType
  title: string
  description: string
  tone?: 'purple' | 'emerald' | 'sky' | 'amber' | 'rose'
}) {
  const tones = {
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  }

  return (
    <RevampCard className="min-w-0">
      <div className={cn('mb-4 grid h-11 w-11 place-items-center rounded-xl', tones[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-base font-black text-slate-950 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
    </RevampCard>
  )
}
