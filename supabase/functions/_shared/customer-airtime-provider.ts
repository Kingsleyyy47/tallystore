import { safeId } from './customer-airtime-contract.ts'

// Fixed official Bitrefill origin. Keep the bearer token in Supabase secrets.
const ORIGIN = 'https://api.bitrefill.com/v2'

export class AirtimeProvider {
  constructor(private readonly token: string, private readonly doFetch: typeof fetch = fetch) {
    if (!token) throw new Error('Provider unavailable')
  }

  private async call(path: string, body?: unknown): Promise<any> {
    const response = await this.doFetch(`${ORIGIN}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(body === undefined ? 12000 : 20000),
    })
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`)
    return response.json()
  }

  checkPhone(phone: string) {
    return this.call(`/check_phone_number?phone_number=${encodeURIComponent(phone)}`)
  }

  balance() {
    return this.call('/accounts/balance')
  }

  product(id: string) {
    if (!safeId(id)) throw new Error('Invalid product')
    return this.call(`/products/${encodeURIComponent(id)}`)
  }

  createUnpaidInvoice(productId: string, packageId: string | null, value: number, phone: string) {
    const item: Record<string, unknown> = { product_id: productId, phone_number: phone, quantity: 1 }
    if (packageId) item.package_id = packageId
    else item.value = value
    return this.call('/invoices', { products: [item], payment_method: 'balance', auto_pay: false })
  }

  pay(invoiceId: string) {
    if (!safeId(invoiceId)) throw new Error('Invalid invoice')
    // Sending this request is irreversible. Callers must claim exactly once.
    return this.call(`/invoices/${encodeURIComponent(invoiceId)}/pay`, {})
  }

  invoice(invoiceId: string) {
    if (!safeId(invoiceId)) throw new Error('Invalid invoice')
    return this.call(`/invoices/${encodeURIComponent(invoiceId)}`)
  }

  order(orderId: string) {
    if (!safeId(orderId)) throw new Error('Invalid order')
    return this.call(`/orders/${encodeURIComponent(orderId)}`)
  }
}
