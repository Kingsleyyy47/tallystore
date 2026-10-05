import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '@/contexts/SimpleAuth'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

const supplierNames: Record<string, string> = { muabanvia: 'MuaBanVia', shopclone: 'ShopClone', shopviaclone: 'ShopViaClone', bitrefill: 'Bitrefill (international airtime)' }
type SupplierAlert = { provider: string; last_seen_at: string }

export default function SupplierWarningDialog() {
  const { user, loading, isAdmin, isStaff, accountSuspended, roleLookupError } = useAuth()
  const eligible = !!user?.id && !loading && !roleLookupError && !accountSuspended && (isAdmin || isStaff)
  const [alerts, setAlerts] = useState<SupplierAlert[]>([])
  const [open, setOpen] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!eligible || !user?.id) return
    let active = true
    let lastVersion = ''
    setAlerts([])
    setOpen(false)
    setUnavailable(false)
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('manage-staff', { body: { action: 'supplier_balance_alerts' } })
        if (!active) return
        if (error || !Array.isArray(data?.alerts)) { setUnavailable(true); return }
        setUnavailable(false)
        const safeAlerts: SupplierAlert[] = data.alerts.filter((alert: SupplierAlert) => supplierNames[alert?.provider] && typeof alert.last_seen_at === 'string')
        setAlerts(safeAlerts)
        const version = safeAlerts.map(alert => `${alert.provider}:${alert.last_seen_at}`).join('|')
        if (version && version !== lastVersion) setOpen(true)
        if (!version) setOpen(false)
        lastVersion = version
      } catch { if (active) setUnavailable(true) }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60000)
    return () => { active = false; window.clearInterval(timer) }
  }, [user?.id, eligible])

  if (!eligible) return null
  if (!alerts.length) return unavailable ? <p role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-3xl rounded-lg border border-amber-500/40 bg-background p-3 text-sm shadow-lg">Supplier warning status could not be checked. It will retry automatically.</p> : null
  const names = alerts.map(alert => supplierNames[alert.provider]).join(', ')
  return <>
    <div role="alert" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-lg border-2 border-red-500 bg-background p-4 text-red-600 shadow-xl dark:text-red-300">
      <AlertTriangle className="h-7 w-7 shrink-0" aria-hidden="true" />
      <p className="flex-1 font-semibold">Supplier balance needs attention. Inform the store owner: {names}.</p>
      <Button variant="destructive" onClick={() => setOpen(true)}>View warning</Button>
    </div>
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-h-[90dvh] max-w-3xl overflow-y-auto border-2 border-red-500 p-6 sm:p-10">
        <AlertDialogHeader>
          <AlertTriangle className="mb-4 h-16 w-16 text-red-500" aria-hidden="true" />
          <AlertDialogTitle className="text-2xl sm:text-4xl">Supplier balance is too low</AlertDialogTitle>
          <AlertDialogDescription className="pt-4 text-base sm:text-xl">Inform the store owner now. {names} reported insufficient balance to supply products. API delivery from the affected supplier may fail until the owner tops up the supplier account.</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="rounded-lg bg-red-500/10 p-4 font-semibold">Customer wallet balances and supplier balances are separate. The owner needs to check the supplier account.</p>
        <AlertDialogFooter><AlertDialogAction className="h-12 bg-red-600 px-6 text-base hover:bg-red-700">I understand — inform the owner</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
