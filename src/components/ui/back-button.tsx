import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

interface BackButtonProps {
  /** 
   * Custom text for the back button 
   * @default "Back"
   */
  text?: string
  /** 
   * Specific route to navigate to. If not provided, uses browser history 
   */
  to?: string
  /** 
   * Button variant 
   * @default "outline"
   */
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  /** 
   * Additional CSS classes 
   */
  className?: string
  /** 
   * Fallback route if browser history is empty 
   * @default "/"
   */
  fallback?: string
}

export function BackButton({ 
  text = "Back", 
  to, 
  variant = "outline", 
  className = "",
  fallback = "/" 
}: BackButtonProps) {
  const navigate = useNavigate()

  const handleBack = () => {
    if (to) {
      // Navigate to specific route
      navigate(to)
    } else {
      // Use browser history, with fallback
      if (window.history.length > 1) {
        navigate(-1)
      } else {
        navigate(fallback)
      }
    }
  }

  return (
    <Button 
      variant={variant} 
      onClick={handleBack}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <ArrowLeft className="h-4 w-4" />
      {text}
    </Button>
  )
}

// Specialized back buttons for common use cases
export function BackToHome() {
  return <BackButton text="Back to Home" to="/" />
}

export function BackToProducts() {
  return <BackButton text="Back to Products" to="/products" />
}

export function BackToCategories() {
  return <BackButton text="Back to Categories" to="/products" />
}

export function BackToDashboard() {
  return <BackButton text="Back to Dashboard" to="/dashboard" />
}
