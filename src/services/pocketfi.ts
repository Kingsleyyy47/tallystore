import { supabase } from '@/lib/supabase'

// PocketFi uses a PERMANENT VIRTUAL ACCOUNT model, not a hosted checkout like Ercas Pay.
// There is no "amount in, checkoutUrl out" call -- instead we ask once for a dedicated bank
// account number tied to the user, and they manually bank-transfer into it (any amount,
// any time). The edge function returns that account's details, not a redirect URL.

export interface GetOrCreateAccountInput {
  customerName?: string
  customerPhoneNumber?: string
}

export interface PocketFiAccount {
  accountNumber: string
  accountName: string
  bankName: string
}

export interface PocketFiAccountResponse {
  success: boolean
  message: string
  data?: PocketFiAccount
  error?: string
}

export const getOrCreatePocketFiAccount = async (
  input: GetOrCreateAccountInput = {}
): Promise<PocketFiAccountResponse> => {
  try {
    const { data, error } = await supabase.functions.invoke<PocketFiAccountResponse>(
      'create-pocketfi-topup',
      { body: input }
    )

    if (error) {
      // supabase-js's functions.invoke() does NOT automatically parse the JSON body of a
      // non-2xx response -- it just reports the generic "Edge Function returned a non-2xx
      // status code" message. The real reason our edge function gave (e.g. "Failed to
      // load profile: ...") is sitting in error.context as a raw Response, so we have to
      // read it ourselves to surface the actual cause instead of a useless generic string.
      let message = error.message || 'Failed to set up bank transfer account'
      const context = (error as any)?.context
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.clone().json()
          message = body?.message || body?.error || message
        } catch {
          // Body wasn't JSON or already consumed -- fall back to the generic message.
        }
      }
      throw new Error(message)
    }

    if (!data) {
      throw new Error('Payment service returned an empty response')
    }

    return data
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to set up bank transfer account',
      error: error.message,
    }
  }
}
