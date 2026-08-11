-- Create pending_payments table for automatic payment recovery
CREATE TABLE public.pending_payments (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  transaction_reference text not null,
  ercas_reference text null,
  amount numeric(10, 2) not null,
  created_at timestamp with time zone null default now(),
  last_check_at timestamp with time zone null,
  check_count integer null default 0,
  status text null default 'pending'::text,
  error_message text null,
  constraint pending_payments_pkey primary key (id),
  constraint pending_payments_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint pending_payments_status_check check (
    status = any (array['pending'::text, 'credited'::text, 'failed'::text, 'expired'::text])
  )
) tablespace pg_default;

-- Create index for efficient querying of pending payments
CREATE INDEX idx_pending_payments_status ON public.pending_payments(status) WHERE status = 'pending';
CREATE INDEX idx_pending_payments_created_at ON public.pending_payments(created_at);
CREATE INDEX idx_pending_payments_user_id ON public.pending_payments(user_id);

-- Enable RLS
ALTER TABLE public.pending_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own pending payments
CREATE POLICY "Users can view own pending payments" ON public.pending_payments
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own pending payments
CREATE POLICY "Users can insert own pending payments" ON public.pending_payments
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Service role can do everything (for Edge Function)
CREATE POLICY "Service role has full access" ON public.pending_payments
  FOR ALL
  USING (true)
  WITH CHECK (true);
