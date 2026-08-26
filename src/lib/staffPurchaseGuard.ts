import type { ReactNode } from 'react'

type ToastFn = (props: {
  title?: ReactNode
  description?: ReactNode
  variant?: 'default' | 'destructive'
}) => void

export function blockStaffPurchase(isStaff: boolean, isAdmin: boolean, toast: ToastFn) {
  if (!isStaff && !isAdmin) return false

  toast({
    title: 'Purchase blocked',
    description: 'Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.',
    variant: 'destructive',
  })

  return true
}
