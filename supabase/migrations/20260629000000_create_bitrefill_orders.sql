-- Create bitrefill_orders table to track gift card / eSIM purchases via Bitrefill
CREATE TABLE public.bitrefill_orders (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  reference text not null,
  idempotency_key text null,

  product_id text not null,
  product_name text not null,
  package_id text null,
  quantity integer not null default 1,
  recipient_phone text null,

  -- Amount charged to the TallyStore customer, in NGN, from their chosen balance
  amount_ngn numeric(12, 2) not null,
  -- Original Bitrefill product price/currency (e.g. USD)
  amount_original numeric(12, 2) not null,
  currency text not null default 'USD',
  payment_source text not null default 'wallet',

  status text not null default 'pending',
  bitrefill_invoice_id text null,
  bitrefill_order_id text null,
  bitrefill_response jsonb null,

  redemption_code text null,
  redemption_link text null,
  redemption_pin text null,
  redemption_instructions text null,
  redemption_expiration timestamp with time zone null,

  created_at timestamp with time zone null default now(),
  completed_at timestamp with time zone null,

  constraint bitrefill_orders_pkey primary key (id),
  constraint bitrefill_orders_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint bitrefill_orders_status_check check (
    status = any (array['pending'::text, 'successful'::text, 'failed'::text])
  ),
  constraint bitrefill_orders_payment_source_check check (
    payment_source = any (array['wallet'::text, 'crypto'::text])
  )
) tablespace pg_default;

-- Indexes
CREATE INDEX idx_bitrefill_orders_user_id ON public.bitrefill_orders(user_id);
CREATE INDEX idx_bitrefill_orders_status ON public.bitrefill_orders(status);
CREATE INDEX idx_bitrefill_orders_created_at ON public.bitrefill_orders(created_at);

-- Idempotency: prevent double-charges per user per key
CREATE UNIQUE INDEX idx_bitrefill_orders_user_idempotency
ON public.bitrefill_orders USING btree (user_id, idempotency_key)
TABLESPACE pg_default
WHERE idempotency_key IS NOT NULL;

-- Enable RLS
ALTER TABLE public.bitrefill_orders ENABLE ROW LEVEL SECURITY;

-- Users can view their own orders
CREATE POLICY "Users can view own bitrefill orders" ON public.bitrefill_orders
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role (Edge Functions) has full access
CREATE POLICY "Service role has full access to bitrefill orders" ON public.bitrefill_orders
  FOR ALL
  USING (true)
  WITH CHECK (true);
