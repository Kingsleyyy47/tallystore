import NavbarAuth from "@/components/NavbarAuth"
import HeroSection from "@/components/HeroSection"
import ServicesSection from "@/components/ServicesSection"
import HowItWorksSection from "@/components/HowItWorksSection"
import TrustSection from "@/components/TrustSection"
import Footer from "@/components/Footer"
import StatsBar from "@/components/StatsBar"

const Index = () => {
  return (
    <div className="min-h-screen">
      <NavbarAuth />

      <HeroSection />

      <div className="container mx-auto px-6 -mt-8 mb-12 relative z-10">
        <StatsBar />
      </div>

      <ServicesSection />
      <HowItWorksSection />
      <TrustSection />
      <Footer />
    </div>
  );
};

export default Index;
