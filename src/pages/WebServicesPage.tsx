import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Globe, 
  Smartphone, 
  Palette, 
  Code, 
  Zap, 
  Check, 
  Star, 
  MessageCircle,
  Clock,
  Award
} from 'lucide-react'
import NavbarAuth from '@/components/NavbarAuth'
import Footer from '@/components/Footer'
import WalletBalanceWidget from '@/components/WalletBalanceWidget'
import { useSupportSettings } from '@/hooks/useSupportSettings'

// Web service packages
const webServices = [
  {
    id: 'basic',
    name: 'Starter Website',
    price: 50000,
    duration: '3-5 days',
    tagline: 'Get Your Business Online Fast',
    features: [
      'Beautiful 5-page website',
      'Works perfectly on phones & computers',
      'Customers can easily contact you',
      'Appear on Google search',
      'We host it FREE for 1 year',
      'Simple changes included'
    ],
    benefits: 'Stop losing customers who can\'t find you online',
    ideal: 'Perfect for: Hair salons, restaurants, small shops, freelancers'
  },
  {
    id: 'business',
    name: 'Business Builder',
    price: 150000,
    duration: '7-10 days',
    popular: true,
    tagline: 'Get More Customers Every Month',
    features: [
      'Professional 10-page website',
      'Rank higher on Google searches',
      'Show your location on maps',
      'Link to Instagram & WhatsApp',
      'Professional design that builds trust',
      'Update content yourself anytime',
      'FREE hosting for 1 year',
      '3 design changes included'
    ],
    benefits: 'Bring in 5-10 new customers monthly (worth ₦500k+ yearly)',
    ideal: 'Perfect for: Growing businesses, service providers, consultants'
  },
  {
    id: 'ecommerce',
    name: 'Online Store',
    price: 300000,
    duration: '14-21 days',
    tagline: 'Sell 24/7 While You Sleep',
    features: [
      'Full online shop - unlimited products',
      'Accept payments automatically',
      'Manage products & stock easily',
      'Customers create accounts',
      'Track all your orders',
      'Works on phones & computers',
      'Get found on Google',
      'FREE hosting for 1 year',
      'Easy-to-use admin panel'
    ],
    benefits: 'Make money 24/7 without lifting a finger. Our client made ₦2M in 6 months!',
    ideal: 'Perfect for: Clothing stores, electronics, food vendors, any retailer'
  }
]

// Why you need a website - benefits focused
const benefits = [
  { 
    title: 'Get Found by Customers', 
    description: 'Appear when people search for your business on Google',
    icon: Globe 
  },
  { 
    title: 'Make Money 24/7', 
    description: 'Take orders and bookings even when you\'re sleeping',
    icon: Clock 
  },
  { 
    title: 'Look Professional', 
    description: 'Customers trust businesses with websites 10x more',
    icon: Award 
  },
  { 
    title: 'Beat Your Competition', 
    description: 'Stand out from competitors without websites',
    icon: Star 
  },
  { 
    title: 'Works on All Phones', 
    description: 'Looks perfect whether customers use iPhone or Android',
    icon: Smartphone 
  },
  { 
    title: 'Easy to Update', 
    description: 'Change prices, add products - no tech skills needed',
    icon: Zap 
  }
]

export default function WebServicesPage() {
  const support = useSupportSettings()
  const supportUrl = support.whatsappUrl || support.telegramUrl || ''
  const [selectedService, setSelectedService] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    projectType: '',
    budget: '',
    timeline: '',
    description: '',
    features: ''
  })
  const [showForm, setShowForm] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const handleServiceSelect = (serviceId: string) => {
    setSelectedService(serviceId)
    setShowForm(true)
    setFormData(prev => ({ ...prev, projectType: serviceId }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // In real app, this would send to backend
    console.log('Form submitted:', formData)
    setSubmitSuccess(true)
    setShowForm(false)
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="min-h-screen bg-background">
      <NavbarAuth />
      
      {/* Wallet Balance Widget */}
      <div className="container mx-auto px-6 pt-24 pb-4 max-w-6xl">
        <WalletBalanceWidget showRefresh={true} />
      </div>
      
      <div className="container mx-auto px-6 pb-12 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">
            Get a Website That Makes You Money
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto mb-6">
            Your business loses customers every day without a website. We build simple, beautiful websites 
            that bring customers to your door 24/7.
          </p>
          <div className="inline-flex items-center gap-2 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 px-6 py-3 rounded-lg border border-green-200 dark:border-green-800">
            <Check className="h-5 w-5" />
            <span className="font-semibold">Starting at just ₦50,000 • Ready in 3-5 days</span>
          </div>
        </div>

        {/* Success Message */}
        {submitSuccess && (
          <Alert className="mb-8 border-green-200 bg-green-50 text-green-800">
            <Check className="h-4 w-4" />
            <AlertDescription>
              Your project request has been submitted! We'll contact you within 24 hours to discuss your requirements.
            </AlertDescription>
          </Alert>
        )}

        {/* Why You Need a Website */}
        <div className="mb-16">
          <h2 className="text-2xl sm:text-3xl font-semibold text-center mb-3">
            Why Your Business Needs a Website
          </h2>
          <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto">
            Stop losing money to competitors. Here's what a website does for you:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {benefits.map((benefit) => {
              const Icon = benefit.icon
              return (
                <Card key={benefit.title} className="p-6 hover:shadow-lg transition-shadow">
                  <Icon className="h-10 w-10 mb-3 text-primary" />
                  <h3 className="font-semibold text-lg mb-2">{benefit.title}</h3>
                  <p className="text-muted-foreground text-sm">{benefit.description}</p>
                </Card>
              )
            })}
          </div>
        </div>

        {/* ROI Section */}
        <div className="mb-16 bg-gradient-to-br from-primary/10 to-primary/5 dark:from-primary/20 dark:to-primary/10 rounded-2xl p-8 sm:p-12 border border-primary/20">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">
              How Much Money Can You Make?
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Real numbers from real businesses that invested in a website
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="p-6 text-center bg-white dark:bg-gray-800">
              <div className="text-3xl font-bold text-green-600 mb-2">₦600k+</div>
              <p className="text-sm text-muted-foreground">
                Extra sales yearly from just 5 new customers/month (₦150k website investment)
              </p>
            </Card>
            
            <Card className="p-6 text-center bg-white dark:bg-gray-800 border-2 border-primary">
              <div className="text-3xl font-bold text-primary mb-2">₦2M</div>
              <p className="text-sm text-muted-foreground">
                Made by our fashion store client in 6 months with online store (₦300k investment)
              </p>
            </Card>
            
            <Card className="p-6 text-center bg-white dark:bg-gray-800">
              <div className="text-3xl font-bold text-orange-600 mb-2">10x</div>
              <p className="text-sm text-muted-foreground">
                More customers trust businesses with professional websites vs those without
              </p>
            </Card>
          </div>
        </div>

        {/* Service Packages */}
        <div className="mb-16">
          <h2 className="text-2xl sm:text-3xl font-semibold text-center mb-3">
            Choose What's Right for Your Business
          </h2>
          <p className="text-center text-muted-foreground mb-8">
            All packages include FREE hosting for 1 year (₦12,000 value)
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {webServices.map((service) => (
              <Card 
                key={service.id} 
                className={`relative hover:shadow-lg transition-shadow ${
                  service.popular ? 'border-primary shadow-md' : ''
                }`}
              >
                {service.popular && (
                  <Badge className="absolute -top-2 left-1/2 transform -translate-x-1/2">
                    Most Popular
                  </Badge>
                )}
                
                <CardHeader className="text-center pb-4">
                  <CardTitle className="text-xl mb-2">{service.name}</CardTitle>
                  <p className="text-sm text-muted-foreground font-medium mb-3">{service.tagline}</p>
                  <div className="text-3xl font-bold text-primary">
                    ₦{service.price.toLocaleString()}
                  </div>
                  <CardDescription className="flex items-center justify-center gap-1 mt-2">
                    <Clock className="h-4 w-4" />
                    Ready in {service.duration}
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <div className="bg-green-50 dark:bg-green-950 p-3 rounded-lg border border-green-200 dark:border-green-800">
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      💰 {service.benefits}
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">What You Get:</p>
                    {service.features.map((feature, index) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  
                  <div className="pt-4 border-t space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {service.ideal}
                    </p>
                    <Button 
                      className="w-full"
                      onClick={() => handleServiceSelect(service.id)}
                    >
                      Start Your Project
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Contact Form */}
        {showForm && (
          <Card className="mb-16 border-2 border-primary/30">
            <CardHeader>
              <CardTitle className="text-2xl">Let's Build Your Money-Making Website!</CardTitle>
              <CardDescription className="text-base">
                Tell us about your business. We'll send you a custom plan within 24 hours (FREE, no commitment)
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number *</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="company">Company/Organization</Label>
                    <Input
                      id="company"
                      value={formData.company}
                      onChange={(e) => handleInputChange('company', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="budget">Budget Range</Label>
                    <Select value={formData.budget} onValueChange={(value) => handleInputChange('budget', value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select budget range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="under-100k">Under ₦100,000</SelectItem>
                        <SelectItem value="100k-300k">₦100,000 - ₦300,000</SelectItem>
                        <SelectItem value="300k-500k">₦300,000 - ₦500,000</SelectItem>
                        <SelectItem value="500k-1m">₦500,000 - ₦1,000,000</SelectItem>
                        <SelectItem value="above-1m">Above ₦1,000,000</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="timeline">Preferred Timeline</Label>
                    <Select value={formData.timeline} onValueChange={(value) => handleInputChange('timeline', value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="When do you need this?" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asap">ASAP (Rush job)</SelectItem>
                        <SelectItem value="1-2weeks">1-2 weeks</SelectItem>
                        <SelectItem value="3-4weeks">3-4 weeks</SelectItem>
                        <SelectItem value="1-2months">1-2 months</SelectItem>
                        <SelectItem value="flexible">I'm flexible</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">What does your business do? *</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    placeholder="Example: I sell clothes online, I'm a makeup artist, I run a restaurant..."
                    rows={4}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="features">What do you want the website to do?</Label>
                  <Textarea
                    id="features"
                    value={formData.features}
                    onChange={(e) => handleInputChange('features', e.target.value)}
                    placeholder="Example: Take orders, show my work, let customers book appointments, accept payments..."
                    rows={3}
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <Button type="submit" className="flex-1 h-12 text-base">
                    Get My FREE Quote
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowForm(false)}
                    className="h-12"
                  >
                    Cancel
                  </Button>
                </div>
                
                <p className="text-xs text-center text-muted-foreground">
                  🔒 Your information is safe. We never spam or share your details.
                </p>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Why Choose Us */}
        <div className="mb-16">
          <h2 className="text-2xl sm:text-3xl font-semibold text-center mb-8">
            Why Businesses Trust TallyStore
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="text-center p-6 hover:shadow-lg transition-shadow">
              <Zap className="h-12 w-12 text-primary mx-auto mb-4" />
              <h3 className="font-semibold text-lg mb-2">Lightning Fast</h3>
              <p className="text-muted-foreground text-sm">
                Your website ready in days, not months. Start making money faster
              </p>
            </Card>
            
            <Card className="text-center p-6 hover:shadow-lg transition-shadow">
              <Award className="h-12 w-12 text-primary mx-auto mb-4" />
              <h3 className="font-semibold text-lg mb-2">Proven Results</h3>
              <p className="text-muted-foreground text-sm">
                Our clients increase sales by 5-10x within months of launch
              </p>
            </Card>
            
            <Card className="text-center p-6 hover:shadow-lg transition-shadow">
              <MessageCircle className="h-12 w-12 text-primary mx-auto mb-4" />
              <h3 className="font-semibold text-lg mb-2">Always Available</h3>
              <p className="text-muted-foreground text-sm">
                WhatsApp support whenever you need help or changes
              </p>
            </Card>
          </div>
        </div>

        {/* Contact Information */}
        <Card className="border-2 border-primary/20">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl">Ready to Grow Your Business?</CardTitle>
            <CardDescription className="text-base">
              Let's talk about your project. Get a free quote in 24 hours!
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="flex flex-col items-center text-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-950 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <MessageCircle className="h-8 w-8 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1">Message Support</p>
                  <p className="text-xs text-muted-foreground mb-3">Get in touch about your project directly.</p>
                  {supportUrl ? (
                    <Button asChild variant="default" size="sm" className="mt-3 bg-emerald-600 hover:bg-emerald-700">
                      <a href={supportUrl} target="_blank" rel="noopener noreferrer">
                        Message us
                      </a>
                    </Button>
                  ) : (
                    <Button asChild variant="default" size="sm" className="mt-3 bg-emerald-600 hover:bg-emerald-700">
                      <a href="/support">Support Center</a>
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-center text-center gap-3 p-4 bg-muted rounded-lg">
                <Clock className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-semibold mb-1">Project Questions</p>
                  <p className="text-xs text-muted-foreground mb-3">Send your business name, project type, and timeline.</p>
                  {supportUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={supportUrl} target="_blank" rel="noopener noreferrer">
                        Message support
                      </a>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <a href="/support">Visit support</a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
            
            <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800 text-center">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                ⚡ Limited Offer: Book this month and get FREE logo design (₦15,000 value)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Footer />
    </div>
  )
}
