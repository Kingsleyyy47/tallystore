import { Button } from "@/components/ui/button"
import { ArrowRight, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

const HeroSection = () => {
  const scrollToServices = () => {
    const element = document.getElementById("services")
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
  }

  return (
    <section id="home" className="min-h-screen flex items-center justify-center bg-gradient-hero dark:bg-gradient-hero-dark relative overflow-hidden py-20">
      {/* Enhanced animated background elements */}
      <div className="absolute inset-0 opacity-20 dark:opacity-30">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/30 rounded-full blur-3xl animate-float"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary-glow/30 rounded-full blur-3xl animate-float delay-1000"></div>
        <div className="absolute top-3/4 left-1/2 w-48 h-48 bg-accent/20 rounded-full blur-2xl animate-float delay-2000"></div>
      </div>
      
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-primary/5 to-transparent"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Text Content */}
          <div className="text-center lg:text-left order-2 lg:order-1">
            {/* Brand Name with animation */}
            <div className="flex justify-center lg:justify-start mb-6 animate-fade-in">
              <span className="text-4xl font-bold bg-gradient-to-r from-white to-primary-glow bg-clip-text text-transparent">
                TallyStore
              </span>
            </div>

            {/* Sparkle icon with animation */}
            <div className="flex justify-center lg:justify-start mb-8 animate-bounce-in">
              <div className="p-4 bg-white/10 backdrop-blur-sm rounded-full border border-white/20 animate-glow-pulse">
                <Sparkles className="h-10 w-10 text-white animate-pulse" />
              </div>
            </div>

            {/* Main Headline with staggered animation */}
        {/* Main Headline with enhanced dark mode styling */}
        <h1 className="text-4xl sm:text-5xl lg:text-7xl font-display font-bold text-white mb-8 leading-tight animate-fade-in-up hero-text">
          <span className="block mb-2 drop-shadow-lg">Transform Your</span>
          <span className="block bg-gradient-to-r from-white via-primary-glow to-white bg-clip-text text-transparent animate-fade-in-up delay-300 drop-shadow-lg">
            Social Media Presence
          </span>
        </h1>            {/* Subheading with animation */}
            <p className="text-xl sm:text-2xl text-white/90 mb-12 max-w-2xl mx-auto lg:mx-0 leading-relaxed font-body animate-fade-in-up delay-500">
              Start building your online empire today with authentic, verified accounts across all major platforms.
            </p>

            {/* Call-to-Action Button with enhanced hover */}
            <div className="animate-scale-in delay-700 flex justify-center lg:justify-start gap-4">
              <Link to="/products">
                <Button 
                  variant="hero" 
                  size="lg" 
                  className="text-lg px-10 py-7 h-auto group font-semibold backdrop-blur-sm border border-white/20 hover:border-white/40 transform hover:scale-110 transition-all duration-500 animate-glow-pulse"
                >
                  Browse Products
                  <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-2 transition-transform duration-500" />
                </Button>
              </Link>
              
              <Button 
                variant="outline" 
                size="lg" 
                onClick={scrollToServices}
                className="text-lg px-10 py-7 h-auto font-semibold backdrop-blur-sm border border-white/20 hover:border-white/40 bg-white/10 text-white hover:bg-white/20 transition-all duration-500"
              >
                Learn More
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="mt-16 flex flex-wrap justify-center lg:justify-start items-center gap-8 text-white/70">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-sm">Instant Delivery</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                <span className="text-sm">Secure Checkout</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                <span className="text-sm">24/7 Support</span>
              </div>
            </div>
          </div>

          {/* Hero Image */}
          <div className="relative animate-scale-in delay-300 order-1 lg:order-2">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl">
              <img 
                src="/hero img.webp" 
                alt="TallyStore - Premium Social Media Accounts" 
                className="w-full h-auto object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/20 via-transparent to-transparent"></div>
            </div>
            {/* Floating elements */}
            <div className="absolute -top-6 -right-6 bg-gradient-primary text-white px-4 py-2 rounded-full shadow-lg animate-bounce-in delay-1000">
              <span className="font-bold text-sm">PREMIUM</span>
            </div>
            <div className="absolute -bottom-4 -left-4 bg-white/10 backdrop-blur-sm text-white px-4 py-2 rounded-full border border-white/20 animate-bounce-in delay-1200">
              <span className="font-semibold text-sm">Instant Access</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default HeroSection