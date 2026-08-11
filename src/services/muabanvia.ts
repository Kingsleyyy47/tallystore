import { supabase } from '@/lib/supabase'

export interface MuaBanViaAccount {
  username: string
  password: string
  email?: string
  email_password?: string
  two_fa_code?: string
  additional_info?: Record<string, any>
}

export interface MuaBanViaFulfillResponse {
  success: boolean
  message: string
  data?: { accounts: MuaBanViaAccount[] }
  error?: string
}

// Calls the muabanvia-fulfill Supabase edge function to live-purchase `quantity`
// accounts for the given MuaBanVia product id. Used as a fallback by processBulkPurchase
// when pre-stocked individual_accounts inventory runs short for a product group that has
// auto_fulfill_enabled + muabanvia_product_id configured.
export const fulfillFromMuaBanVia = async (
  muabanviaProductId: string,
  quantity: number,
): Promise<MuaBanViaFulfillResponse> => {
  try {
    const { data, error } = await supabase.functions.invoke<MuaBanViaFulfillResponse>(
      'muabanvia-fulfill',
      { body: { muabanviaProductId, quantity } },
    )
    if (error) throw new Error(error.message || 'Failed to fulfill order via MuaBanVia')
    if (!data) throw new Error('Fulfillment service returned an empty response')
    return data
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to fulfill order via MuaBanVia',
      error: error.message,
    }
  }
}
