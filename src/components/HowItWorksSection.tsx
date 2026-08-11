import { Card, CardContent } from "@/components/ui/card"
import { Search, MessageCircle, Shield, Smile } from "lucide-react"
import { ScrollAnimationWrapper } from "@/components/ScrollAnimationWrapper"

const HowItWorksSection = () => {
  const steps = [
    {
      step: "Step 1: Explore",
      title: "Explore",
      description: "Dive into our store and discover a world of unique products.",
      icon: Search,
      color: "from-blue-500 to-blue-600"
    },
    {
      step: "Step 2: Connect", 
      title: "Connect",
      description: "Communicate directly with us to ask questions or discuss customization.",
      icon: MessageCircle,
      color: "from-green-500 to-green-600"
    },
    {
      step: "Step 3: Secure Checkout",
      title: "Secure Checkout", 
      description: "Proceed to our secure checkout. Your payment is protected.",
      icon: Shield,
      color: "from-purple-500 to-purple-600"
    },
    {
      step: "Step 4: Enjoy",
      title: "Enjoy",
      description: "Sit back and relax as you receive your account logins instantly.",
      icon: Smile,
      color: "from-orange-500 to-orange-600"
    }
  ]

  return (
    <section id="how-it-works" className="py-24 bg-gradient-to-br from-background via-muted/20 to-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-5 dark:opacity-10">
        <div className="absolute top-0 left-1/4 w-72 h-72 bg-primary rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent rounded-full blur-3xl"></div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <ScrollAnimationWrapper>
          <div className="text-center mb-20">
            <h2 className="text-4xl sm:text-5xl font-display font-bold text-foreground mb-6">
              How It Works
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto font-body leading-relaxed">
              Simple steps to get your social media accounts up and running
            </p>
          </div>
        </ScrollAnimationWrapper>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
          {steps.map((step, index) => {
            const IconComponent = step.icon
            return (
              <div key={step.step} className="relative">
                {/* Enhanced connection line for desktop */}
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-20 left-full w-full h-0.5 bg-gradient-to-r from-primary via-primary/50 to-transparent z-0">
                    <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                  </div>
                )}
                
                <ScrollAnimationWrapper 
                  delay={index * 150}
                  animation="fade-in-up"
                >
                  <Card className="relative z-10 group hover:shadow-elegant border-border/50 hover:border-primary/40 transition-all duration-500 transform hover:scale-105 hover:-translate-y-3 bg-gradient-card dark:bg-gradient-card-dark backdrop-blur-sm h-full">
                    <CardContent className="p-8 text-center relative overflow-hidden">
                      {/* Background glow effect */}
                      <div className="absolute inset-0 bg-gradient-primary opacity-0 group-hover:opacity-5 transition-opacity duration-500 rounded-lg"></div>
                      
                      <div className="relative z-10">
                        {/* Step number with enhanced styling */}
                        <div className="text-sm font-bold text-primary mb-6 px-3 py-1 bg-primary/10 rounded-full inline-block">
                          {step.step}
                        </div>
                        
                        {/* Icon with enhanced animations */}
                        <div className="flex justify-center mb-8">
                          <div className={`p-5 bg-gradient-to-r ${step.color} rounded-2xl group-hover:shadow-glow group-hover:scale-110 transition-all duration-500 animate-glow-pulse`}>
                            <IconComponent className="h-10 w-10 text-white" />
                          </div>
                        </div>
                        
                        {/* Title */}
                        <h3 className="text-xl font-display font-semibold text-foreground mb-4 group-hover:text-primary transition-colors duration-300">
                          {step.title}
                        </h3>
                        
                        {/* Description */}
                        <p className="text-muted-foreground leading-relaxed font-body">
                          {step.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </ScrollAnimationWrapper>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default HowItWorksSection