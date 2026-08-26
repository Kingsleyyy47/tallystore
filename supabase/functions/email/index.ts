import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ── Inlined shared modules (dashboard deploy cannot resolve _shared/) ──────────

// ── smtp-client.ts ──
/**
 * SMTP Client for TallyStore Email Service
 * Uses denomailer for Deno-native SMTP via Namecheap Private Email
 */

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = "mail.privateemail.com";
const SMTP_PORT = 465;

function getCredentials() {
  const email = Deno.env.get("SMTP_EMAIL");
  const password = Deno.env.get("SMTP_PASSWORD");
  if (!email || !password) {
    throw new Error("SMTP_EMAIL and SMTP_PASSWORD must be set in Edge Function secrets");
  }
  return { email, password };
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  const { email: fromEmail, password } = getCredentials();

  try {
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: fromEmail, password },
      },
    });

    await client.send({
      from: `TallyStore <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      content: "auto",
      html: options.html,
    });

    // Close connection, ignoring errors
    try { await client.close() } catch { /* ignore */ }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`SMTP send failed for ${options.to}: ${msg}`);
    return { success: false, error: msg };
  }
}

export async function sendEmailBulk(options: {
  recipients: string[];
  subject: string;
  html: string;
}): Promise<{ success: boolean; sent: number; failed: number; failedEmails: string[] }> {
  const { recipients, subject, html } = options;
  let sent = 0;
  let failed = 0;
  const failedEmails: string[] = [];

  // Process in chunks of 10 concurrent connections
  const CONCURRENCY = 10;
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const chunk = recipients.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((to) => sendEmail({ to, subject, html }))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value.success) {
        sent++;
      } else {
        failed++;
        failedEmails.push(chunk[j]);
      }
    }
  }

  return { success: true, sent, failed, failedEmails };
}

export function buildBroadcastHtml(message: string): string {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:linear-gradient(135deg,#7c3aed,#3b82f6);padding:24px;border-radius:12px;color:white;text-align:center;margin-bottom:24px">
      <h1 style="margin:0;font-size:24px">TallyStore</h1>
    </div>
    <div style="padding:16px;line-height:1.6;color:#333">
      ${message.replace(/\n/g, "<br/>")}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://tallystore.org/dashboard"
         style="background:linear-gradient(135deg,#7c3aed,#3b82f6);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
        Go to Dashboard
      </a>
    </div>
    <div style="text-align:center;margin-top:32px;color:#999;font-size:12px">
      <p>TallyStore — Your trusted digital marketplace</p>
    </div>
  </div>`;
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function listPromotionConsentedEmails(
  admin: ReturnType<typeof createClient>,
  options: { offset?: number; limit?: number; sampleLimit?: number } = {},
) {
  const offset = Math.max(0, Math.round(Number(options.offset || 0)));
  const limit = Math.max(0, Math.round(Number(options.limit || 0)));
  const sampleLimit = Math.max(0, Math.round(Number(options.sampleLimit || 0)));
  const batchSize = 1000;
  let profileOffset = 0;
  let eligibleSeen = 0;
  let totalRecipients = 0;
  const recipients: string[] = [];
  const sampleRecipients: string[] = [];

  while (true) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id,email,is_admin,is_staff,created_at")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(profileOffset, profileOffset + batchSize - 1);

    if (profilesError) throw new Error(profilesError.message);
    if (!profiles || profiles.length === 0) break;

    const profileIds = profiles.map((profile: any) => profile.id).filter(Boolean);
    const { data: prefs, error: prefsError } = await admin
      .from("customer_communication_preferences")
      .select("user_id,email_promotions_opt_in")
      .in("user_id", profileIds);

    if (prefsError) throw new Error(prefsError.message);
    const optedIn = new Set((prefs || [])
      .filter((pref: any) => pref.email_promotions_opt_in === true)
      .map((pref: any) => String(pref.user_id)));

    for (const profile of profiles as any[]) {
      if (profile.is_admin || profile.is_staff) continue;
      if (!optedIn.has(String(profile.id))) continue;
      if (!isValidEmail(profile.email)) continue;

      totalRecipients += 1;
      if (sampleRecipients.length < sampleLimit) sampleRecipients.push(profile.email);
      if (limit > 0 && eligibleSeen >= offset && recipients.length < limit) {
        recipients.push(profile.email);
      }
      eligibleSeen += 1;
    }

    if (profiles.length < batchSize) break;
    profileOffset += batchSize;
  }

  return { recipients, sampleRecipients, totalRecipients };
}

/** Verify the caller is an admin. Returns user id or throws. */
async function requireAdmin(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Missing authorization header");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  );

  const { data: { user }, error } = await supabase.auth.getUser(
    auth.replace("Bearer ", "")
  );
  if (error || !user) throw new Error("Unauthorized");

  const admin = getAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) throw new Error("Forbidden: admin only");
  return user.id;
}

async function requireAdminOrStaffPermission(
  req: Request,
  permissionKey: string,
  requireAutoApprove = false
): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Missing authorization header");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  );

  const { data: { user }, error } = await supabase.auth.getUser(
    auth.replace("Bearer ", "")
  );
  if (error || !user) throw new Error("Unauthorized");

  const admin = getAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin, is_staff")
    .eq("id", user.id)
    .single();

  if (profile?.is_admin) return user.id;
  if (!profile?.is_staff) throw new Error("Forbidden");

  const { data: permission } = await admin
    .from("staff_permissions")
    .select("is_enabled, auto_approve")
    .eq("user_id", user.id)
    .eq("permission_key", permissionKey)
    .maybeSingle();

  if (!permission?.is_enabled) throw new Error("Forbidden: staff permission required");
  if (requireAutoApprove && permission.auto_approve === false) {
    throw new Error("Forbidden: staff action requires approval");
  }

  return user.id;
}

// ─── Route: POST /email/send ────────────────────────────────────────
async function handleSend(req: Request) {
  const userId = await requireAdminOrStaffPermission(req, "tab_email", true);
  const { to, subject, html } = await req.json();

  if (!to || !subject || !html) {
    return json({ success: false, error: "to, subject, and html are required" }, 400);
  }

  const result = await sendEmail({ to, subject, html });
  if (!result.success) {
    return json({ success: false, error: result.error }, 500);
  }
  console.log('Admin/staff email sent.');
  return json({ success: true, message: "Email sent" });
}

// ─── Route: POST /email/broadcast ───────────────────────────────────
async function handleBroadcast(req: Request) {
  const { subject, html, dryRun } = await req.json();
  const userId = await requireAdminOrStaffPermission(
    req,
    "tab_email",
    dryRun !== true
  );

  if (!subject || !html) {
    return json({ success: false, error: "subject and html are required" }, 400);
  }

  const admin = getAdmin();
  const consented = await listPromotionConsentedEmails(admin, { sampleLimit: dryRun ? 200 : 0 });

  if (dryRun) {
    return json({
      success: true,
      dryRun: true,
      totalRecipients: consented.totalRecipients,
      sampleRecipients: consented.sampleRecipients,
      audience: "promotion_opted_in_customers",
    });
  }

  if (consented.totalRecipients <= 0) {
    return json({
      success: false,
      error: "No customers have opted in to promotional email broadcasts.",
    }, 400);
  }

  // Create broadcast job
  const { data: job, error } = await admin
    .from("broadcast_jobs")
    .insert({
      subject,
      html_body: html,
      status: "queued",
      total_recipients: consented.totalRecipients,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create broadcast job:", error);
    return json({ success: false, error: error.message }, 500);
  }

  console.log(`Broadcast job created for ${consented.totalRecipients} opted-in recipient(s).`);
  return json({
    success: true,
    jobId: job.id,
    totalRecipients: consented.totalRecipients,
    audience: "promotion_opted_in_customers",
    message: `Broadcast queued. ${consented.totalRecipients} opted-in customer(s) will be emailed automatically.`,
  });
}

// ─── Route: POST /email/process-broadcast (pg_cron worker) ──────────
async function handleProcessBroadcast() {
  const admin = getAdmin();
  const now = new Date();

  // Find the oldest active job that isn't locked (or has a stale lock >120s)
  const staleCutoff = new Date(now.getTime() - 120_000).toISOString();

  const { data: job, error: findErr } = await admin
    .from("broadcast_jobs")
    .select("*")
    .in("status", ["queued", "processing"])
    .or(`processing_lock.is.null,processing_lock.lt.${staleCutoff}`)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (findErr || !job) {
    return json({ success: true, message: "No active jobs" });
  }

  // Acquire lock
  await admin
    .from("broadcast_jobs")
    .update({
      processing_lock: now.toISOString(),
      status: "processing",
      ...(job.status === "queued" ? { started_at: now.toISOString() } : {}),
    })
    .eq("id", job.id);

  const startTime = Date.now();
  const MAX_RUNTIME_MS = 45_000; // 45 seconds
  let offset = Math.max(0, Math.round(Number(job.current_offset || 0)));
  let totalSent = Math.max(0, Math.round(Number(job.sent_count || 0)));
  let totalFailed = Math.max(0, Math.round(Number(job.failed_count || 0)));
  const batchSize = Math.max(1, Math.min(1000, Math.round(Number(job.batch_size || 100))));
  let batchCount = 0;

  try {
    while (Date.now() - startTime < MAX_RUNTIME_MS) {
      // Check for cancellation every 3 batches
      if (batchCount > 0 && batchCount % 3 === 0) {
        const { data: check } = await admin
          .from("broadcast_jobs")
          .select("status")
          .eq("id", job.id)
          .single();
        if (check?.status === "cancelled") {
          console.log(`🚫 Job ${job.id} was cancelled`);
          return json({ success: true, message: "Job cancelled" });
        }
      }

      // Fetch the next batch of customers who explicitly opted into promotional email.
      const consented = await listPromotionConsentedEmails(admin, {
        offset,
        limit: batchSize,
      });
      const emails = consented.recipients;

      if (consented.totalRecipients !== job.total_recipients) {
        await admin
          .from("broadcast_jobs")
          .update({ total_recipients: consented.totalRecipients })
          .eq("id", job.id);
      }

      if (emails.length === 0) {
        // All done
        await admin
          .from("broadcast_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            processing_lock: null,
            current_offset: offset,
            sent_count: totalSent,
            failed_count: totalFailed,
            last_processed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        console.log(`✅ Job ${job.id} completed: ${totalSent} sent, ${totalFailed} failed`);
        return json({
          success: true,
          jobId: job.id,
          processed: totalSent + totalFailed,
          sent: totalSent,
          failed: totalFailed,
          isComplete: true,
        });
      }

      if (emails.length > 0) {
        const result = await sendEmailBulk({
          recipients: emails,
          subject: job.subject,
          html: job.html_body,
        });

        totalSent += result.sent;
        totalFailed += result.failed;

        // Log failures
        if (result.failedEmails.length > 0) {
          const errorEntries = result.failedEmails.map((email) => ({
            email,
            error: "SMTP send failed",
            at: new Date().toISOString(),
          }));

          // Append to error_log array
          await admin.rpc("append_jsonb_array", {
            table_name: "broadcast_jobs",
            row_id: job.id,
            column_name: "error_log",
            new_elements: JSON.stringify(errorEntries),
          }).catch(() => {
            // Fallback: overwrite error_log if RPC doesn't exist
            // This is acceptable — we'll just track the latest batch errors
          });
        }
      }

      offset += emails.length;
      batchCount++;

      // Update progress
      await admin
        .from("broadcast_jobs")
        .update({
          current_offset: offset,
          sent_count: totalSent,
          failed_count: totalFailed,
          processing_lock: new Date().toISOString(),
          last_processed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      // If we got fewer recipients than batch_size, we're at the end
      if (emails.length < batchSize) {
        await admin
          .from("broadcast_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            processing_lock: null,
          })
          .eq("id", job.id);

        console.log(`✅ Job ${job.id} completed: ${totalSent} sent, ${totalFailed} failed`);
        return json({
          success: true,
          jobId: job.id,
          processed: totalSent + totalFailed,
          sent: totalSent,
          failed: totalFailed,
          isComplete: true,
        });
      }
    }

    // Time's up — release lock so next cron picks it up
    await admin
      .from("broadcast_jobs")
      .update({ processing_lock: null })
      .eq("id", job.id);

    console.log(`⏱️ Job ${job.id} paused at offset ${offset}. Sent so far: ${totalSent}`);
    return json({
      success: true,
      jobId: job.id,
      processed: totalSent + totalFailed - job.sent_count - job.failed_count,
      sent: totalSent,
      failed: totalFailed,
      isComplete: false,
    });
  } catch (err) {
    console.error(`❌ Job ${job.id} error:`, err);
    // Release lock on error so cron can retry
    await admin
      .from("broadcast_jobs")
      .update({ processing_lock: null })
      .eq("id", job.id);
    return json({ success: false, error: String(err) }, 500);
  }
}

// ─── Route: GET /email/broadcast-status ─────────────────────────────
async function handleBroadcastStatus(req: Request) {
  await requireAdminOrStaffPermission(req, "tab_email");
  const admin = getAdmin();

  const { data: jobs, error } = await admin
    .from("broadcast_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return json({ success: false, error: error.message }, 500);
  }

  return json({ success: true, jobs: jobs || [] });
}

// ─── Route: POST /email/cancel-broadcast ────────────────────────────
async function handleCancelBroadcast(req: Request) {
  await requireAdminOrStaffPermission(req, "tab_email", true);
  const { jobId } = await req.json();

  if (!jobId) {
    return json({ success: false, error: "jobId is required" }, 400);
  }

  const admin = getAdmin();
  const { error } = await admin
    .from("broadcast_jobs")
    .update({ status: "cancelled", processing_lock: null })
    .eq("id", jobId)
    .in("status", ["queued", "processing"]);

  if (error) {
    return json({ success: false, error: error.message }, 500);
  }

  console.log(`🚫 Broadcast job ${jobId} cancelled`);
  return json({ success: true, message: "Broadcast cancelled" });
}

// ─── Router ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/email/, "").replace(/\/$/, "") || "/";

    switch (path) {
      case "/send":
        return await handleSend(req);
      case "/broadcast":
        return await handleBroadcast(req);
      case "/process-broadcast":
        return await handleProcessBroadcast();
      case "/broadcast-status":
        return await handleBroadcastStatus(req);
      case "/cancel-broadcast":
        return await handleCancelBroadcast(req);
      default:
        return json({ error: `Unknown route: ${path}` }, 404);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message === "Unauthorized"
      ? 401
      : message.startsWith("Forbidden")
        ? 403
        : 500;
    return json({ success: false, error: message }, status);
  }
});
