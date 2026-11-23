export type CustomerMarkupRule = {
  mode: 'amount' | 'percent'
  value: number
  source: 'global' | 'product' | 'denomination'
  legacy_pricing: boolean
}

export async function loadSmsProductSettings(admin: any, serviceCodes: string[]): Promise<Array<{ service_code: string; [key: string]: any }>> {
  const codes=[...new Set(serviceCodes)];
  if(!codes.length) return [];
  const {data,error}=await admin.rpc('get_sms_catalog_settings',{p_service_codes:codes});
  if(error || !Array.isArray(data)) throw new Error('SMS product settings are temporarily unavailable');
  const requested=new Set(codes), seen=new Set<string>();
  for(const row of data) {
    if(!row || typeof row.service_code!=='string' || !requested.has(row.service_code) || seen.has(row.service_code)) throw new Error('SMS product settings are temporarily unavailable');
    seen.add(row.service_code);
  }
  return data;
}

// This rule is loaded by the server. Browser-supplied prices and markups are never used.
export function customerMarkupPrice(costNgn: number, rule: CustomerMarkupRule): number {
  if (!Number.isFinite(costNgn) || costNgn < 0 || !Number.isFinite(rule.value) || rule.value < 0
    || !['amount', 'percent'].includes(rule.mode)) throw new Error('Invalid customer pricing')
  const costMinor = Math.round(costNgn * 100)
  const valueMinor = Math.round(rule.value * 100)
  if (!Number.isSafeInteger(costMinor) || !Number.isSafeInteger(valueMinor)
    || Math.abs(costNgn * 100 - costMinor) > 0.00001
    || Math.abs(rule.value * 100 - valueMinor) > 0.00001) throw new Error('Invalid customer pricing')
  // Integer arithmetic prevents 100 × 1.1 floating-point noise becoming ₦120.
  const numerator = rule.mode === 'amount' ? BigInt(costMinor) + BigInt(valueMinor)
    : BigInt(costMinor) * (10000n + BigInt(valueMinor))
  const divisor = rule.mode === 'amount' ? 1000n : 10000000n
  const rounded = Number((numerator + divisor - 1n) / divisor) * 10
  if (!Number.isSafeInteger(rounded) || rounded <= 0 || rounded > 100000000) throw new Error('Invalid customer pricing')
  return rounded
}

export async function loadSmsMarkupRules(
  admin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  serviceCodes: string[],
): Promise<Map<string, CustomerMarkupRule>> {
  const rules = new Map<string, CustomerMarkupRule>()
  const uniqueCodes = [...new Set(serviceCodes)]
  for (let offset = 0; offset < uniqueCodes.length; offset += 500) {
    const codes = uniqueCodes.slice(offset, offset + 500)
    // SMS overrides are per service, not per changing supplier denomination.
    const { data, error } = await admin.rpc('get_customer_bitrefill_pricing_batch', {
      p_kind: 'sms',
      p_selectors: codes.map(product_id => ({ product_id, package_id: null, unit_value: 1, currency: 'USD' })),
    })
    const result = data as { success?: boolean; prices?: Array<Record<string, unknown>> } | null
    if (error || result?.success !== true || !Array.isArray(result.prices) || result.prices.length !== codes.length) {
      throw new Error('SMS pricing is temporarily unavailable')
    }
    for (const row of result.prices) {
      const code = String(row.product_id ?? '')
      if (!codes.includes(code) || rules.has(code) || !['amount', 'percent'].includes(String(row.mode))
        || !['global', 'product', 'denomination'].includes(String(row.source))
        || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0
        || typeof row.legacy_pricing !== 'boolean') throw new Error('SMS pricing is temporarily unavailable')
      rules.set(code, {
        mode: row.mode as CustomerMarkupRule['mode'], value: row.value,
        source: row.source as CustomerMarkupRule['source'], legacy_pricing: row.legacy_pricing,
      })
    }
  }
  return rules
}
