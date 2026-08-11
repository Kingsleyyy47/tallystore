import { supabase } from '@/lib/supabase'

export interface PaymentData {
  amount: number
  customerName: string
  customerEmail: string
  customerPhoneNumber?: string
  description?: string
  redirectUrl?: string
  metadata?: Record<string, any>
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

export const initiatePayment = async (paymentData: PaymentData): Promise<PaymentResponse> => {
  try {
    const { data, error } = await supabase.functions.invoke<PaymentResponse>('create-wallet-topup', {
      body: paymentData,
    })

    if (error) {
      throw new Error(error.message || 'Failed to initiate payment')
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
      throw new Error(error.message || 'Verification failed')
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
