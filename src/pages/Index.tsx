import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  CreditCard,
  Facebook,
  Headphones,
  Home,
  Instagram,
  Menu,
  KeyRound,
  LayoutGrid,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smile,
  Sparkles,
  Star,
  User,
  Wallet,
  Zap,
} from "lucide-react"
import NavbarAuth from "@/components/NavbarAuth"
import Footer from "@/components/Footer"
import { ThemeToggle } from "@/components/ThemeToggle"
import HomepageLiveActivity from "@/components/HomepageLiveActivity"
import { useAuth } from "@/contexts/SimpleAuth"
import { getCategoryStyle } from "@/lib/categoryStyles"
import {
  formatCount,
  getAdminSalesStats,
  getAllProductGroups,
  getCategories,
  getUserCount,
  type Category,
  type ProductGroup,
} from "@/lib/supabase"

type HomepageStat = {
  label: string
  value: string
  icon: typeof PackageCheck
}

const FALLBACK_CATEGORIES = [
  {
    id: "facebook",
    name: "Facebook Accounts",
    description: "Verified accounts ready for use",
    icon: Facebook,
    image: "/category-icons/facebook.jpg",
    href: "/products",
    bg: "bg-blue-600",
    color: "text-white",
  },
  {
    id: "instagram",
    name: "Instagram Accounts",
    description: "Authentic profiles with real history",
    icon: Instagram,
    href: "/products",
    bg: "bg-gradient-to-br from-pink-500 via-fuchsia-500 to-violet-600",
    color: "text-white",
  },
  {
    id: "snapchat",
    name: "Snapchat Accounts",
    description: "Active accounts with clean reputation",
    icon: MessageCircle,
    image: "/category-icons/snapchat.jpg",
    href: "/products",
    bg: "bg-yellow-300",
    color: "text-black",
  },
  {
    id: "tiktok",
    name: "TikTok Accounts",
    description: "Optimized for content creation",
    icon: Sparkles,
    image: "/category-icons/tiktok.jpg",
    href: "/products",
    bg: "bg-black",
    color: "text-white",
  },
  {
    id: "vpn",
    name: "VPN Services",
    description: "Secure and fast connections",
    icon: ShieldCheck,
    href: "/web-services",
    bg: "bg-violet-700",
    color: "text-white",
  },
]

const CATEGORY_IMAGE_BY_KEY = [
  { key: "facebook", image: "/category-icons/facebook.jpg" },
  { key: "snapchat", image: "/category-icons/snapchat.jpg" },
  { key: "tiktok", image: "/category-icons/tiktok.jpg" },
  { key: "tik tok", image: "/category-icons/tiktok.jpg" },
  { key: "discord", image: "/category-icons/discord.jpg" },
]

const whyCards = [
  { title: "Instant Delivery", body: "Get your accounts within minutes of purchase", icon: Zap },
  { title: "Secure & Safe", body: "All transactions are protected and encrypted", icon: ShieldCheck },
  { title: "24/7 Availability", body: "Shop anytime, accounts delivered instantly", icon: Clock3 },
  { title: "Expert Support", body: "Professional customer service when you need it", icon: Headphones },
]

const trustPills = [
  { title: "Wallet checkout", body: "Pay from balance without leaving the store", icon: Wallet },
  { title: "Protected delivery", body: "Orders stay traceable from payment to login", icon: KeyRound },
  { title: "Fast support", body: "Support is close when an order needs attention", icon: Headphones },
]

const promiseCards = [
  { title: "Secure payments", body: "Wallet, crypto, and direct checkout stay connected to your account.", icon: CreditCard },
  { title: "Real availability", body: "Categories are loaded from live product groups where stock exists.", icon: PackageCheck },
  { title: "Customer first", body: "Mobile navigation, order history, and wallet access stay one tap away.", icon: Star },
]

const steps = [
  {
    label: "Step 1: Explore",
    title: "Explore",
    body: "Dive into our store and discover a world of unique products.",
    icon: Search,
    tone: "from-blue-400 to-blue-700",
  },
  {
    label: "Step 2: Connect",
    title: "Connect",
    body: "Communicate directly with us to ask questions or discuss customization.",
    icon: MessageCircle,
    tone: "from-emerald-400 to-green-700",
  },
  {
    label: "Step 3: Secure Checkout",
    title: "Secure Checkout",
    body: "Proceed to our secure checkout. Your payment is protected.",
    icon: ShieldCheck,
    tone: "from-violet-400 to-purple-700",
  },
  {
    label: "Step 4: Enjoy",
    title: "Enjoy",
    body: "Sit back and relax as you receive your account logins instantly.",
    icon: Smile,
    tone: "from-orange-400 to-orange-700",
  },
]

function buildCategoryCards(categories: Category[], productGroups: ProductGroup[]) {
  if (categories.length === 0) return FALLBACK_CATEGORIES

  const stockByCategory = productGroups.reduce<Record<string, number>>((acc, group) => {
    acc[group.category_id] = (acc[group.category_id] || 0) + Number(group.stock_count || 0)
    return acc
  }, {})

  return [...categories]
    .sort((a, b) => (stockByCategory[b.id] || 0) - (stockByCategory[a.id] || 0) || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((category) => {
      const style = getCategoryStyle(category.name)
      const normalizedName = category.name.toLowerCase()
      const matchedImage = CATEGORY_IMAGE_BY_KEY.find((item) => normalizedName.includes(item.key))?.image
      return {
        id: category.id,
        name: category.name,
        description: category.description || `${formatCount(stockByCategory[category.id] || 0)} accounts available`,
        icon: style.icon,
        image: matchedImage,
        href: `/category/${category.id}`,
        bg: style.bg,
        color: style.color,
      }
    })
}

const Index = () => {
  const [categories, setCategories] = useState<Category[]>([])
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { user, signOut } = useAuth()
  const [stats, setStats] = useState<HomepageStat[]>([
    { label: "Happy Customers", value: "10K+", icon: PackageCheck },
    { label: "Accounts Delivered", value: "50K+", icon: ShoppingBag },
    { label: "Success Rate", value: "99.9%", icon: ShieldCheck },
    { label: "Support Available", value: "24/7", icon: Headphones },
  ])

  useEffect(() => {
    let mounted = true

    async function loadHomepageData() {
      try {
        const [categoryData, productData, userCount, salesStats] = await Promise.all([
          getCategories(),
          getAllProductGroups(),
          getUserCount(),
          getAdminSalesStats(),
        ])

        if (!mounted) return

        setCategories(categoryData)
        setProductGroups(productData)
        setStats([
          { label: "Happy Customers", value: formatCount(Math.max(userCount, 10000)), icon: PackageCheck },
          { label: "Accounts Delivered", value: formatCount(Math.max(salesStats.totalSales, 50000)), icon: ShoppingBag },
          { label: "Success Rate", value: "99.9%", icon: ShieldCheck },
          { label: "Support Available", value: "24/7", icon: Headphones },
        ])
      } catch (error) {
        console.error("Failed to load homepage data:", error)
      }
    }

    loadHomepageData()
    return () => {
      mounted = false
    }
  }, [])

  const categoryCards = useMemo(() => buildCategoryCards(categories, productGroups), [categories, productGroups])
  const totalStock = productGroups.reduce((total, group) => total + Number(group.stock_count || 0), 0)
  const handleMobileSignOut = async () => {
    await signOut()
    setMobileMenuOpen(false)
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950 dark:bg-[#05070d] dark:text-white">
      <div className="hidden md:block">
        <NavbarAuth />
      </div>

      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/92 px-5 py-4 backdrop-blur dark:border-white/10 dark:bg-[#070a12]/92 md:hidden">
        <div className="relative flex items-center justify-between">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link to="/" className="absolute left-1/2 -translate-x-1/2 text-2xl font-black tracking-normal">
            Tally<span className="text-purple-600 dark:text-purple-400">Store</span>
          </Link>

          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
              <ThemeToggle />
            </div>
            <Link
              to={user ? "/profile" : "/login"}
              aria-label={user ? "Open profile" : "Log in or sign up"}
              className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-900 shadow-sm transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/10"
            >
              <User className="h-5 w-5" />
            </Link>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#0d111b]">
            <div className="grid gap-3 text-sm font-bold">
              {[
                { label: "Products", href: "/products" },
                { label: "Services", href: "/web-services" },
                { label: "Wallet", href: "/wallet" },
                { label: "Orders", href: "/orders" },
                { label: "Support", href: "/support" },
                { label: "How It Works", href: "/how-it-works" },
              ].map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-xl px-3 py-2 text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
              {user ? (
                <div className="grid gap-2 border-t border-slate-200 px-3 pt-3 dark:border-white/10">
                  <Link
                    to="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-xl px-3 py-2 text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    Account
                  </Link>
                  <button
                    type="button"
                    onClick={handleMobileSignOut}
                    className="rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-3 pt-3 dark:border-white/10">
                  <Link
                    to="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-950 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/10"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-purple-600 text-white hover:bg-purple-500"
                  >
                    Sign up
                  </Link>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-200 px-3 pt-3 dark:border-white/10">
                <span className="text-slate-600 dark:text-slate-400">Theme</span>
                <ThemeToggle />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="overflow-hidden bg-[radial-gradient(circle_at_68%_8%,rgba(168,85,247,0.16),transparent_32rem),radial-gradient(circle_at_15%_28%,rgba(59,130,246,0.10),transparent_26rem),linear-gradient(180deg,#ffffff_0%,#f8fafc_62%,#f6f7fb_100%)] dark:bg-[radial-gradient(circle_at_68%_8%,rgba(141,68,255,0.28),transparent_32rem),radial-gradient(circle_at_15%_28%,rgba(96,42,164,0.22),transparent_26rem),linear-gradient(180deg,#070b13_0%,#05070d_62%,#05070d_100%)]">
        <section id="home" className="relative border-b border-slate-200/80 dark:border-white/10">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-8 px-5 pb-5 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(370px,0.74fr)] lg:px-8 lg:pb-7 lg:pt-8">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-xs font-black uppercase text-purple-700 shadow-sm dark:border-purple-300/25 dark:bg-purple-500/10 dark:text-purple-100">
                <Sparkles className="h-3.5 w-3.5 text-purple-500 dark:text-purple-300" />
                Premium accounts. Instant delivery.
              </div>

              <h1 className="mt-5 max-w-3xl text-3xl font-black leading-[1.04] tracking-normal text-slate-950 dark:text-white sm:text-5xl">
                Premium Social Media Accounts
                <span className="block text-purple-600 dark:text-purple-400">Delivered Instantly.</span>
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base sm:leading-7">
                Verified, high-quality accounts across all major platforms. Fast delivery, secure payments, 24/7 support.
              </p>

              <div className="mt-5 grid grid-cols-3 gap-2 text-xs font-black text-slate-900 dark:text-white sm:flex sm:flex-wrap sm:items-center sm:gap-5 sm:text-sm">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-300 sm:h-5 sm:w-5" />100% Safe</span>
                <span className="inline-flex items-center gap-1.5"><Headphones className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-300 sm:h-5 sm:w-5" />24/7 Support</span>
                <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-300 sm:h-5 sm:w-5" />Best Prices</span>
              </div>

              <div className="mt-6 flex flex-col gap-2 sm:mt-7 sm:gap-3 sm:flex-row">
                <Link
                  to="/products"
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-violet-700 px-7 text-sm font-black text-white shadow-[0_18px_42px_rgba(126,51,231,0.35)] transition hover:translate-y-[-1px] sm:w-auto"
                >
                  Browse Products
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/how-it-works"
                  className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-slate-200 bg-white/80 px-7 text-sm font-black text-slate-950 shadow-sm transition hover:bg-white dark:border-white/15 dark:bg-white/[0.03] dark:text-white dark:hover:bg-white/[0.07] sm:w-auto"
                >
                  How It Works
                </Link>
              </div>

              <div className="mt-5 hidden max-w-2xl flex-wrap gap-2 sm:flex">
                {trustPills.map((pill) => (
                  <div key={pill.title} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-xs font-black text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-200">
                    <pill.icon className="h-4 w-4 text-purple-600 dark:text-purple-300" />
                    {pill.title}
                  </div>
                ))}
              </div>
            </div>

            <div className="relative mx-auto hidden min-h-[280px] w-full max-w-[520px] items-center justify-center lg:flex lg:justify-end">
              <div className="relative w-full max-w-[500px] overflow-hidden rounded-[1.6rem] bg-[#020713] ring-1 ring-purple-200/10 shadow-[0_30px_85px_rgba(126,51,231,0.18)] dark:shadow-[0_30px_85px_rgba(126,51,231,0.30)]">
                <div className="absolute -inset-5 bg-[radial-gradient(circle_at_50%_60%,rgba(126,51,231,0.22),transparent_58%)]" />
                <img
                  src="/homepage-wallet-hero.png"
                  alt="Premium social media account wallet with platform icons"
                  className="relative block aspect-[424/207] w-full object-cover"
                />
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-7xl px-5 pb-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white/85 shadow-[0_20px_55px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.035] dark:shadow-[0_28px_70px_rgba(0,0,0,0.25)] lg:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="flex items-center gap-3 border-b border-r border-slate-200 p-3 even:border-r-0 dark:border-white/10 lg:border-b-0 lg:p-4 lg:even:border-r lg:last:border-r-0">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300 lg:h-12 lg:w-12">
                    <stat.icon className="h-5 w-5 lg:h-6 lg:w-6" />
                  </span>
                  <span>
                    <strong className="block text-lg font-black leading-none lg:text-xl">{stat.value}</strong>
                    <small className="mt-1 block text-xs font-semibold text-slate-600 dark:text-slate-400 lg:mt-2 lg:text-sm">{stat.label}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-6 lg:px-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="text-2xl font-black tracking-normal">Popular Categories</h2>
            <Link to="/products" className="hidden text-sm font-black text-purple-700 transition hover:text-purple-500 dark:text-purple-300 dark:hover:text-purple-200 sm:inline-flex">
              View all categories <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {categoryCards.map((category) => {
              const Icon = category.icon
              return (
                <Link
                  key={category.id}
                  to={category.href}
                  className="group flex min-h-0 items-center gap-3 rounded-lg border border-slate-200 bg-white/85 p-3 shadow-sm transition hover:border-purple-300/60 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:border-purple-300/35 dark:hover:bg-white/[0.055] sm:block sm:min-h-[162px] sm:p-4 sm:hover:-translate-y-1"
                >
                  <span className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl ${category.image ? "bg-white" : category.bg} ${category.image ? "" : category.color}`}>
                    {category.image ? (
                      <img src={category.image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon className="h-7 w-7" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <h3 className="text-sm font-black text-slate-950 dark:text-white sm:mt-4">{category.name}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400 sm:mt-2 sm:min-h-10 sm:text-sm sm:leading-6">{category.description}</p>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 sm:hidden" />
                  <span className="mt-3 hidden items-center text-sm font-black text-purple-700 dark:text-purple-300 sm:inline-flex">
                    Browse <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </Link>
              )
            })}

            <Link
              to="/products"
              className="group flex min-h-0 items-center gap-3 rounded-lg border border-slate-200 bg-white/85 p-3 shadow-sm transition hover:border-purple-300/60 hover:bg-white dark:border-white/10 dark:bg-white/[0.035] dark:hover:border-purple-300/35 dark:hover:bg-white/[0.055] sm:block sm:min-h-[162px] sm:p-4 sm:hover:-translate-y-1"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white">
                <MoreHorizontal className="h-7 w-7" />
              </span>
              <span className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-slate-950 dark:text-white sm:mt-4">View All Categories</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400 sm:mt-2 sm:min-h-10 sm:text-sm sm:leading-6">
                  {totalStock > 0 ? `${formatCount(totalStock)} accounts across all categories` : "Explore all categories"}
                </p>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 sm:hidden" />
              <span className="mt-3 hidden items-center text-sm font-black text-purple-700 dark:text-purple-300 sm:inline-flex">
                Browse <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
              </span>
            </Link>
          </div>

          <div className="mt-5 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">
                <Wallet className="h-7 w-7" />
              </span>
              <div>
                <h2 className="text-xl font-black tracking-normal">No need for middle-man.</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  Get direct access to premium accounts at the best prices. Instant delivery.
                </p>
              </div>
            </div>
            <Link
              to="/products"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-purple-200 bg-purple-100 px-6 text-sm font-black text-purple-800 transition hover:bg-purple-200 dark:border-purple-300/25 dark:bg-purple-500/20 dark:text-white dark:hover:bg-purple-500/30"
            >
              Why Choose Us?
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
            <div className="text-center">
              <h2 className="text-2xl font-black tracking-normal">Why Choose TallyStore?</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Direct access to premium accounts with zero intermediaries.</p>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {whyCards.map((card) => (
                <article key={card.title} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-[#111620]/70">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-500/25 dark:text-purple-300">
                    <card.icon className="h-5 w-5" />
                  </span>
                  <span>
                    <strong className="block text-sm font-black text-slate-950 dark:text-white">{card.title}</strong>
                    <small className="mt-1 block leading-5 text-slate-600 dark:text-slate-400">{card.body}</small>
                  </span>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {promiseCards.map((card) => (
              <article key={card.title} className="rounded-lg border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">
                  <card.icon className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-base font-black text-slate-950 dark:text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-200/80 bg-[radial-gradient(circle_at_50%_45%,rgba(168,85,247,0.14),transparent_30rem),linear-gradient(180deg,#ffffff_0%,#f8fafc_52%,#ffffff_100%)] px-5 py-14 dark:border-white/10 dark:bg-[radial-gradient(circle_at_50%_45%,rgba(126,55,194,0.24),transparent_30rem),linear-gradient(180deg,#05060a_0%,#120c1d_52%,#05060a_100%)] sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-10 text-center">
              <h2 className="text-3xl font-black tracking-normal sm:text-4xl">How It Works</h2>
              <p className="mt-4 text-base text-slate-600 dark:text-slate-400">Simple steps to get your social media accounts up and running</p>
            </div>

            <div className="grid gap-5 lg:grid-cols-4">
              {steps.map((step, index) => (
                <article key={step.title} className="relative rounded-xl border border-slate-200 bg-white/85 p-6 text-center shadow-sm dark:border-purple-300/20 dark:bg-[#12141d]/80">
                  {index < steps.length - 1 && <div className="absolute right-[-1.25rem] top-16 hidden h-px w-5 bg-purple-400 lg:block" />}
                  <span className="inline-flex rounded-full bg-purple-100 px-4 py-1.5 text-sm font-black text-purple-700 dark:bg-purple-400/15 dark:text-purple-300">{step.label}</span>
                  <span className={`mx-auto mt-6 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br ${step.tone} text-white shadow-[0_18px_40px_rgba(0,0,0,0.35)]`}>
                    <step.icon className="h-8 w-8" />
                  </span>
                  <h3 className="mt-6 text-lg font-black">{step.title}</h3>
                  <p className="mx-auto mt-4 max-w-56 text-sm leading-7 text-slate-600 dark:text-slate-400">{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[radial-gradient(circle_at_50%_50%,rgba(168,85,247,0.12),transparent_32rem),linear-gradient(180deg,#f8fafc_0%,#ffffff_50%,#f6f7fb_100%)] px-5 py-12 dark:bg-[radial-gradient(circle_at_50%_50%,rgba(126,55,194,0.18),transparent_32rem),linear-gradient(180deg,#05060a_0%,#120c1d_50%,#05060a_100%)] sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl items-center gap-9 lg:grid-cols-[minmax(300px,0.78fr)_1fr]">
            <div className="relative mx-auto w-full max-w-[500px]">
              <span className="absolute -right-3 -top-4 z-10 rounded-full bg-gradient-to-r from-purple-400 to-violet-500 px-6 py-3 text-xs font-black text-white shadow-2xl">
                DIRECT ACCESS
              </span>
              <img
                src="/NO%20MIDDLE%20MAN%20NEEDED,%20GET%20ACCOUNT%20IMMEDIATELY%20AFTER%20PAYMENT.webp"
                alt="No need for middle-man, get account immediately after payment"
                className="max-h-[430px] w-full rounded-xl object-contain shadow-[0_24px_60px_rgba(15,23,42,0.16)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.42)]"
              />
            </div>

            <div>
              <h2 className="text-3xl font-black leading-tight tracking-normal sm:text-4xl">Direct access, delivered cleanly.</h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-400">
                Direct access to premium social media accounts with no intermediaries. Get what you pay for, instantly and securely.
              </p>

              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                {whyCards.map((card) => (
                  <article key={card.title} className="rounded-xl border border-slate-200 bg-white/85 p-5 text-center shadow-sm dark:border-purple-300/20 dark:bg-[#12141d]/80">
                    <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-purple-400 text-white">
                      <card.icon className="h-6 w-6" />
                    </span>
                    <h3 className="mt-5 text-base font-black">{card.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">{card.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <HomepageLiveActivity />
      </main>

      <nav className="fixed bottom-3 left-1/2 z-40 grid h-16 w-[min(390px,calc(100%-28px))] -translate-x-1/2 grid-cols-5 rounded-2xl border border-slate-200 bg-white/95 text-[11px] font-bold text-slate-600 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-[#070a12]/95 dark:text-slate-400 md:hidden">
        <Link to="/" className="grid place-items-center text-purple-600 dark:text-purple-400"><Home className="h-5 w-5" />Home</Link>
        <Link to="/products" className="grid place-items-center hover:text-slate-950 dark:hover:text-white"><LayoutGrid className="h-5 w-5" />Products</Link>
        <Link to="/wallet" className="grid place-items-center hover:text-slate-950 dark:hover:text-white"><Wallet className="h-5 w-5" />Wallet</Link>
        <Link to="/orders" className="grid place-items-center hover:text-slate-950 dark:hover:text-white"><PackageCheck className="h-5 w-5" />Orders</Link>
        <Link to="/profile" className="grid place-items-center hover:text-slate-950 dark:hover:text-white"><User className="h-5 w-5" />Account</Link>
      </nav>

      <Footer />
    </div>
  )
}

export default Index
