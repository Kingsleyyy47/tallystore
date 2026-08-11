import { useEffect, useRef, useState } from "react"

interface ScrollAnimationWrapperProps {
  children: React.ReactNode
  className?: string
  animation?: "fade-in" | "fade-in-up" | "scale-in" | "slide-in-left" | "slide-in-right"
  delay?: number
}

export function ScrollAnimationWrapper({ 
  children, 
  className = "", 
  animation = "fade-in-up",
  delay = 0 
}: ScrollAnimationWrapperProps) {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            setIsVisible(true)
          }, delay)
        }
      },
      {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
      }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current)
      }
    }
  }, [delay])

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${
        isVisible 
          ? `animate-${animation} opacity-100` 
          : "opacity-0 translate-y-8"
      } ${className}`}
    >
      {children}
    </div>
  )
}