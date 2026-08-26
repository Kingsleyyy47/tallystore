import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { BackToHome } from '@/components/ui/back-button'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import { trackRevenueEvent } from '@/lib/revenue-os'

const PrivacyPage = () => {
  useEffect(() => {
    trackRevenueEvent({
      eventType: 'PAGE_VIEWED',
      surface: 'privacy',
    })
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black tracking-normal text-slate-950 dark:text-white mb-4">
            Privacy Policy
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">
            Last updated: January 1, 2024
          </p>
          <Badge variant="outline" className="mt-2">
            GDPR Compliant
          </Badge>
        </div>

        {/* Navigation */}
        <div className="mb-8 text-center">
          <BackToHome />
        </div>

        {/* Privacy Content */}
        <div className="space-y-6">

          {/* Introduction */}
          <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <CardHeader>
              <CardTitle className="text-blue-800 dark:text-blue-200">Your Privacy Matters</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-blue-700 dark:text-blue-300">
                At TallyStore, we are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our services.
              </p>
            </CardContent>
          </Card>
          
          {/* 1. Information We Collect */}
          <Card>
            <CardHeader>
              <CardTitle>1. Information We Collect</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>Personal Information:</strong>
              </p>
              <ul>
                <li>Name and email address</li>
                <li>Contact information</li>
                <li>Payment information (processed securely by third-party providers)</li>
                <li>Account preferences and settings</li>
              </ul>
              
              <p className="mt-4">
                <strong>Usage Information:</strong>
              </p>
              <ul>
                <li>IP address and device information</li>
                <li>Browser type and version</li>
                <li>Pages visited and time spent</li>
                <li>Purchase history and transaction data</li>
                <li>Support tickets and communications</li>
              </ul>

              <p className="mt-4">
                <strong>Cookies and Tracking:</strong>
              </p>
              <ul>
                <li>Essential cookies for site functionality</li>
                <li>Analytics cookies to improve our service</li>
                <li>Preference cookies to remember your settings</li>
              </ul>
            </CardContent>
          </Card>

          {/* 2. How We Use Your Information */}
          <Card>
            <CardHeader>
              <CardTitle>2. How We Use Your Information</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                We use your information to:
              </p>
              <ul>
                <li>Process transactions and deliver purchased accounts</li>
                <li>Provide customer support and respond to inquiries</li>
                <li>Improve our services and user experience</li>
                <li>Send important updates and security notifications</li>
                <li>Prevent fraud and ensure platform security</li>
                <li>Comply with legal obligations</li>
              </ul>
              
              <p className="mt-4">
                <strong>Marketing Communications:</strong>
              </p>
              <p>
                We may send promotional emails only with your explicit consent. You can opt out at any time using the unsubscribe link in our emails.
              </p>
            </CardContent>
          </Card>

          {/* 3. Information Sharing */}
          <Card>
            <CardHeader>
              <CardTitle>3. Information Sharing and Disclosure</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>We DO NOT sell your personal information.</strong>
              </p>
              
              <p className="mt-4">
                We may share information with:
              </p>
              <ul>
                <li><strong>Service Providers:</strong> Payment processors, hosting providers, analytics services</li>
                <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
                <li><strong>Business Transfers:</strong> In connection with mergers or acquisitions</li>
                <li><strong>Consent:</strong> When you explicitly authorize sharing</li>
              </ul>
              
              <p className="mt-4">
                All third-party services are vetted for privacy compliance and are bound by confidentiality agreements.
              </p>
            </CardContent>
          </Card>

          {/* 4. Data Security */}
          <Card>
            <CardHeader>
              <CardTitle>4. Data Security</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>Security Measures:</strong>
              </p>
              <ul>
                <li>SSL/TLS encryption for all data transmission</li>
                <li>Secure data storage with encryption at rest</li>
                <li>Regular security audits and vulnerability assessments</li>
                <li>Access controls and employee training</li>
                <li>Multi-factor authentication for accounts</li>
              </ul>
              
              <p className="mt-4">
                <strong>Payment Security:</strong>
              </p>
              <p>
                We do not store payment card information. All payments are processed by PCI DSS compliant payment processors.
              </p>
              
              <p className="mt-4">
                <strong>Data Breach Response:</strong>
              </p>
              <p>
                In the unlikely event of a data breach, we will notify affected users within 72 hours and take immediate action to secure the platform.
              </p>
            </CardContent>
          </Card>

          {/* 5. Your Rights */}
          <Card>
            <CardHeader>
              <CardTitle>5. Your Privacy Rights</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>You have the right to:</strong>
              </p>
              <ul>
                <li><strong>Access:</strong> Request a copy of your personal data</li>
                <li><strong>Rectification:</strong> Correct inaccurate or incomplete information</li>
                <li><strong>Erasure:</strong> Request deletion of your personal data ("right to be forgotten")</li>
                <li><strong>Portability:</strong> Receive your data in a machine-readable format</li>
                <li><strong>Restriction:</strong> Limit how we process your information</li>
                <li><strong>Objection:</strong> Object to processing for direct marketing</li>
                <li><strong>Withdraw Consent:</strong> Revoke consent for data processing</li>
              </ul>
              
              <p className="mt-4">
                <strong>How to Exercise Your Rights:</strong>
              </p>
              <ul>
                <li>Contact us via the <a href="/support" className="underline hover:no-underline">Support Center</a></li>
                <li>Use the privacy controls in your account settings</li>
                <li>Submit a request through our support center</li>
              </ul>
              
              <p className="mt-4">
                We will respond to your requests within 30 days.
              </p>
            </CardContent>
          </Card>

          {/* 6. Data Retention */}
          <Card>
            <CardHeader>
              <CardTitle>6. Data Retention</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>Retention Periods:</strong>
              </p>
              <ul>
                <li><strong>Account Data:</strong> While your account is active + 3 years after closure</li>
                <li><strong>Transaction Records:</strong> 7 years for tax and legal compliance</li>
                <li><strong>Support Communications:</strong> 3 years from last interaction</li>
                <li><strong>Analytics Data:</strong> 26 months (anonymized after 14 months)</li>
                <li><strong>Marketing Data:</strong> Until you unsubscribe + 2 years</li>
              </ul>
              
              <p className="mt-4">
                After retention periods expire, data is securely deleted or anonymized.
              </p>
            </CardContent>
          </Card>

          {/* 7. Cookies and Tracking */}
          <Card>
            <CardHeader>
              <CardTitle>7. Cookies and Tracking Technologies</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                <strong>Cookie Types:</strong>
              </p>
              <ul>
                <li><strong>Essential Cookies:</strong> Required for site functionality (cannot be disabled)</li>
                <li><strong>Performance Cookies:</strong> Help us understand how users interact with our site</li>
                <li><strong>Functional Cookies:</strong> Remember your preferences and settings</li>
                <li><strong>Marketing Cookies:</strong> Used for targeted advertising (only with consent)</li>
              </ul>
              
              <p className="mt-4">
                <strong>Managing Cookies:</strong>
              </p>
              <ul>
                <li>Use our cookie consent banner to manage preferences</li>
                <li>Configure your browser settings to block cookies</li>
                <li>Visit your account settings to update preferences</li>
              </ul>
            </CardContent>
          </Card>

          {/* 8. International Transfers */}
          <Card>
            <CardHeader>
              <CardTitle>8. International Data Transfers</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                Your information may be transferred to and processed in countries other than your own. We ensure adequate protection through:
              </p>
              <ul>
                <li>Standard Contractual Clauses (SCCs)</li>
                <li>Adequacy decisions by regulatory authorities</li>
                <li>Binding Corporate Rules for multinational transfers</li>
                <li>Explicit consent where required</li>
              </ul>
            </CardContent>
          </Card>

          {/* 9. Children's Privacy */}
          <Card>
            <CardHeader>
              <CardTitle>9. Children's Privacy</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                Our services are not intended for individuals under 18 years of age. We do not knowingly collect personal information from children under 18.
              </p>
              <p className="mt-4">
                If we learn that we have collected information from a child under 18, we will delete that information immediately. Parents or guardians who believe we may have collected information from their child should contact us immediately.
              </p>
            </CardContent>
          </Card>

          {/* 10. Updates to Privacy Policy */}
          <Card>
            <CardHeader>
              <CardTitle>10. Updates to This Privacy Policy</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p>
                We may update this Privacy Policy periodically to reflect changes in our practices or legal requirements.
              </p>
              
              <p className="mt-4">
                <strong>How We Notify You:</strong>
              </p>
              <ul>
                <li>Email notification for material changes</li>
                <li>Account notification upon login</li>
                <li>Updated "Last modified" date at the top of this policy</li>
                <li>30-day notice period for significant changes</li>
              </ul>
              
              <p className="mt-4">
                Your continued use of our services after changes become effective constitutes acceptance of the updated policy.
              </p>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
            <CardHeader>
              <CardTitle className="text-green-800 dark:text-green-200">Contact Our Data Protection Team</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-green-700 dark:text-green-300">
                For any privacy-related questions or concerns:
              </p>
              <div className="mt-4 space-y-2 text-green-700 dark:text-green-300">
                <p>
                  - <strong>Support:</strong>{' '}
                  <a href="/support" className="underline hover:no-underline">
                    Visit Support Center
                  </a>
                </p>
                <p>- <strong>General Support:</strong> <Link to="/support" className="underline hover:no-underline">Visit Support Center</Link></p>
                <p>- <strong>Response Time:</strong> Within 30 days of your request</p>
              </div>
            </CardContent>
          </Card>

        </div>

        <Separator className="my-8" />

        {/* Footer Navigation */}
        <div className="text-center space-y-4">
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Link to="/terms" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Terms of Service
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

export default PrivacyPage
