type SocialBoostAction = 'purchase' | 'status';

const MAX_ERROR_BYTES = 16_384;
const ERROR_READ_TIMEOUT_MS = 1_500;
const AUTH_MESSAGE = 'Please sign in again, then check your order history before placing another order.';

const PUBLIC_MESSAGES = new Set([
  'Service not found or inactive',
  'Quantity must be a whole number',
  'This service is temporarily unavailable. Please choose another service.',
  'Please check the order details.',
  'Please enter a valid web link.',
  'Current displayed price is required. Please refresh and try again.',
  'Price changed. Please refresh and try again.',
  'Insufficient verified funds for purchase',
  'Purchasing is paused while this wallet is under security review. Please contact support.',
  'Staff and admin accounts can browse and check out, but only customer accounts can complete purchases.',
  'This device or network has been blocked from purchasing. Please contact support.',
  'You already have an active order for this link. Check its status before placing another.',
  'This order failed previously. Check its refund status before placing another order.',
  'Order not found',
  'Order status is temporarily unavailable. Please try again later.',
]);

function publicMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as { code?: unknown; error?: unknown; message?: unknown };
  // Translate only known public codes. Never display arbitrary provider/database text.
  switch (body.code) {
    case 'SMM_ORDERS_PAUSED':
      return 'Social Boost ordering is temporarily paused. Please contact support.';
    case 'SMM_SUPPLIER_OUTCOME_UNKNOWN':
    case 'SMM_DISPATCH_STATUS_UNCONFIRMED':
    case 'SMM_DEBIT_PROOF_UNCONFIRMED':
    case 'SMM_LOCAL_ORDER_UNCONFIRMED':
      return 'Your order is under review. Check order history and contact support; do not place it again.';
    case 'SMM_PURCHASE_LEDGER_ORPHANED':
      return 'This purchase needs support review before it can be retried. Check your order history.';
    case 'IDEMPOTENCY_REQUEST_CONFLICT':
      return 'This purchase request was already used. Check your order history before placing another order.';
  }
  const message = typeof body.error === 'string' ? body.error : body.message;
  if (message === 'Unauthorized' || message === 'Missing authorization header' || message === 'Invalid JWT') {
    return AUTH_MESSAGE;
  }
  if (typeof message !== 'string' || message.length > 250) return null;
  if (PUBLIC_MESSAGES.has(message)) return message;
  if (/^(Minimum|Maximum) quantity is \d{1,12}$/.test(message)) return message;
  return null;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const clone = response.clone();
  const reader = clone.body?.getReader();
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Error response read timed out')), ERROR_READ_TIMEOUT_MS);
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_ERROR_BYTES) return null;
      chunks.push(value);
    }
    const payload = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(payload));
  } finally {
    clearTimeout(timer);
    // A tee'd Response clone may wait for its other branch when cancelled.
    // Do not await cancellation or consume the SDK's original response.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Decode SDK FunctionsHttpError.context without leaking internals or retrying a purchase. */
export async function readSocialBoostFunctionError(error: unknown, action: SocialBoostAction): Promise<string> {
  const fallback = action === 'purchase'
    ? 'Could not confirm this order. Check your order history before placing it again, or contact support.'
    : 'Order status is temporarily unavailable. Please try again later.';
  if (error && typeof error === 'object' && 'context' in error && error.context instanceof Response) {
    const response = error.context;
    if (response.status === 401) return AUTH_MESSAGE;
    if (response.status === 403) return 'This request is not permitted. Please contact support.';
    try {
      return publicMessage(await readBoundedJson(response)) || fallback;
    } catch {
      return fallback;
    }
  }
  return publicMessage(error) || fallback;
}
