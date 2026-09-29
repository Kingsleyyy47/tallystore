export async function assertPurchasingCustomer(admin: any, userId: string, req?: Request | null) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('is_staff, is_admin, account_suspended')
    .eq('id', userId)
    .single()

  if (error) {
    throw new Error('Could not verify purchase permission')
  }

  if (profile?.is_staff || profile?.is_admin) {
    throw new Error('Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.')
  }

  if (profile?.account_suspended) {
    throw new Error('Purchasing is paused while this wallet is under security review. Please contact support.')
  }
}
