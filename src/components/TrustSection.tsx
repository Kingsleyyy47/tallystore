import { Card, CardContent } from "@/components/ui/card"
import { Shield, Zap, Clock, Headphones } from "lucide-react"
import { ScrollAnimationWrapper } from "@/components/ScrollAnimationWrapper"

const TrustSection = () => {
  const benefits = [
    {
      icon: Zap,
      title: "Instant Delivery",
      description: "Get your accounts within minutes of purchase"
    },
    {
      icon: Shield,
      title: "Secure & Safe",
      description: "All transactions are protected and encrypted"
    },
    {
      icon: Clock,
      title: "24/7 Availability",
      description: "Shop anytime, accounts delivered instantly"
    },
    {
      icon: Headphones,
      title: "Expert Support",
      description: "Professional customer service when you need it"
    }
  ]

  return (
    <section className="py-24 bg-gradient-to-br from-background via-primary/5 to-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-5 dark:opacity-10">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary rounded-full blur-3xl animate-float"></div>
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-accent rounded-full blur-3xl animate-float delay-1000"></div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Image Side */}
          <ScrollAnimationWrapper animation="slide-in-left">
            <div className="relative">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <img 
                  src="/NO MIDDLE MAN NEEDED, GET ACCOUNT IMMEDIATELY AFTER PAYMENT.webp" 
                  alt="No middleman needed - instant account delivery"
                  className="w-full h-auto object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-primary/20 via-transparent to-transparent"></div>
              </div>
              {/* Floating badge */}
              <div className="absolute -top-6 -right-6 bg-gradient-primary text-white px-6 py-3 rounded-full shadow-lg animate-glow-pulse">
                <span className="font-bold text-sm">DIRECT ACCESS</span>
              </div>
            </div>
          </ScrollAnimationWrapper>

          {/* Content Side */}
          <div className="space-y-8">
            <ScrollAnimationWrapper animation="slide-in-right">
              <div>
                <h2 className="text-4xl sm:text-5xl font-display font-bold text-foreground mb-6">
                  Why Choose TallyStore?
                </h2>
                <p className="text-xl text-muted-foreground font-body leading-relaxed">
                  Direct access to premium social media accounts with no intermediaries. 
                  Get what you pay for, instantly and securely.
                </p>
              </div>
            </ScrollAnimationWrapper>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {benefits.map((benefit, index) => {
                const IconComponent = benefit.icon
                return (
                  <ScrollAnimationWrapper 
                    key={benefit.title}
                    delay={index * 100}
                    animation="scale-in"
                  >
                    <Card className="group hover:shadow-elegant border-border/50 hover:border-primary/40 transition-all duration-500 cursor-pointer transform hover:scale-105 bg-gradient-card dark:bg-gradient-card-dark backdrop-blur-sm">
                      <CardContent className="p-6 text-center relative overflow-hidden">
                        {/* Background glow effect */}
                        <div className="absolute inset-0 bg-gradient-primary opacity-0 group-hover:opacity-5 transition-opacity duration-500 rounded-lg"></div>
                        
                        <div className="relative z-10">
                          <div className="flex justify-center mb-4">
                            <div className="p-3 bg-gradient-primary rounded-xl group-hover:shadow-glow group-hover:scale-110 transition-all duration-500">
                              <IconComponent className="h-6 w-6 text-white" />
                            </div>
                          </div>
                          <h3 className="text-lg font-display font-semibold text-foreground mb-2 group-hover:text-primary transition-colors duration-300">
                            {benefit.title}
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed font-body">
                            {benefit.description}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </ScrollAnimationWrapper>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default TrustSection
