import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className={cn("h-10 w-10 rounded-full", className)}>
        <div className="h-4 w-4" />
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className={cn("group relative h-10 w-10 overflow-hidden rounded-full border border-transparent backdrop-blur-sm transition-all duration-500 hover:scale-110 hover:border-primary/20 hover:bg-primary/10 dark:hover:bg-primary/20", className)}
    >
      {/* Background glow effect */}
      <div className="absolute inset-0 bg-gradient-primary opacity-0 group-hover:opacity-10 transition-opacity duration-500 rounded-full"></div>
      
      {/* Sun icon */}
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all duration-500 dark:-rotate-180 dark:scale-0 text-orange-500 dark:text-orange-400" />
      
      {/* Moon icon */}
      <Moon className="absolute h-4 w-4 rotate-180 scale-0 transition-all duration-500 dark:rotate-0 dark:scale-100 text-blue-600 dark:text-blue-400" />
      
      {/* Animated ring */}
      <div className="absolute inset-0 rounded-full border border-primary/0 group-hover:border-primary/30 transition-all duration-500 scale-110 group-hover:scale-125"></div>
      
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
