import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { BackToHome } from "@/components/ui/back-button"
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'

const TermsPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black tracking-normal text-slate-950 dark:text-white mb-4">
            Terms of Service
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">
            Last updated: January 1, 2024
          </p>
          <Badge variant="outline" className="mt-2">
            Version 1.0
          </Badge>
        </div>

        {/* Navigation */}
        <div className="mb-8 text-center">
          <BackToHome />
        </div>

        {/* Terms Content */}
        <div className="space-y-6">
          
          {/* 1. Agreement to Terms */}
          <Card>
            <CardHeader>
              <CardTitle>1. Agreement to Terms</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                By accessing and using TallyStore ("we," "our," or "us"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.
              </p>
            </CardContent>
          </Card>

          {/* 2. Description of Service */}
          <Card>
            <CardHeader>
              <CardTitle>2. Description of Service</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                TallyStore is an online marketplace that facilitates the sale of social media accounts across various platforms including Instagram, TikTok, YouTube, Twitter, and others.
              </p>
              <p className="mt-4">
                <strong>We provide:</strong>
              </p>
              <ul>
                <li>Verified social media accounts</li>
                <li>Secure transaction processing</li>
                <li>Account authentication services</li>
                <li>Customer support</li>
                <li>Digital wallet services</li>
              </ul>
            </CardContent>
          </Card>

          {/* 3. User Accounts */}
          <Card>
            <CardHeader>
              <CardTitle>3. User Accounts and Responsibilities</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                To use certain features of our service, you must create an account. You are responsible for:
              </p>
              <ul>
                <li>Maintaining the confidentiality of your account information</li>
                <li>All activities that occur under your account</li>
                <li>Providing accurate and up-to-date information</li>
                <li>Notifying us immediately of any unauthorized use</li>
              </ul>
              <p className="mt-4">
                You must be at least 18 years old to create an account and use our services.
              </p>
            </CardContent>
          </Card>

          {/* 4. Purchases and Payments */}
          <Card>
            <CardHeader>
              <CardTitle>4. Purchases and Payments</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>Payment Terms:</strong>
              </p>
              <ul>
                <li>All purchases must be made through our secure payment system</li>
                <li>Prices are subject to change without notice</li>
                <li>Payment must be received before account delivery</li>
                <li>All sales are final unless otherwise specified in our refund policy</li>
              </ul>
              
              <p className="mt-4">
                <strong>Digital Wallet:</strong>
              </p>
              <ul>
                <li>You can maintain a balance in your TallyStore wallet</li>
                <li>Wallet funds are non-refundable except as required by law</li>
                <li>We reserve the right to suspend wallet privileges for violations</li>
              </ul>
            </CardContent>
          </Card>

          {/* 5. Account Delivery and Verification */}
          <Card>
            <CardHeader>
              <CardTitle>5. Account Delivery and Verification</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>Delivery:</strong>
              </p>
              <ul>
                <li>Accounts are delivered digitally through your account and order history</li>
                <li>Delivery typically occurs within 24 hours of payment confirmation</li>
                <li>You are responsible for securing delivered account credentials</li>
              </ul>
              
              <p className="mt-4">
                <strong>Verification:</strong>
              </p>
              <ul>
                <li>All accounts undergo verification before listing</li>
                <li>We verify account authenticity and basic metrics</li>
                <li>Account performance may vary after transfer</li>
              </ul>
            </CardContent>
          </Card>

          {/* 6. Prohibited Uses */}
          <Card>
            <CardHeader>
              <CardTitle>6. Prohibited Uses</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                You may not use our service for:
              </p>
              <ul>
                <li>Illegal activities or violations of platform terms of service</li>
                <li>Spam, harassment, or abusive behavior</li>
                <li>Fraud, deception, or misrepresentation</li>
                <li>Reselling accounts without proper authorization</li>
                <li>Attempting to circumvent our security measures</li>
                <li>Using accounts for hate speech or harmful content</li>
              </ul>
            </CardContent>
          </Card>

          {/* 7. Disclaimer and Limitations */}
          <Card>
            <CardHeader>
              <CardTitle>7. Disclaimer and Limitations</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>Service Disclaimer:</strong>
              </p>
              <ul>
                <li>Services are provided "as is" without warranties</li>
                <li>We do not guarantee account performance or longevity</li>
                <li>Platform policy changes may affect purchased accounts</li>
                <li>We are not responsible for platform suspensions post-delivery</li>
              </ul>
              
              <p className="mt-4">
                <strong>Limitation of Liability:</strong>
              </p>
              <p>
                Our liability is limited to the purchase price of the account. We are not liable for indirect, incidental, or consequential damages.
              </p>
            </CardContent>
          </Card>

          {/* 8. Refund Policy */}
          <Card>
            <CardHeader>
              <CardTitle>8. Refund Policy</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>Refund Eligibility:</strong>
              </p>
              <ul>
                <li>Account not delivered within 48 hours</li>
                <li>Account significantly different from description</li>
                <li>Account suspended within 24 hours due to pre-existing issues</li>
              </ul>
              
              <p className="mt-4">
                <strong>Refund Process:</strong>
              </p>
              <ul>
                <li>Contact support within 48 hours of delivery</li>
                <li>Provide detailed explanation and evidence</li>
                <li>Refunds processed within 5-7 business days if approved</li>
              </ul>
            </CardContent>
          </Card>

          {/* 9. Privacy and Data Protection */}
          <Card>
            <CardHeader>
              <CardTitle>9. Privacy and Data Protection</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                Your privacy is important to us. Please review our Privacy Policy to understand how we collect, use, and protect your information.
              </p>
              <p className="mt-4">
                By using our service, you consent to our data practices as described in our Privacy Policy.
              </p>
            </CardContent>
          </Card>

          {/* 10. Termination */}
          <Card>
            <CardHeader>
              <CardTitle>10. Termination</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>We may terminate or suspend your account for:</strong>
              </p>
              <ul>
                <li>Violation of these terms</li>
                <li>Fraudulent or suspicious activity</li>
                <li>Non-payment or chargebacks</li>
                <li>Abuse of our support system</li>
              </ul>
              
              <p className="mt-4">
                You may terminate your account at any time by contacting our support team.
              </p>
            </CardContent>
          </Card>

          {/* 11. Changes to Terms */}
          <Card>
            <CardHeader>
              <CardTitle>11. Changes to Terms</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting on our website. Your continued use of the service after changes constitutes acceptance of the new terms.
              </p>
              <p className="mt-4">
                We will notify users of significant changes via email or account notification.
              </p>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <CardHeader>
              <CardTitle className="text-blue-800 dark:text-blue-200">Contact Information</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-blue-700 dark:text-blue-300">
                If you have any questions about these Terms of Service, please contact us:
              </p>
              <div className="mt-4 space-y-2 text-blue-700 dark:text-blue-300">
                <p>
                  - <a href="/support" className="underline hover:no-underline">Support Center</a>
                </p>
                <p>- Support: <Link to="/support" className="underline hover:no-underline">Visit Support Center</Link></p>
                <p>- Business Hours: Monday - Friday, 9:00 AM - 6:00 PM WAT</p>
              </div>
            </CardContent>
          </Card>

        </div>

        <Separator className="my-8" />

        {/* Footer Navigation */}
        <div className="text-center space-y-4">
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Link to="/privacy" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Privacy Policy
            </Link>
            <Link to="/support" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Support Center
            </Link>
            <Link to="/contact" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Contact Us
            </Link>
            <Link to="/about" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              About Us
            </Link>
          </div>
          
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            © 2024 Tallybest Store LTD. All rights reserved.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}

export default TermsPage
