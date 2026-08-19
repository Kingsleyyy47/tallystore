import { useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ThemeToggle"
import {
  Bitcoin,
  CreditCard,
  Download,
  Gift,
  Home,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Map,
  Menu,
  PackageCheck,
  PhoneCall,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  User,
  Wallet,
  X,
} from "lucide-react"
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/SimpleAuth'
import { useCurrency } from '@/contexts/CurrencyContext'
import InstallAppDialog from '@/components/InstallAppDialog'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { useToast } from '@/hooks/use-toast'

const ANNOUNCEMENT_STORAGE_KEY = 'announcement-banner-dismissed';

const desktopNavClass = ({ isActive }: { isActive: boolean }) =>
  [
    "relative py-2 text-sm font-medium transition-colors",
    "text-gray-700 hover:text-primary dark:text-gray-300 dark:hover:text-primary",
    "after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:w-full after:origin-left after:rounded-full after:bg-primary after:transition-transform after:duration-200",
    isActive ? "text-primary after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100",
  ].join(" ")

const mobileMenuLinkClass =
  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-700 transition-colors hover:bg-primary/10 hover:text-primary dark:text-gray-200 dark:hover:bg-white/5"

const mobileMenuButtonClass =
  "h-auto w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-bold"

const desktopDropdownItemClass =
  "flex items-center gap-2 px-4 py-2 text-sm font-semibold transition hover:bg-gray-100 dark:hover:bg-gray-700"

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showInstallDialog, setShowInstallDialog] = useState(false)
  const [announcementVisible, setAnnouncementVisible] = useState(true)
  const { user, signOut, isAdmin, isStaff, walletBalance, walletLoading, showBalances } = useAuth()
  const { currency, toggleCurrency, formatPrice } = useCurrency()
  const { canInstall, isInstalled, isAndroid, isIOS, installApp } = usePWAInstall()
  const { toast } = useToast()
  const navigate = useNavigate()

  // Check if announcement banner is visible
  useEffect(() => {
    const checkAnnouncementState = () => {
      const dismissed = localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY) === 'true';
      setAnnouncementVisible(!dismissed);
    };
    
    // Check initially
    checkAnnouncementState();
    
    // Listen for storage changes (when banner is dismissed)
    window.addEventListener('storage', checkAnnouncementState);
    
    // Also check periodically in case dismissed on same tab
    const interval = setInterval(checkAnnouncementState, 500);
    
    return () => {
      window.removeEventListener('storage', checkAnnouncementState);
      clearInterval(interval);
    };
  }, []);

  // Mock data for display - now using actual user data from context
  const mockProfile = {
    username: user?.email?.split('@')[0] || 'User',
    wallet_balance: walletBalance, // Now using real wallet balance
  }

  const handleScroll = useCallback(() => {
    setIsScrolled(window.scrollY > 50)
  }, [])

  useEffect(() => {
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId)
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
      setIsMobileMenuOpen(false)
    }
  }

  const handleSignOut = async () => {
    signOut()
    setIsMobileMenuOpen(false)
  }

  const handleDownloadClick = async () => {
    // Android: Auto-install immediately
    if (isAndroid || canInstall) {
      const success = await installApp()
      if (success) {
        toast({
          title: "App Installing! 📱",
          description: "TallyStore is being added to your home screen.",
        })
      } else {
        toast({
          variant: "destructive",
          title: "Installation Cancelled",
          description: "You can install the app anytime from the menu.",
        })
      }
    } else if (isIOS) {
      // iOS: Show instructions dialog
      setShowInstallDialog(true)
    } else {
      // Fallback: Show dialog
      setShowInstallDialog(true)
    }
  }

  return (
    <>
      {/* Spacer to push content below fixed navbar + announcement banner */}
      <div className={`${announcementVisible ? 'h-[72px] md:h-[calc(32px+72px)]' : 'h-[72px]'}`} />
      
      <nav 
        className={`fixed ${announcementVisible ? 'top-0 md:top-8' : 'top-0'} left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled 
            ? "bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-lg border-b border-gray-200/50 dark:border-gray-700/50" 
            : "bg-transparent"
        }`}
      >
      <div className="container mx-auto px-2 py-3 sm:px-4 md:px-6 md:py-4">
        <div className="relative flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="group hidden md:block">
            <span className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent group-hover:from-primary/80 group-hover:to-primary transition-all">
              TallyStore
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <NavLink to="/" end className={desktopNavClass}>
              Home
            </NavLink>
            <NavLink to="/products" className={desktopNavClass}>
              Products
            </NavLink>
            <NavLink to="/web-services" className={desktopNavClass}>
              Services
            </NavLink>
            <NavLink to="/support" className={desktopNavClass}>
              Support
            </NavLink>
            <NavLink to="/how-it-works" className={desktopNavClass}>
              How It Works
            </NavLink>

            {/* Auth Buttons */}
            {user ? (
              <div className="flex items-center space-x-4">
                {/* User Dropdown Menu */}
                <div className="relative group">
                  <Button variant="ghost" className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {mockProfile.username}
                    <svg className="h-4 w-4 transition-transform group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </Button>
                  
                  {/* Dropdown Menu */}
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-200 bg-white shadow-lg opacity-0 invisible transition-all duration-200 group-hover:visible group-hover:opacity-100 dark:border-gray-700 dark:bg-gray-800 z-50">
                    <div className="py-2">
                      {isAdmin ? (
                        <>
                          <Link to="/admin" className={desktopDropdownItemClass}>
                            <ShieldCheck className="h-4 w-4" />
                            Admin Workspace
                          </Link>
                          <Link to="/dashboard" className={desktopDropdownItemClass}>
                            <LayoutDashboard className="h-4 w-4" />
                            Account Hub
                          </Link>
                        </>
                      ) : isStaff ? (
                        <>
                          <Link to="/staff-admin" className={`${desktopDropdownItemClass} text-primary`}>
                            <ShieldCheck className="h-4 w-4" />
                            Staff Workspace
                          </Link>
                          <Link to="/dashboard" className={desktopDropdownItemClass}>
                            <LayoutDashboard className="h-4 w-4" />
                            Account Hub
                          </Link>
                        </>
                      ) : (
                        <Link to="/dashboard" className={desktopDropdownItemClass}>
                          <LayoutDashboard className="h-4 w-4" />
                          Account Hub
                        </Link>
                      )}
                      <Link to="/profile" className={desktopDropdownItemClass}>
                        <User className="h-4 w-4" />
                        Profile Settings
                      </Link>
                      <Link to="/orders" className={desktopDropdownItemClass}>
                        <PackageCheck className="h-4 w-4" />
                        Order History
                      </Link>
                      {!isAdmin && (
                        <Link to="/wallet" className={desktopDropdownItemClass}>
                          <Wallet className="h-4 w-4" />
                          Wallet
                        </Link>
                      )}
                      {!isAdmin && (
                        <Link to="/referrals" className={desktopDropdownItemClass}>
                          <Gift className="h-4 w-4" />
                          Rewards
                        </Link>
                      )}
                      <Link to="/crypto-exchange" className={desktopDropdownItemClass}>
                        <Bitcoin className="h-4 w-4" />
                        Crypto Exchange
                      </Link>
                      <Link to="/bills" className={desktopDropdownItemClass}>
                        <CreditCard className="h-4 w-4" />
                        Bills & Airtime
                      </Link>
                      <Link to="/gift-cards" className={desktopDropdownItemClass}>
                        <Smartphone className="h-4 w-4" />
                        Gift Cards & eSIMs
                      </Link>
                      <Link to="/sms-numbers" className={desktopDropdownItemClass}>
                        <PhoneCall className="h-4 w-4" />
                        SMS Numbers
                      </Link>
                      <Link to="/social-boost" className={`${desktopDropdownItemClass} text-pink-600 dark:text-pink-400`}>
                        <Rocket className="h-4 w-4" />
                        Social Boost
                      </Link>
                      
                      {/* Install app in dropdown */}
                      {!isInstalled && (canInstall || true) && (
                        <>
                          <div className="border-t border-gray-200 dark:border-gray-600 my-2"></div>
                          <button 
                            onClick={handleDownloadClick} 
                            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-primary flex items-center gap-2"
                          >
                            <Download className="h-4 w-4" />
                            Install App
                          </button>
                        </>
                      )}
                      
                      <div className="border-t border-gray-200 dark:border-gray-600 my-2"></div>
                      <button onClick={handleSignOut} className={`${desktopDropdownItemClass} w-full text-left text-red-600`}>
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                </div>
                
                {!isAdmin && (
                  <Link to="/wallet" className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-primary transition-colors">
                    <Wallet className="h-4 w-4" />
                    {walletLoading ? (
                      <span className="inline-block h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    ) : (
                      <>{showBalances ? formatPrice(mockProfile.wallet_balance || 0) : '***'}</>
                    )}
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                {/* Install app button for non-logged-in users */}
                {!isInstalled && (canInstall || true) && (
                  <Button 
                    variant="outline"
                    onClick={handleDownloadClick}
                    className="border-primary/50 text-primary hover:bg-primary/10"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Install App
                  </Button>
                )}
                
                <Link to="/login">
                  <Button variant="ghost">Sign In</Button>
                </Link>
                <Link to="/register">
                  <Button variant="hero">Get Started</Button>
                </Link>
              </div>
            )}

            <button
              type="button"
              onClick={toggleCurrency}
              title={currency === 'NGN' ? 'Switch to USD' : 'Switch to NGN'}
              className="h-9 px-2.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {currency === 'NGN' ? '₦ NGN' : '$ USD'}
            </button>

            <ThemeToggle />
          </div>

          {/* Mobile Menu Button */}
          <div className="relative flex h-10 w-full items-center justify-center md:hidden">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
              className="absolute left-0 grid h-9 w-9 place-items-center rounded-full border border-gray-200 bg-white/80 text-gray-800 shadow-sm transition hover:bg-gray-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/10"
            >
              {isMobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>

            <Link to="/" className="max-w-[calc(100%-172px)] truncate text-center text-lg font-black tracking-normal text-gray-950 dark:text-white min-[360px]:text-xl">
              Tally<span className="text-primary">Store</span>
            </Link>

            <div className="absolute right-0 flex h-9 items-center justify-end gap-1">
              <button
                type="button"
                onClick={toggleCurrency}
                aria-label={currency === 'NGN' ? 'Switch to USD' : 'Switch to NGN'}
                title={currency === 'NGN' ? 'Switch to USD' : 'Switch to NGN'}
                className="grid h-9 w-9 place-items-center rounded-full border border-gray-200 bg-white/80 text-[11px] font-black text-gray-800 shadow-sm transition hover:bg-gray-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/10"
              >
                {currency === 'NGN' ? '₦' : '$'}
              </button>
              <ThemeToggle className="h-9 w-9 border-gray-200 bg-white/80 shadow-sm hover:scale-100 hover:bg-gray-100 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/10" />
              <Link
                to={user ? "/profile" : "/login"}
                aria-label={user ? "Open profile" : "Log in or sign up"}
                className="grid h-9 w-9 place-items-center rounded-full border border-gray-200 bg-white/80 text-gray-800 shadow-sm transition hover:bg-gray-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/10"
              >
                <User className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 mobile-menu-bg backdrop-blur-md rounded-lg border border-gray-200/50 dark:border-gray-700/50 p-4">
            <div className="flex flex-col space-y-2">
              <Link 
                to="/" 
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileMenuLinkClass}
              >
                <Home className="h-4 w-4 shrink-0" />
                Home
              </Link>
              <Link 
                to="/products" 
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileMenuLinkClass}
              >
                <ShoppingBag className="h-4 w-4 shrink-0" />
                Shop Products
              </Link>
              <Link 
                to="/web-services" 
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileMenuLinkClass}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                Digital Services
              </Link>
              <Link 
                to="/support" 
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileMenuLinkClass}
              >
                <LifeBuoy className="h-4 w-4 shrink-0" />
                Help Center
              </Link>
              <Link
                to="/how-it-works"
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileMenuLinkClass}
              >
                <Map className="h-4 w-4 shrink-0" />
                How It Works
              </Link>

              <div className="mt-2 border-t border-gray-200 pt-3 dark:border-gray-700">
                {user ? (
                  <div className="space-y-2">
                    {isAdmin ? (
                      <>
                        <Link to="/admin" onClick={() => setIsMobileMenuOpen(false)}>
                          <Button variant="ghost" className={mobileMenuButtonClass}>
                            <ShieldCheck className="h-4 w-4 shrink-0" />
                            Admin Workspace
                          </Button>
                        </Link>
                        <Link to="/dashboard" onClick={() => setIsMobileMenuOpen(false)}>
                          <Button variant="ghost" className={mobileMenuButtonClass}>
                            <LayoutDashboard className="h-4 w-4 shrink-0" />
                            Account Hub
                          </Button>
                        </Link>
                      </>
                    ) : isStaff ? (
                      <>
                        <Link to="/staff-admin" onClick={() => setIsMobileMenuOpen(false)}>
                          <Button variant="ghost" className={`${mobileMenuButtonClass} text-primary`}>
                            <ShieldCheck className="h-4 w-4 shrink-0" />
                            Staff Workspace
                          </Button>
                        </Link>
                        <Link to="/dashboard" onClick={() => setIsMobileMenuOpen(false)}>
                          <Button variant="ghost" className={mobileMenuButtonClass}>
                            <LayoutDashboard className="h-4 w-4 shrink-0" />
                            Account Hub
                          </Button>
                        </Link>
                      </>
                    ) : (
                      <Link to="/dashboard" onClick={() => setIsMobileMenuOpen(false)}>
                        <Button variant="ghost" className={mobileMenuButtonClass}>
                          <LayoutDashboard className="h-4 w-4 shrink-0" />
                          Account Hub
                        </Button>
                      </Link>
                    )}
                    
                    {!isAdmin && (
                      <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-600 dark:text-gray-400">
                        <Wallet className="h-4 w-4 shrink-0" />
                        {walletLoading ? (
                          <span className="inline-block h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                        ) : (
                          <>Balance: {showBalances ? formatPrice(mockProfile.wallet_balance || 0) : '***'}</>
                        )}
                      </div>
                    )}
                    
                    {!isAdmin && (
                      <Link to="/referrals" onClick={() => setIsMobileMenuOpen(false)}>
                        <Button variant="ghost" className={mobileMenuButtonClass}>
                          <Gift className="h-4 w-4 shrink-0" />
                          Rewards
                        </Button>
                      </Link>
                    )}

                    <Link to="/crypto-exchange" onClick={() => setIsMobileMenuOpen(false)}>
                      <Button variant="ghost" className={mobileMenuButtonClass}>
                        <Bitcoin className="h-4 w-4 shrink-0" />
                        Crypto Exchange
                      </Button>
                    </Link>

                    <Link to="/bills" onClick={() => setIsMobileMenuOpen(false)}>
                      <Button variant="ghost" className={mobileMenuButtonClass}>
                        <CreditCard className="h-4 w-4 shrink-0" />
                        Bills & Airtime
                      </Button>
                    </Link>

                    <Link to="/gift-cards" onClick={() => setIsMobileMenuOpen(false)}>
                      <Button variant="ghost" className={mobileMenuButtonClass}>
                        <Smartphone className="h-4 w-4 shrink-0" />
                        Gift Cards & eSIMs
                      </Button>
                    </Link>

                    <Link to="/sms-numbers" onClick={() => setIsMobileMenuOpen(false)}>
                      <Button variant="ghost" className={mobileMenuButtonClass}>
                        <PhoneCall className="h-4 w-4 shrink-0" />
                        SMS Numbers
                      </Button>
                    </Link>

                    <Link to="/social-boost" onClick={() => setIsMobileMenuOpen(false)}>
                      <Button variant="ghost" className={`${mobileMenuButtonClass} text-pink-600 dark:text-pink-400`}>
                        <Rocket className="h-4 w-4 shrink-0" />
                        Social Boost
                      </Button>
                    </Link>
                    
                    {/* Install app button - Only show if not installed */}
                    {!isInstalled && (canInstall || true) && (
                      <Button 
                        variant="outline"
                        onClick={() => {
                          handleDownloadClick()
                          setIsMobileMenuOpen(false)
                        }}
                        className={`${mobileMenuButtonClass} border-primary/50 text-primary hover:bg-primary/10`}
                      >
                        <Download className="h-4 w-4 shrink-0" />
                        Install App
                      </Button>
                    )}
                    
                    <Button 
                      variant="outline" 
                      onClick={handleSignOut}
                      className={mobileMenuButtonClass}
                    >
                      <LogOut className="h-4 w-4 shrink-0" />
                      Sign Out
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Install app button - Show for non-logged-in users too */}
                    {!isInstalled && (canInstall || true) && (
                      <Button 
                        variant="outline"
                        onClick={() => {
                          handleDownloadClick()
                          setIsMobileMenuOpen(false)
                        }}
                        className={`${mobileMenuButtonClass} border-primary/50 text-primary hover:bg-primary/10`}
                      >
                        <Download className="h-4 w-4 shrink-0" />
                        Install App
                      </Button>
                    )}
                    
                    <Link to="/login" onClick={() => setIsMobileMenuOpen(false)}>
                      <Button variant="ghost" className={mobileMenuButtonClass}>
                        <User className="h-4 w-4 shrink-0" />
                        Sign In
                      </Button>
                    </Link>
                    <Link to="/register" onClick={() => setIsMobileMenuOpen(false)}>
                      <Button variant="hero" className={mobileMenuButtonClass}>
                        <PackageCheck className="h-4 w-4 shrink-0" />
                        Get Started
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Install App Dialog */}
      <InstallAppDialog 
        open={showInstallDialog} 
        onOpenChange={setShowInstallDialog}
      />
    </nav>
    </>
  )
}
