import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/SimpleAuth'

interface ProtectedRouteProps {
  children: ReactNode
  redirectTo?: string
  requireRole?: 'user' | 'admin' | 'staff'
}

export function ProtectedRoute({ children, redirectTo = '/login', requireRole }: ProtectedRouteProps) {
  const { user, loading, isAdmin, isStaff } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!user) return <Navigate to={redirectTo} replace />

  if (requireRole === 'admin' && !isAdmin) {
    // Staff members trying to hit /admin get sent to their own page
    if (isStaff) return <Navigate to="/staff-admin" replace />
    return <Navigate to="/dashboard" replace />
  }

  if (requireRole === 'staff' && !isStaff && !isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

interface PublicRouteProps {
  children: ReactNode
  redirectTo?: string
}

export function PublicRoute({ children, redirectTo }: PublicRouteProps) {
  const { user, loading, isAdmin, isStaff } = useAuth()

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  // Already authenticated - redirect to appropriate dashboard
  if (user) {
    const defaultRedirect = isAdmin ? '/admin' : isStaff ? '/staff-admin' : '/dashboard'
    return <Navigate to={redirectTo || defaultRedirect} replace />
  }

  return <>{children}</>
}
