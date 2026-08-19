import { Link } from 'react-router-dom'
import { LifeBuoy, PackageCheck, ShieldCheck, Wallet } from 'lucide-react'

const shopLinks = [
  ['All Products', '/products'],
  ['Instagram Accounts', '/category/instagram'],
  ['TikTok Accounts', '/category/tiktok'],
  ['Facebook Accounts', '/category/facebook'],
  ['SMS Numbers', '/sms-numbers'],
]

const accountLinks = [
  ['Sign In', '/login'],
  ['Create Account', '/register'],
  ['Wallet Home', '/dashboard'],
  ['Wallet', '/wallet'],
  ['Order History', '/orders'],
]

const supportLinks = [
  ['Help Center', '/support'],
  ['Contact', '/contact'],
  ['How It Works', '/how-it-works'],
  ['Terms', '/terms'],
  ['Privacy', '/privacy'],
]

function FooterLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="text-sm text-slate-600 transition hover:text-purple-700 dark:text-slate-400 dark:hover:text-purple-300">
      {children}
    </Link>
  )
}

const Footer = () => {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white/80 text-slate-600 dark:border-white/10 dark:bg-[#080b13]/90 dark:text-slate-300">
      <div className="mx-auto max-w-7xl px-4 pb-28 pt-8 sm:px-6 md:pb-10 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
          <div>
            <Link to="/" className="text-2xl font-black tracking-normal text-slate-950 dark:text-white">
              Tally<span className="text-purple-600 dark:text-purple-300">Store</span>
            </Link>
            <p className="mt-4 max-w-md text-sm leading-6">
              Premium social accounts, SMS numbers, wallet funding, and support tools in one customer account.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:max-w-lg">
              {[
                [ShieldCheck, 'Secure'],
                [PackageCheck, 'Instant'],
                [Wallet, 'Wallet-first'],
              ].map(([Icon, label]) => {
                const FooterIcon = Icon as typeof ShieldCheck
                return (
                  <div key={label as string} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black dark:border-white/10 dark:bg-white/[0.035]">
                    <FooterIcon className="h-4 w-4 text-purple-600 dark:text-purple-300" />
                    {label as string}
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-black uppercase text-slate-950 dark:text-white">Shop</h4>
            <ul className="grid gap-2">
              {shopLinks.map(([label, href]) => (
                <li key={href}><FooterLink to={href}>{label}</FooterLink></li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-black uppercase text-slate-950 dark:text-white">Account</h4>
            <ul className="grid gap-2">
              {accountLinks.map(([label, href]) => (
                <li key={href}><FooterLink to={href}>{label}</FooterLink></li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-black uppercase text-slate-950 dark:text-white">Support</h4>
            <ul className="grid gap-2">
              {supportLinks.map(([label, href]) => (
                <li key={href}><FooterLink to={href}>{label}</FooterLink></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-slate-200 pt-6 text-xs dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2024 Tallybest Store LTD. All rights reserved.</p>
          <Link to="/support" className="inline-flex items-center gap-2 font-black text-purple-700 dark:text-purple-300">
            <LifeBuoy className="h-4 w-4" />
            Need help?
          </Link>
        </div>
      </div>
    </footer>
  )
}

export default Footer
