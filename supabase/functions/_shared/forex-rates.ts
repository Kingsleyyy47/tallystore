/**
 * Forex Rate Helper
 * Gets live USD to NGN exchange rate from a reliable source
 */

/**
 * Get current USD to NGN exchange rate
 * Uses multiple fallback sources for reliability
 */
export async function getUsdToNgnRate(): Promise<number> {
  try {
    // Try primary source: exchangerate-api.com (free tier: 1500 requests/month)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    
    if (!response.ok) {
      throw new Error(`Exchange rate API failed: ${response.status}`);
    }

    const data = await response.json();
    const ngnRate = data.rates?.NGN;

    if (!ngnRate || ngnRate <= 0) {
      throw new Error('Invalid NGN rate in response');
    }

    console.log(`✅ Live USD/NGN rate: 1 USD = ₦${ngnRate.toFixed(2)}`);
    return ngnRate;

  } catch (error) {
    console.error('⚠️ Failed to fetch live forex rate:', error);
    
    // Fallback to conservative estimate if API fails
    // Using 1650 as fallback (update this periodically)
    const fallbackRate = 1650;
    console.log(`⚠️ Using fallback rate: 1 USD = ₦${fallbackRate}`);
    return fallbackRate;
  }
}

/**
 * Convert USD to NGN using live rate
 */
export async function convertUsdToNgn(usdAmount: number): Promise<number> {
  const rate = await getUsdToNgnRate();
  return usdAmount * rate;
}

/**
 * Convert NGN to USD using live rate
 */
export async function convertNgnToUsd(ngnAmount: number): Promise<number> {
  const rate = await getUsdToNgnRate();
  return ngnAmount / rate;
}
