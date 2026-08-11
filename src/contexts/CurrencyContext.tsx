import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useExchangeRate } from '@/hooks/useExchangeRate'

export type Currency = 'NGN' | 'USD'

const STORAGE_KEY = 'tallystore_currency'

interface CurrencyContextValue {
  currency: Currency
  setCurrency: (c: Currency) => void
  toggleCurrency: () => void
  rate: number
  rateLoading: boolean
  /** Converts an NGN amount to the currently selected display currency (raw number). */
  convert: (ngnAmount: number) => number
  /** Formats an NGN amount as a price string in the currently selected currency, e.g. "₦1,500" or "$0.94". */
  formatPrice: (ngnAmount: number) => string
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined)

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { rate, loading: rateLoading, ngnToUsd } = useExchangeRate()
  const [currency, setCurrencyState] = useState<Currency>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved === 'USD' ? 'USD' : 'NGN'
    } catch {
      return 'NGN'
    }
  })

  const setCurrency = (c: Currency) => {
    setCurrencyState(c)
    try {
      localStorage.setItem(STORAGE_KEY, c)
    } catch {
      // ignore storage errors
    }
  }

  const toggleCurrency = () => setCurrency(currency === 'NGN' ? 'USD' : 'NGN')

  const convert = (ngnAmount: number) => (currency === 'USD' ? ngnToUsd(ngnAmount) : ngnAmount)

  const formatPrice = (ngnAmount: number) => {
    if (currency === 'USD') {
      return `$${ngnToUsd(ngnAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    return `₦${ngnAmount.toLocaleString()}`
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, toggleCurrency, rate, rateLoading, convert, formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) {
    throw new Error('useCurrency must be used within a CurrencyProvider')
  }
  return ctx
}
