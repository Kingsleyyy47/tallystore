/**
 * Server-side NGN/USD exchange rate resolution for Edge Functions.
 * Mirrors the client-side logic in src/hooks/useExchangeRate.ts:
 * priority = admin override (app_settings.ngn_usd_rate) -> live API.
 *
 * Edge functions can't import from src/, so this is a small standalone copy.
 */

const LIVE_RATE_URL = 'https://open.er-api.com/v6/latest/USD';

export async function getNgnUsdRate(supabaseAdmin: any): Promise<{ rate: number; source: 'override' | 'live' }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'ngn_usd_rate')
      .single();

    if (!error && data?.value) {
      const parsed = parseFloat(data.value);
      if (!isNaN(parsed) && parsed > 0) {
        return { rate: parsed, source: 'override' };
      }
    }
  } catch (_err) {
    // fall through to live rate
  }

  try {
    const res = await fetch(LIVE_RATE_URL);
    const json = await res.json();
    const liveRate = json?.rates?.NGN;
    if (liveRate && typeof liveRate === 'number' && liveRate > 0) {
      return { rate: liveRate, source: 'live' };
    }
  } catch (_err) {
    // handled below
  }

  throw new Error('NGN/USD exchange rate is temporarily unavailable. Set ngn_usd_rate in app settings or try again when the live rate service is reachable.');
}

/** Convert an amount in `currency` (currently only USD is supported) to NGN. */
export async function convertToNgn(amount: number, currency: string, supabaseAdmin: any): Promise<number> {
  if (currency.toUpperCase() !== 'USD') {
    throw new Error(`Unsupported currency for conversion: ${currency}`);
  }
  const { rate } = await getNgnUsdRate(supabaseAdmin);
  return amount * rate;
}
