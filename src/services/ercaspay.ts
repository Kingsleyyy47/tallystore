import { supabase } from '@/lib/supabase'

export interface PaymentData {
  amount: number
  customerName: string
  customerEmail: string
  customerPhoneNumber?: string
  description?: string
  redirectUrl?: string
  metadata?: Record<string, any>
  revenue_context?: Record<string, unknown>
}

export interface PaymentResponse {
  success: boolean
  message: string
  data?: {
    paymentReference: string
    transactionReference: string
    checkoutUrl: string
  }
  error?: string
}

export interface TransactionVerification {
  success: boolean
  status: string
  amount: number
  customerEmail: string
  paidAt?: string
  transactionReference: string
  error?: string
}

async function getFunctionErrorMessage(error: any, fallback: string) {
  let message = error?.message || fallback
  const context = error?.context
  if (context && typeof context.clone === 'function') {
    try {
      const body = await context.clone().json()
      message = body?.error || body?.message || message
    } catch {
      try {
        const text = await context.clone().text()
        if (text) message = text
      } catch {
        // Keep the Supabase client error if the function body is unavailable.
      }
    }
  }
  return message
}

export const initiatePayment = async (paymentData: PaymentData): Promise<PaymentResponse> => {
  try {
    const { data, error } = await supabase.functions.invoke<PaymentResponse>('create-wallet-topup', {
      body: paymentData,
    })

    if (error) {
      throw new Error(await getFunctionErrorMessage(error, 'Failed to initiate payment'))
    }

    if (!data) {
      throw new Error('Payment service returned an empty response')
    }

    return data
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to initiate payment',
      error: error.message,
    }
  }
}

export const verifyPayment = async (transactionReference: string): Promise<TransactionVerification> => {
  try {
    const { data, error } = await supabase.functions.invoke<any>('verify-and-credit-wallet', {
      body: { transaction_reference: transactionReference },
    })

    if (error) {
      throw new Error(await getFunctionErrorMessage(error, 'Verification failed'))
    }

    if (!data?.success) {
      return {
        success: false,
        status: data?.status || 'failed',
        amount: data?.amount || 0,
        customerEmail: '',
        transactionReference,
        error: data?.error || 'Transaction verification failed',
      }
    }

    return {
      success: true,
      status: 'success',
      amount: data.amount || 0,
      customerEmail: '',
      transactionReference,
    }
  } catch (error: any) {
    return {
      success: false,
      status: 'error',
      amount: 0,
      customerEmail: '',
      transactionReference,
      error: error.message || 'Verification failed',
    }
  }
}
