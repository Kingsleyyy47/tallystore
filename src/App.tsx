import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from 'react'
import { Navigate, Routes, Route } from "react-router-dom";
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
import VisitorTracker from '@/components/VisitorTracker'

// ⚠️ MAINTENANCE MODE - Set to false to restore normal site
const MAINTENANCE_MODE = false;
// Local dev bypass: maintenance only shows in production
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Pages
import Index from "./pages/Index";
const SimpleLogin = lazy(() => import('@/pages/SimpleLogin'))
const SimpleRegister = lazy(() => import('@/pages/SimpleRegister'))
const ProductsPage = lazy(() => import('@/pages/ProductsPage'))
const CategoryPage = lazy(() => import('@/pages/CategoryPage'))
const ProductDetailPage = lazy(() => import('@/pages/ProductDetailPage'))
const CheckoutPage = lazy(() => import('@/pages/CheckoutPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const OrderHistoryPage = lazy(() => import('@/pages/OrderHistoryPage'))
const PaymentCallbackPage = lazy(() => import('@/pages/PaymentCallbackPage'))
const PaymentSuccessPage = lazy(() => import('@/pages/PaymentSuccessPage'))
const WalletPage = lazy(() => import('@/pages/WalletPage'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const ReferralsPage = lazy(() => import('@/pages/ReferralsPage'))
const HowItWorksPage = lazy(() => import('@/pages/HowItWorksPage'))
const SupportPage = lazy(() => import('@/pages/SupportPage'))
const TermsPage = lazy(() => import('@/pages/TermsPage'))
const PrivacyPage = lazy(() => import('@/pages/PrivacyPage'))
const AboutPage = lazy(() => import('@/pages/AboutPage'))
const ContactPage = lazy(() => import('@/pages/ContactPage'))
const WebServicesPage = lazy(() => import('@/pages/WebServicesPage'))
const AdminPage = lazy(() => import('@/pages/AdminPage'))
const StaffAdminPage = lazy(() => import('@/pages/StaffAdminPage'))
const EmailConfirmation = lazy(() => import('@/pages/EmailConfirmation'))
const ReferralWithdrawal = lazy(() => import('@/pages/ReferralWithdrawal'))
const BillsPayment = lazy(() => import('@/pages/BillsPayment'))
const GiftCardsEsims = lazy(() => import('@/pages/GiftCardsEsims'))
const SocialBoostPage = lazy(() => import('@/pages/SocialBoostPage'))
const GetIP = lazy(() => import('@/pages/GetIP'))
const SmsNumbersPage = lazy(() => import('@/pages/SmsNumbersPage'))
const TelegramStarsPage = lazy(() => import('@/pages/TelegramStarsPage'))
const TravelVisaPage = lazy(() => import('@/pages/TravelVisaPage'))
const NotFound = lazy(() => import('@/pages/NotFound'))

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
          <InstallPromptBanner />
          <UpdatePromptBanner />
          <AuthProvider>
          <LoginWelcomeDialog />
          <CurrencyProvider>
            <VisitorTracker />
            <GlobalPaymentChecker />
            <ChatWidget />
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading page...</div>}>
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
              <Route path="/travel-visa" element={<TravelVisaPage />} />
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
                    <Dashboard />
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
                    <Navigate to="/wallet" replace />
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
                    <Navigate to="/wallet" replace />
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
                    <Navigate to="/wallet" replace />
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
                path="/telegram-stars"
                element={
                  <ProtectedRoute requireRole="user">
                    <TelegramStarsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/us-canada"
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
            </Suspense>
            <MobileBottomNav />
          </CurrencyProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
