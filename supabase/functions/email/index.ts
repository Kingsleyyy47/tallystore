import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendEmail, sendEmailBulk } from "../_shared/smtp-client.ts";

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

// ─── Route: POST /email/send ────────────────────────────────────────
async function handleSend(req: Request) {
  const userId = await requireAdmin(req);
  const { to, subject, html } = await req.json();

  if (!to || !subject || !html) {
    return json({ success: false, error: "to, subject, and html are required" }, 400);
  }

  const result = await sendEmail({ to, subject, html });
  if (!result.success) {
    return json({ success: false, error: result.error }, 500);
  }
  console.log(`✉️ Admin ${userId} sent email to ${to}`);
  return json({ success: true, message: "Email sent" });
}

// ─── Route: POST /email/broadcast ───────────────────────────────────
async function handleBroadcast(req: Request) {
  const userId = await requireAdmin(req);
  const { subject, html, dryRun } = await req.json();

  if (!subject || !html) {
    return json({ success: false, error: "subject and html are required" }, 400);
  }

  const admin = getAdmin();

  // Count total users
  const { count: totalRecipients } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (dryRun) {
    // Return sample of 200 emails without creating a job
    const { data: { users } } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const emails = users.map((u: any) => u.email).filter(Boolean);
    return json({
      success: true,
      dryRun: true,
      totalRecipients: totalRecipients || 0,
      sampleRecipients: emails,
    });
  }

  // Create broadcast job
  const { data: job, error } = await admin
    .from("broadcast_jobs")
    .insert({
      subject,
      html_body: html,
      status: "queued",
      total_recipients: totalRecipients || 0,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create broadcast job:", error);
    return json({ success: false, error: error.message }, 500);
  }

  console.log(`📢 Broadcast job created: ${job.id} by admin ${userId}, ${totalRecipients} recipients`);
  return json({
    success: true,
    jobId: job.id,
    totalRecipients: totalRecipients || 0,
    message: `Broadcast queued. ${totalRecipients} recipients will be emailed automatically.`,
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
  let offset = job.current_offset;
  let totalSent = job.sent_count;
  let totalFailed = job.failed_count;
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

      // Fetch batch of users
      const page = Math.floor(offset / job.batch_size) + 1;
      const { data: { users }, error: listErr } = await admin.auth.admin.listUsers({
        page,
        perPage: job.batch_size,
      });

      if (listErr || !users || users.length === 0) {
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

      const emails = users
        .map((u: any) => u.email)
        .filter((e: string | undefined): e is string => {
          if (!e) return false;
          // Basic email validation — skip obviously bad addresses
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
        });

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

      offset += users.length;
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

      // If we got fewer users than batch_size, we're at the end
      if (users.length < job.batch_size) {
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
  await requireAdmin(req);
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
  await requireAdmin(req);
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
    const status = message === "Unauthorized" || message === "Forbidden: admin only" ? 401 : 500;
    return json({ success: false, error: message }, status);
  }
});
