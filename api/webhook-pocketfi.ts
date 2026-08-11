// api/webhook-pocketfi.ts
// Vercel serverless function for handling PocketFi webhooks.
//
// PocketFi's flow is PERMANENT VIRTUAL ACCOUNTS, not a hosted checkout — there is no
// per-transaction metadata.user_id like Ercas Pay sends, because the user never went
// through a checkout page. Instead PocketFi calls this webhook whenever money lands
// in ANY of the virtual accounts we've created, and we must figure out which user it
// belongs to by matching the account number against profiles.pocketfi_account_number.
//
// PocketFi's webhook payload shape is NOT documented anywhere we could find, so this
// handler is intentionally defensive: it tries many common field-name variants for the
// account number / amount / reference, and — whether or not it can confidently parse the
// payload — it logs the raw body to pocketfi_webhook_logs first. If a real transfer comes
// through and the wallet doesn't get credited, check that table (or Vercel's function
// logs) to see PocketFi's actual field names and adjust the constants below.

function firstDefined(...values: any[]) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function extractAccountNumber(payload: any): string | undefined {
  const value = firstDefined(
    payload.accountNumber,
    payload.account_number,
    payload.virtualAccountNumber,
    payload.data?.accountNumber,
    payload.data?.account_number,
    payload.data?.virtualAccountNumber,
    payload.account?.accountNumber,
    payload.account?.number,
  )
  return value ? String(value) : undefined
}

function extractAmount(payload: any): number {
  // Confirmed real PocketFi shape (from a live webhook on a sibling project):
  // { order: { amount, settlement_amount }, transaction: { reference }, account_number }
  const value = firstDefined(
    payload.order?.amount,
    payload.order?.settlement_amount,
    payload.data?.order?.amount,
    payload.data?.order?.settlement_amount,
    payload.amount,
    payload.data?.amount,
    payload.transaction?.amount,
  )
  return Number(value || 0)
}

function extractReference(payload: any): string | undefined {
  const value = firstDefined(
    payload.transaction?.reference,
    payload.transaction?.id,
    payload.data?.transaction?.reference,
    payload.data?.transaction?.id,
    payload.reference,
    payload.transaction_reference,
    payload.transactionReference,
    payload.data?.reference,
    payload.data?.transaction_reference,
    payload.sessionId,
    payload.id,
  )
  return value ? String(value) : undefined
}

function extractStatus(payload: any): string {
  return String(
    firstDefined(payload.status, payload.data?.status, payload.event, '') || '',
  ).toLowerCase()
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const payload = req.body || {};

  try {
    const accountNumber = extractAccountNumber(payload);
    const amount = extractAmount(payload);
    const reference = extractReference(payload) || `PKF-INWARD-${Date.now()}`;
    const status = extractStatus(payload);

    console.log('🔔 PocketFi webhook received:', { accountNumber, amount, reference, status });

    // Always log the raw payload — this is our only way to see PocketFi's real field
    // names if the extraction above guesses wrong on a live transfer.
    const { data: logRow } = await supabase
      .from('pocketfi_webhook_logs')
      .insert({
        raw_payload: payload,
        matched_account_number: accountNumber || null,
      })
      .select('id')
      .single();

    if (!accountNumber || !amount) {
      const message = 'Missing account number or amount in PocketFi webhook payload';
      console.error('❌', message, payload);
      if (logRow) {
        await supabase.from('pocketfi_webhook_logs').update({ error_message: message }).eq('id', logRow.id);
      }
      // Return 200 anyway — PocketFi shouldn't keep retrying a payload we can't parse.
      return res.status(200).json({ message: 'Payload could not be parsed, logged for review' });
    }

    const isSuccess = status === '' || status.includes('success') || status === 'completed' || status === 'paid' || status === 'credit';
    if (!isSuccess) {
      console.log('⏭️ Ignoring non-successful PocketFi event:', status);
      return res.status(200).json({ message: 'Event ignored' });
    }

    // Look up the user this account number belongs to.
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, wallet_balance')
      .eq('pocketfi_account_number', accountNumber)
      .maybeSingle();

    if (!profile) {
      const message = `No user found for PocketFi account number ${accountNumber}`;
      console.error('❌', message);
      if (logRow) {
        await supabase.from('pocketfi_webhook_logs').update({ error_message: message }).eq('id', logRow.id);
      }
      return res.status(200).json({ message: 'No matching account on file' });
    }

    const userId = profile.id;

    // Idempotency check — never credit the same inward transfer twice.
    const { data: existingTransaction } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingTransaction) {
      console.log('✅ PocketFi transaction already processed:', reference);
      return res.status(200).json({ message: 'Transaction already processed' });
    }

    const newBalance = (profile.wallet_balance || 0) + amount;

    const { error: balanceError } = await supabase
      .from('profiles')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (balanceError) {
      throw new Error(`Failed to update wallet: ${balanceError.message}`);
    }

    const { error: transactionError } = await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        type: 'topup',
        amount,
        status: 'completed',
        balance_after: newBalance,
        description: `Wallet top-up via PocketFi bank transfer (${accountNumber})`,
        reference,
      }]);

    if (transactionError) {
      throw new Error(`Failed to record transaction: ${transactionError.message}`);
    }

    if (logRow) {
      await supabase
        .from('pocketfi_webhook_logs')
        .update({ processed: true, matched_user_id: userId })
        .eq('id', logRow.id);
    }

    console.log('✅ PocketFi webhook payment processed successfully for user:', userId);

    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      data: { user_id: userId, amount, new_balance: newBalance, reference }
    });

  } catch (error) {
    console.error('❌ PocketFi webhook processing error:', error);

    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
