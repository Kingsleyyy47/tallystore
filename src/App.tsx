import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from '@/contexts/SimpleAuth'
import { CurrencyProvider } from '@/contexts/CurrencyContext'
import { ProtectedRoute, PublicRoute } from '@/components/SimpleProtectedRoute'
import InstallPromptBanner from '@/components/InstallPromptBanner'
import UpdatePromptBanner from '@/components/UpdatePromptBanner'
import AnnouncementBanner from '@/components/AnnouncementBanner'
import MaintenancePage from '@/components/MaintenancePage'
import GlobalPaymentChecker from '@/components/GlobalPaymentChecker'
import LoginWelcomeDialog from '@/components/LoginWelcomeDialog'
import ChatWidget from '@/components/ChatWidget'
import MobileBottomNav from '@/components/MobileBottomNav'

// ⚠️ MAINTENANCE MODE - Set to false to restore normal site
const MAINTENANCE_MODE = false;
// Local dev bypass: maintenance only shows in production
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Version tracking for cache busting
const MAINTENANCE_VERSION = "2.5-wallet-actions-tabs";

// Force cache clear on version change
if (typeof window !== 'undefined' && !isLocalDev) {
  const lastVersion = localStorage.getItem('app_version');
  if (lastVersion !== MAINTENANCE_VERSION) {
    console.log(`🔄 Version changed from ${lastVersion} to ${MAINTENANCE_VERSION}, clearing caches...`);
    
    // Clear service workers
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.unregister());
      });
    }
    
    // Clear all caches
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    
    // Update version and reload
    localStorage.setItem('app_version', MAINTENANCE_VERSION);
    setTimeout(() => window.location.reload(), 100);
  }
}

// Pages
import Index from "./pages/Index";
import SimpleLogin from '@/pages/SimpleLogin'
import SimpleRegister from '@/pages/SimpleRegister'
import ProductsPage from '@/pages/ProductsPage'
import CategoryPage from '@/pages/CategoryPage'
import ProductDetailPage from '@/pages/ProductDetailPage'
import CheckoutPage from '@/pages/CheckoutPage'
import ProfilePage from '@/pages/ProfilePage'
import OrderHistoryPage from '@/pages/OrderHistoryPage'
import PaymentCallbackPage from '@/pages/PaymentCallbackPage'
import PaymentSuccessPage from '@/pages/PaymentSuccessPage'
import WalletPage from '@/pages/WalletPage'
import ReferralsPage from '@/pages/ReferralsPage'
import HowItWorksPage from '@/pages/HowItWorksPage'
import SupportPage from '@/pages/SupportPage'
import TermsPage from '@/pages/TermsPage'
import PrivacyPage from '@/pages/PrivacyPage'
import AboutPage from '@/pages/AboutPage'
import ContactPage from '@/pages/ContactPage'
import WebServicesPage from '@/pages/WebServicesPage'
import AdminPage from '@/pages/AdminPage'
import StaffAdminPage from '@/pages/StaffAdminPage'
import EmailConfirmation from '@/pages/EmailConfirmation'
import CryptoExchange from '@/pages/CryptoExchange'
import CryptoWithdrawal from '@/pages/CryptoWithdrawal'
import ReferralWithdrawal from '@/pages/ReferralWithdrawal'
import CryptoHistory from '@/pages/CryptoHistory'
import BillsPayment from "./pages/BillsPayment";
import GiftCardsEsims from "./pages/GiftCardsEsims";
import SocialBoostPage from "./pages/SocialBoostPage";
import GetIP from "./pages/GetIP";
import SmsNumbersPage from "./pages/SmsNumbersPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  // Show maintenance page when enabled (except on local dev)
  if (MAINTENANCE_MODE && !isLocalDev) {
    return <MaintenancePage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange={false}
      >
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <AnnouncementBanner />
          <LoginWelcomeDialog />
          <InstallPromptBanner />
          <UpdatePromptBanner />
          <ChatWidget />
          <AuthProvider>
          <CurrencyProvider>
            <GlobalPaymentChecker />
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<Index />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/category/:categoryId" element={<CategoryPage />} />
              <Route path="/product/:productId" element={<ProductDetailPage />} />
              <Route path="/how-it-works" element={<HowItWorksPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/web-services" element={<WebServicesPage />} />
              <Route path="/email-confirmation" element={<EmailConfirmation />} />

              {/* Auth Routes - redirect to dashboard if already logged in */}
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <SimpleLogin />
                  </PublicRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <PublicRoute>
                    <SimpleRegister />
                  </PublicRoute>
                }
              />

              {/* Auth callback for OAuth - not needed for email/password auth */}

              {/* Protected Routes - require authentication */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute requireRole="user">
                    <WalletPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute>
                    <OrderHistoryPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/checkout"
                element={
                  <ProtectedRoute>
                    <CheckoutPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/wallet"
                element={
                  <ProtectedRoute requireRole="user">
                    <WalletPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrals"
                element={
                  <ProtectedRoute requireRole="user">
                    <ReferralsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/payment-callback"
                element={
                  <ProtectedRoute requireRole="user">
                    <PaymentCallbackPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/payment-success"
                element={
                  <ProtectedRoute requireRole="user">
                    <PaymentSuccessPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/crypto-exchange"
                element={
                  <ProtectedRoute requireRole="user">
                    <CryptoExchange />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/bills"
                element={
                  <ProtectedRoute requireRole="user">
                    <BillsPayment />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/gift-cards"
                element={
                  <ProtectedRoute requireRole="user">
                    <GiftCardsEsims />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/crypto-withdrawal"
                element={
                  <ProtectedRoute requireRole="user">
                    <CryptoWithdrawal />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referral-withdrawal"
                element={
                  <ProtectedRoute requireRole="user">
                    <ReferralWithdrawal />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/crypto-history"
                element={
                  <ProtectedRoute requireRole="user">
                    <CryptoHistory />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/get-ip"
                element={
                  <ProtectedRoute requireRole="admin">
                    <GetIP />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/social-boost"
                element={
                  <ProtectedRoute requireRole="user">
                    <SocialBoostPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sms-numbers"
                element={
                  <ProtectedRoute requireRole="user">
                    <SmsNumbersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requireRole="admin">
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff-admin"
                element={
                  <ProtectedRoute requireRole="staff">
                    <StaffAdminPage />
                  </ProtectedRoute>
                }
              />

              {/* Catch all route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            <MobileBottomNav />
          </CurrencyProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
