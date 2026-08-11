import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { BackToHome } from '@/components/ui/back-button'

const AboutPage = () => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            About TallyStore
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Your trusted partner in the social media marketplace
          </p>
          <Badge variant="outline" className="mt-2">
            Since 2024
          </Badge>
        </div>

        {/* Navigation */}
        <div className="mb-8">
          <BackToHome />
        </div>

        {/* About Content */}
        <div className="space-y-6">

          {/* Our Story */}
          <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-blue-200 dark:border-blue-800">
            <CardHeader>
              <CardTitle className="text-blue-800 dark:text-blue-200">Our Story</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-blue-700 dark:text-blue-300 text-lg leading-relaxed">
                TallyStore was founded with a simple mission: to create a secure, reliable marketplace for social media accounts. We recognized the growing need for businesses and individuals to access established social media presence quickly and safely.
              </p>
              <p className="text-blue-700 dark:text-blue-300 mt-4">
                What started as a small team of digital marketing enthusiasts has grown into a trusted platform serving thousands of customers worldwide.
              </p>
            </CardContent>
          </Card>

          {/* Our Mission */}
          <Card>
            <CardHeader>
              <CardTitle>Our Mission</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <p className="text-lg font-medium text-gray-800 dark:text-gray-200">
                "To democratize access to established social media presence while maintaining the highest standards of security, authenticity, and customer service."
              </p>
              
              <div className="grid md:grid-cols-3 gap-6 mt-6">
                <div className="text-center">
                  <div className="bg-blue-100 dark:bg-blue-900/30 rounded-full w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                    <span className="text-blue-600 dark:text-blue-400 text-xl">🛡️</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">Security First</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                    Every transaction is protected with enterprise-grade security
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="bg-green-100 dark:bg-green-900/30 rounded-full w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                    <span className="text-green-600 dark:text-green-400 text-xl">✅</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">Verified Quality</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                    All accounts undergo rigorous verification before listing
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="bg-purple-100 dark:bg-purple-900/30 rounded-full w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                    <span className="text-purple-600 dark:text-purple-400 text-xl">🤝</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">Customer Success</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                    24/7 support to ensure your success with every purchase
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* What We Offer */}
          <Card>
            <CardHeader>
              <CardTitle>What We Offer</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Platform Coverage</h4>
                  <ul className="space-y-2">
                    <li>📱 Instagram accounts with engaged followers</li>
                    <li>🎵 TikTok accounts with viral potential</li>
                    <li>📺 YouTube channels with subscriber base</li>
                    <li>🐦 Twitter accounts with established presence</li>
                    <li>💼 LinkedIn profiles for professionals</li>
                    <li>📘 Facebook pages and groups</li>
                  </ul>
                </div>
                
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Services</h4>
                  <ul className="space-y-2">
                    <li>🔍 Account verification and authentication</li>
                    <li>💰 Secure payment processing</li>
                    <li>📊 Detailed account analytics</li>
                    <li>🔒 Secure account transfer process</li>
                    <li>📞 24/7 customer support</li>
                    <li>💳 Digital wallet for easy payments</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Our Process */}
          <Card>
            <CardHeader>
              <CardTitle>Our Verification Process</CardTitle>
              <CardDescription>How we ensure account quality and authenticity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start space-x-4">
                  <div className="bg-blue-100 dark:bg-blue-900/30 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">1</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">Initial Screening</h4>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                      Every account undergoes automated checks for basic authenticity markers
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-4">
                  <div className="bg-blue-100 dark:bg-blue-900/30 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">2</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">Manual Review</h4>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                      Our experts manually review content quality, engagement rates, and audience authenticity
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-4">
                  <div className="bg-blue-100 dark:bg-blue-900/30 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">3</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">Security Check</h4>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                      Comprehensive security audit to ensure account hasn't been compromised
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-4">
                  <div className="bg-green-100 dark:bg-green-900/30 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-green-600 dark:text-green-400 text-sm font-bold">✓</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">Approval & Listing</h4>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                      Approved accounts are listed with detailed metrics and ready for purchase
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Our Team */}
          <Card>
            <CardHeader>
              <CardTitle>Our Team</CardTitle>
              <CardDescription>The people behind TallyStore</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="bg-gradient-to-br from-blue-400 to-purple-500 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                    <span className="text-white text-2xl font-bold">JD</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">John Doe</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">CEO & Founder</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                    10+ years in digital marketing
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="bg-gradient-to-br from-green-400 to-blue-500 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                    <span className="text-white text-2xl font-bold">SM</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">Sarah Miller</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">CTO</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                    Security & platform architecture
                  </p>
                </div>
                
                <div className="text-center">
                  <div className="bg-gradient-to-br from-purple-400 to-pink-500 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                    <span className="text-white text-2xl font-bold">MJ</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">Mike Johnson</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Head of Customer Success</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                    Ensuring customer satisfaction
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Trust & Security */}
          <Card>
            <CardHeader>
              <CardTitle>Trust & Security</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Security Certifications</h4>
                  <ul className="space-y-2 text-sm">
                    <li>🔒 SSL/TLS encryption for all communications</li>
                    <li>🛡️ PCI DSS compliant payment processing</li>
                    <li>📊 Regular security audits and penetration testing</li>
                    <li>🔐 Two-factor authentication support</li>
                    <li>💾 Encrypted data storage and backups</li>
                  </ul>
                </div>
                
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Trust Indicators</h4>
                  <ul className="space-y-2 text-sm">
                    <li>⭐ 4.8/5 average customer rating</li>
                    <li>👥 50,000+ satisfied customers</li>
                    <li>🚀 99.9% uptime guarantee</li>
                    <li>💬 24/7 customer support</li>
                    <li>💰 Money-back guarantee policy</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Our Values */}
          <Card>
            <CardHeader>
              <CardTitle>Our Core Values</CardTitle>
            </CardHeader>
            <CardContent className="prose dark:prose-invert max-w-none">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white text-base">🎯 Transparency</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Clear communication about account details, pricing, and processes
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white text-base">⚡ Innovation</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Constantly improving our platform with cutting-edge technology
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white text-base">🤝 Integrity</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Ethical business practices and honest representation of all accounts
                    </p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white text-base">🎯 Excellence</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Striving for perfection in every aspect of our service
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white text-base">🌱 Growth</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Helping our customers achieve their social media goals
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white text-base">🌍 Community</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Building a supportive ecosystem for digital entrepreneurs
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Join Us CTA */}
          <Card className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border-purple-200 dark:border-purple-800">
            <CardHeader>
              <CardTitle className="text-purple-800 dark:text-purple-200 text-center">Ready to Get Started?</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-purple-700 dark:text-purple-300 mb-6">
                Join thousands of satisfied customers who trust TallyStore for their social media needs
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <Link to="/products">
                  <Button className="bg-purple-600 hover:bg-purple-700 text-white">
                    Browse Products
                  </Button>
                </Link>
                <Link to="/register">
                  <Button variant="outline" className="border-purple-600 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20">
                    Create Account
                  </Button>
                </Link>
                <Link to="/contact">
                  <Button variant="ghost" className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300">
                    Contact Sales
                  </Button>
                </Link>
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
            <Link to="/privacy" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Privacy Policy
            </Link>
            <Link to="/support" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Support Center
            </Link>
            <Link to="/contact" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
              Contact Us
            </Link>
          </div>
          
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            © 2024 Tallybest Store LTD. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}

export default AboutPage
