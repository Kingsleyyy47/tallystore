import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/SimpleAuth'
import { Button } from '@/components/ui/button'

interface ProtectedRouteProps {
  children: ReactNode
  redirectTo?: string
  requireRole?: 'user' | 'admin' | 'staff'
}

function RoleLookupUnavailable({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p role="alert">{message}</p>
      <Button type="button" onClick={() => void retry()}>Retry</Button>
    </div>
  )
}

export function ProtectedRoute({ children, redirectTo = '/login', requireRole }: ProtectedRouteProps) {
  const { user, loading, isAdmin, isStaff, roleLookupError, retryRoleLookup } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!user) return <Navigate to={redirectTo} replace />
  if (roleLookupError) {
    return <RoleLookupUnavailable message={roleLookupError} retry={retryRoleLookup} />
  }

  if (requireRole === 'user' && isAdmin) return <Navigate to="/admin" replace />
  if (requireRole === 'user' && isStaff) return <Navigate to="/staff-admin" replace />

  if (requireRole === 'admin' && !isAdmin) {
    // Staff members trying to hit /admin get sent to their own page
    if (isStaff) return <Navigate to="/staff-admin" replace />
    return <Navigate to="/dashboard" replace />
  }

  if (requireRole === 'staff' && isAdmin) return <Navigate to="/admin" replace />

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
  const { user, loading, isAdmin, isStaff, roleLookupError, retryRoleLookup } = useAuth()

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
    if (roleLookupError) return <RoleLookupUnavailable message={roleLookupError} retry={retryRoleLookup} />
    const defaultRedirect = isAdmin ? '/admin' : isStaff ? '/staff-admin' : '/dashboard'
    return <Navigate to={redirectTo || defaultRedirect} replace />
  }

  return <>{children}</>
}
