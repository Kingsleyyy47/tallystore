async function purchaseGuardSha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cleanPurchaseGuardIp(value: string | null) {
  if (!value) return null
  const first = value.split(',')[0]?.trim() || ''
  const withoutPort = first.includes('.') ? first.replace(/:\d+$/, '') : first
  const cleaned = withoutPort.replace(/[^a-fA-F0-9:.[\]]/g, '').replace(/^\[|\]$/g, '')
  if (!cleaned || cleaned.length > 80) return null
  return cleaned
}

function getPurchaseGuardIp(req?: Request | null) {
  if (!req) return null
  return cleanPurchaseGuardIp(
    req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for') ||
      req.headers.get('forwarded')?.match(/for="?([^";,]+)"?/i)?.[1] ||
      null,
  )
}

function getPurchaseGuardUserAgent(req?: Request | null) {
  return Array.from(String(req?.headers.get('user-agent') || '')).filter((char) => {
    const code = char.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('').trim().slice(0, 500)
}

async function assertFraudDeviceNotBanned(admin: any, req?: Request | null) {
  const ipAddress = getPurchaseGuardIp(req)
  const userAgent = getPurchaseGuardUserAgent(req)
  const userAgentHash = userAgent ? await purchaseGuardSha256Hex(userAgent) : null

  if (ipAddress) {
    const { data, error } = await admin
      .from('fraud_device_bans')
      .select('id')
      .eq('active', true)
      .eq('ip_address', ipAddress)
      .limit(1)

    if (!error && data && data.length > 0) {
      throw new Error('This device or network has been blocked from purchasing. Please contact support.')
    }
  }

  if (userAgentHash) {
    const { data, error } = await admin
      .from('fraud_device_bans')
      .select('id')
      .eq('active', true)
      .eq('user_agent_hash', userAgentHash)
      .limit(1)

    if (!error && data && data.length > 0) {
      throw new Error('This device or network has been blocked from purchasing. Please contact support.')
    }
  }
}

export async function assertPurchasingCustomer(admin: any, userId: string, req?: Request | null) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('is_staff, is_admin, account_suspended, wallet_review_required')
    .eq('id', userId)
    .single()

  if (error) {
    throw new Error('Could not verify purchase permission')
  }

  if (profile?.is_staff || profile?.is_admin) {
    throw new Error('Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.')
  }

  if (profile?.account_suspended || profile?.wallet_review_required) {
    throw new Error('Purchasing is paused while this wallet is under security review. Please contact support.')
  }

  await assertFraudDeviceNotBanned(admin, req)
}
