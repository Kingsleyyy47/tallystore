# Mass Mailing Feature — Complete Blueprint

> **Purpose:** This document is a comprehensive reference for building a mass mailing / broadcast email system in a Supabase-based project. It covers architecture, SMTP setup, Edge Functions, admin UI, DNS deliverability, job-based processing, and lessons learned from a production deployment that sent 30,770 emails.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [SMTP Provider & Configuration](#2-smtp-provider--configuration)
3. [DNS Records for Email Deliverability](#3-dns-records-for-email-deliverability)
4. [Supabase Edge Function — Email Service](#4-supabase-edge-function--email-service)
5. [Shared Email Utility (SMTP Client)](#5-shared-email-utility-smtp-client)
6. [Database Schema — broadcast_jobs Table](#6-database-schema--broadcast_jobs-table)
7. [Background Processing with pg_cron + pg_net](#7-background-processing-with-pg_cron--pg_net)
8. [Admin UI — Compose & Monitor](#8-admin-ui--compose--monitor)
9. [Email HTML Templates](#9-email-html-templates)
10. [Sending Modes](#10-sending-modes)
11. [Production Results & Lessons Learned](#11-production-results--lessons-learned)
12. [Environment Variables](#12-environment-variables)
13. [Full API Reference](#13-full-api-reference)

---

## 1. Architecture Overview

The mass mailing system uses a **job-based architecture** where broadcast emails are processed server-side by a background worker, not the admin's browser session.

```
┌─────────────────┐
│  Admin UI        │  Compose email → Choose "Broadcast" or "Send to List"
│  (React page)    │
└────────┬────────┘
         │ POST /email/broadcast  { subject, html }
         ▼
┌─────────────────┐
│  Edge Function   │  Creates a row in broadcast_jobs → returns jobId immediately
│  /email          │  (Admin can close browser — processing is server-side)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ broadcast_jobs   │  status: queued → processing → completed/cancelled
│ (Supabase table) │  Tracks: sent_count, failed_count, current_offset, error_log
└────────┬────────┘
         │ pg_cron fires every 1 minute
         ▼
┌─────────────────┐
│  Edge Function   │  POST /email/process-broadcast (called by pg_cron via pg_net)
│  Worker Loop     │  Loops: fetch 50 users → send batch → update progress
│                  │  Runs up to 45 seconds per invocation, then releases lock
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SMTP Server     │  mail.privateemail.com:465 (Namecheap Private Email)
│  (Namecheap)     │  Sends individual emails via denomailer (Deno SMTP library)
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  Admin UI polls  │  GET /email/broadcast-status every 5 seconds
│  for progress    │  Shows: progress bar, sent/failed counts, ETA, elapsed time
└─────────────────┘
```

**Key design decisions:**
- The admin's browser does NOT need to stay open — pg_cron drives processing
- Each batch is 50 emails (configurable via `batch_size` column)
- A `processing_lock` timestamp prevents concurrent workers from colliding
- The admin can **cancel** a running broadcast at any time
- A **dry-run mode** lets the admin preview recipients without sending

---

## 2. SMTP Provider & Configuration

### Namecheap Private Email

The production system uses **Namecheap Private Email** (`mail.privateemail.com`) as the SMTP relay. This comes bundled when you have a domain registered on Namecheap and add the Private Email addon.

| Setting | Value |
|---|---|
| **SMTP Host** | `mail.privateemail.com` |
| **Port** | `465` (Implicit TLS) |
| **TLS** | `true` (implicit — NOT STARTTLS) |
| **Auth** | Username + Password (the full email address + its password) |
| **From Address** | `support@yourdomain.com` (or whatever mailbox you created) |

**Port choice:** Port 465 (implicit TLS) is recommended over port 587 (STARTTLS) for Deno Deploy / Supabase Edge Functions. STARTTLS requires upgrading an existing plaintext connection, which can be unreliable in serverless environments. Port 465 establishes TLS from the start.

### Setting up a Namecheap Private Email mailbox

1. Log into Namecheap → **Domain List** → select your domain
2. Go to **Private Email** tab → Purchase / Activate
3. Create a mailbox (e.g., `support@yourdomain.com`) with a password
4. Namecheap auto-configures MX records for incoming mail
5. You still need to manually add SPF, DKIM, and DMARC DNS records (see Section 3)

---

## 3. DNS Records for Email Deliverability

Without proper DNS records, recipient servers (Gmail, Outlook, Yahoo) will often reject or spam-folder your emails. These are **critical** for deliverability.

### SPF (Sender Policy Framework)

Tells recipient servers which SMTP servers are authorized to send email for your domain.

```
Type: TXT
Host: @
Value: v=spf1 include:spf.privateemail.com ~all
```

If you already have an SPF record (e.g., for another service), merge them:
```
v=spf1 include:spf.privateemail.com include:other-service.com ~all
```

### DKIM (DomainKeys Identified Mail)

Cryptographically signs emails to prove they haven't been tampered with in transit. Namecheap Private Email provides DKIM records — check your Namecheap dashboard under **Private Email → DNS Settings** for the exact DKIM TXT record to add.

```
Type: TXT
Host: default._domainkey (or whatever Namecheap specifies)
Value: (provided by Namecheap — a long Base64 public key)
```

### DMARC (Domain-based Message Authentication, Reporting & Conformance)

Tells recipient servers what to do when SPF/DKIM checks fail.

```
Type: TXT
Host: _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com
```

Start with `p=none` (monitor mode) to collect reports. Once confident, tighten to `p=quarantine` or `p=reject`.

### Where to add these in Namecheap

1. Namecheap dashboard → **Domain List** → click domain → **Advanced DNS** tab
2. Add each TXT record under "Host Records"
3. DNS propagation takes 15 minutes to 48 hours
4. Verify with tools like [MXToolbox](https://mxtoolbox.com/) or `dig TXT yourdomain.com`

---

## 4. Supabase Edge Function — Email Service

The email Edge Function is a single Deno function with route-based dispatch. All routes live under one function name (e.g., `email`) with path-based routing.

### Route Table

| Route | Method | Auth Required | Purpose |
|---|---|---|---|
| `/email/welcome` | POST | User (any authenticated) | Send branded welcome email to the authenticated user |
| `/email/send` | POST | Admin only | Send a single email to any address (admin compose) |
| `/email/broadcast` | POST | Admin only | Create a broadcast job OR perform a dry-run preview |
| `/email/process-broadcast` | POST | None (pg_cron caller) | Process next batch of the active broadcast job |
| `/email/broadcast-status` | GET | Admin only | Return all broadcast jobs with progress data |
| `/email/cancel-broadcast` | POST | Admin only | Cancel a running or queued broadcast job |

### Route Implementation Details

#### POST `/email/send` (Admin — single email)
```
Request body: { to: string, subject: string, html: string }
Response: { success: true, message: "Email sent" }
```
- Calls `requireAdmin(req)` for auth
- Calls `sendEmail({ to, subject, html })` from the shared utility
- Returns error if SMTP send fails

#### POST `/email/broadcast` (Admin — create job or dry-run)
```
Request body: { subject: string, html: string, dryRun?: boolean }

If dryRun=true:
  Response: { success: true, dryRun: true, totalRecipients: number, recipients: string[] }
  (Returns count + sample of 200 emails, no job created)

If dryRun=false (default):
  Response: { success: true, jobId: string, totalRecipients: number, message: "Broadcast queued..." }
  (Creates row in broadcast_jobs table, pg_cron picks it up)
```

**Recipient counting:** Uses `supabase.from("profiles").select("id", { count: "exact", head: true })` for an O(1) count instead of paginating through all auth users. The actual emails are fetched per-batch during processing via `supabase.auth.admin.listUsers()`.

#### POST `/email/process-broadcast` (pg_cron worker)
This is the heart of the system. Called automatically every minute by pg_cron.

**Processing flow:**
1. Find the oldest job with status `queued` or `processing` that isn't locked (or has a stale lock >120 seconds)
2. Acquire the `processing_lock` (set to current timestamp)
3. Set status to `processing`, record `started_at` if first run
4. **Loop** (until 45 seconds elapsed OR all recipients processed):
   a. Calculate page number from `current_offset` and `batch_size`
   b. Fetch batch via `supabase.auth.admin.listUsers({ page, perPage: batch_size })`
   c. Extract emails, filter out users without email
   d. Call `sendEmailBulk({ recipients, subject, html })` — sends all 50 in parallel
   e. Update `sent_count`, `failed_count`, `current_offset`, `error_log` in the DB
   f. Every 3 batches, re-check if job was `cancelled`
5. After loop exits:
   - If all recipients processed → set status to `completed`, record `completed_at`
   - Otherwise → release `processing_lock` (set to null), leave status as `processing`
   - pg_cron will call again next minute to continue

**Concurrency protection:** The `processing_lock` is a timestamp. If the lock is >120 seconds old (stale — worker crashed), another invocation can safely take over.

#### GET `/email/broadcast-status` (Admin — poll progress)
```
Response: { success: true, jobs: BroadcastJob[] }
```
Returns all jobs ordered by `created_at DESC`, limit 20. The frontend polls this every 5 seconds while any job is active.

#### POST `/email/cancel-broadcast` (Admin)
```
Request body: { jobId: string }
Response: { success: true, message: "Broadcast cancelled" }
```
Sets `status = "cancelled"` and clears `processing_lock`. The worker checks for cancellation every 3 batches.

### Auth Note
The `/process-broadcast` route does NOT enforce authentication because it's called by pg_cron (which can't pass user tokens). The Edge Function must be deployed with `--no-verify-jwt` to allow this. All other routes enforce auth via `requireAuth()` or `requireAdmin()` middleware.

---

## 5. Shared Email Utility (SMTP Client)

The SMTP client is a shared module imported by the Edge Function. It uses `denomailer` — a Deno-native SMTP library.

### Library
```ts
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
```

### `sendEmail()` — Single recipient
```ts
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }>
```
- Creates a new `SMTPClient` connection per call
- Sends the email
- Closes the connection (fire-and-forget close to avoid Deno Deploy 502 errors)
- Returns `{ success: true }` or `{ success: false, error: "..." }`

### `sendEmailBulk()` — Multiple recipients in parallel
```ts
export async function sendEmailBulk(options: {
  recipients: string[];
  subject: string;
  html: string;
}): Promise<{ success: boolean; sent: number; failed: number; failedEmails: string[] }>
```
- Opens **one SMTP connection per recipient**, all in parallel via `Promise.allSettled()`
- Each connection is independent — one failure doesn't affect others
- The caller (process-broadcast) limits batch size to 50, so max 50 simultaneous connections
- Returns aggregate counts: `{ sent: 47, failed: 3, failedEmails: ["bad@example.com", ...] }`

### Configuration
```ts
const SMTP_HOST = "mail.privateemail.com";
const SMTP_PORT = 465;

// Environment variables (with fallbacks)
const fromEmail = Deno.env.get("SMTP_EMAIL") || Deno.env.get("EMAIL");
const password = Deno.env.get("SMTP_PASSWORD") || Deno.env.get("PASSWORD");
```

### Connection Options
```ts
const client = new SMTPClient({
  connection: {
    hostname: SMTP_HOST,
    port: SMTP_PORT,
    tls: true,           // Implicit TLS (not STARTTLS)
    auth: {
      username: fromEmail,
      password: password,
    },
  },
});
```

### Sending an Email
```ts
await client.send({
  from: `YourBrand <${fromEmail}>`,
  to: recipientEmail,
  subject: "Your Subject",
  content: "auto",       // denomailer auto-generates text from HTML
  html: "<div>...</div>",
});
```

---

## 6. Database Schema — broadcast_jobs Table

This table tracks every broadcast job and its progress. One row per broadcast.

```sql
CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          TEXT NOT NULL,
  html_body        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',
  -- 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  recipient_filter TEXT NOT NULL DEFAULT 'all',
  -- For future use: could filter by segment/tag
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  current_offset   INTEGER NOT NULL DEFAULT 0,
  batch_size       INTEGER NOT NULL DEFAULT 50,
  created_by       UUID REFERENCES auth.users(id),
  error_log        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Array of { email: string, error: string, at: string }
  processing_lock  TIMESTAMPTZ,
  -- Non-null means a worker is currently processing this job
  -- Stale locks (>120s old) are considered abandoned
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  last_processed_at TIMESTAMPTZ
);

-- Partial index: only index active jobs (what ph_cron queries)
CREATE INDEX idx_broadcast_jobs_status
  ON broadcast_jobs (status)
  WHERE status IN ('queued', 'processing');
```

### Row Lifecycle

```
INSERT → status='queued', sent_count=0, current_offset=0
  ↓ (pg_cron picks up within 1 minute)
UPDATE → status='processing', processing_lock=now(), started_at=now()
  ↓ (worker processes batches, updating sent_count/failed_count/current_offset after each)
  ↓ (45-second window expires → releases lock, pg_cron re-invokes next minute)
  ↓ ...repeats until current_offset >= total_recipients...
UPDATE → status='completed', completed_at=now(), processing_lock=null

Or if cancelled:
UPDATE → status='cancelled', processing_lock=null
```

### RLS Policy
```sql
CREATE POLICY admins_manage_broadcast_jobs ON broadcast_jobs
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
```

---

## 7. Background Processing with pg_cron + pg_net

This is what makes the system truly server-side. Instead of the admin's browser driving email sends, a PostgreSQL cron job fires every minute and invokes the Edge Function worker.

### Required Extensions
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```
Both are available in Supabase by default — just enable them.

### Cron Job Setup
```sql
SELECT cron.schedule(
  'process-broadcast-emails',   -- job name
  '* * * * *',                  -- every minute
  $$
  SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/email/process-broadcast',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <supabase-anon-key>"}'::jsonb,
    body := '{"source": "pg_cron"}'::jsonb
  )
  WHERE EXISTS (
    SELECT 1 FROM public.broadcast_jobs
    WHERE status IN ('queued', 'processing')
  );
  $$
);
```

**Important details:**
- The `WHERE EXISTS` clause means the HTTP call is skipped entirely when there are no active jobs — zero overhead when idle
- Uses `net.http_post()` from `pg_net` to make an async HTTP call to the Edge Function
- The `Authorization` header uses the **anon key** (since `--no-verify-jwt` is set, any valid key works)
- Replace `<project-ref>` with your Supabase project reference
- Replace `<supabase-anon-key>` with your project's anon/publishable key

### How to find your cron jobs
```sql
SELECT * FROM cron.job;             -- List all scheduled jobs
SELECT * FROM cron.job_run_details  -- Execution history
  ORDER BY start_time DESC LIMIT 20;
```

### How to remove/update
```sql
SELECT cron.unschedule('process-broadcast-emails');  -- Remove
-- Then re-create with updated SQL
```

---

## 8. Admin UI — Compose & Monitor

The admin page has two main sections: a **Compose Card** and a **Broadcast Jobs** panel.

### Compose Card Features
- **Recipients input:** Email address field with validation + "Add" button. Pressing Enter also adds. Duplicate detection.
- **Email chips:** Added recipients appear as removable chips with a "Clear all" option.
- **Subject line:** Editable text input (default: "ActiveStore Notification").
- **Message body:** Textarea for the email content (plain text — converted to HTML via a template function).
- **"Send to List" button:** Sends the email individually to each manually-added recipient. Sequential calls, one per recipient.
- **"Broadcast to All Users" button:** Creates a server-side job that emails every registered user.
- **Dry-run toggle:** Checkbox that switches broadcast to "test mode" — shows recipient count + sample emails without sending.
- **Confirmation dialog:** Before broadcasting, a confirm dialog warns the admin and explains that processing happens server-side.

### Broadcast Jobs Panel
- Lists all broadcast jobs (newest first, up to 20)
- Each job shows:
  - **Status badge:** queued (yellow), processing (blue/spinning), completed (green), failed (red), cancelled (gray)
  - **Progress bar:** Visual bar showing `(sent + failed) / total` percentage
  - **Stats row:** "X sent • Y failed of Z total | N% | ETA: ~Xm | Ym elapsed"
  - **Cancel button:** Visible for queued/processing jobs
  - **Expand button:** Shows full details (job ID, timestamps, error log)
- **Auto-polling:** While any job is queued or processing, the UI polls `broadcast-status` every 5 seconds
- **Refresh button:** Manual refresh for the jobs list

### Frontend API Calls (via supabase-js)
```ts
import { supabase } from '@/lib/supabase'

// Send single email (admin)
await supabase.functions.invoke('email/send', {
  method: 'POST',
  body: { to, subject, html },
})

// Start broadcast
await supabase.functions.invoke('email/broadcast', {
  method: 'POST',
  body: { subject, html, dryRun: false },
})

// Dry-run preview
await supabase.functions.invoke('email/broadcast', {
  method: 'POST',
  body: { subject, html, dryRun: true },
})

// Poll job status
await supabase.functions.invoke('email/broadcast-status', {
  method: 'GET',
})

// Cancel a job
await supabase.functions.invoke('email/cancel-broadcast', {
  method: 'POST',
  body: { jobId },
})
```

---

## 9. Email HTML Templates

### Broadcast Template (built client-side)
The admin types plain text in a textarea. The frontend wraps it in a branded HTML template before sending:

```ts
const buildEmailHtml = (message: string) =>
  `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:linear-gradient(135deg,#f97316,#ef4444);padding:24px;border-radius:12px;color:white;text-align:center;margin-bottom:24px">
      <h1 style="margin:0;font-size:24px">YourBrand</h1>
    </div>
    <div style="padding:16px;line-height:1.6;color:#333">
      ${message.replace(/\n/g, '<br/>')}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://yourdomain.com/dashboard"
         style="background:#f97316;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
        Go to Dashboard
      </a>
    </div>
  </div>`
```

**Notes:**
- Inline CSS only (email clients strip `<style>` blocks)
- Newlines in the message → `<br/>` tags
- CTA button links to the dashboard
- Gradient header with brand name
- Change the colors and brand name to match your project

### Welcome Email Template (server-side)
A separate template for welcome emails, generated in the shared email utility:

```ts
export function welcomeEmailHtml(username: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#6b73ff,#8e54e9);padding:30px;border-radius:12px;color:white;text-align:center">
        <h1 style="margin:0;font-size:28px">Welcome to YourBrand!</h1>
        <p style="margin:10px 0 0;font-size:16px;opacity:0.9">Hi ${username}, we're glad you're here</p>
      </div>
      <!-- ... rest of welcome content ... -->
    </div>
  `;
}
```

---

## 10. Sending Modes

### Mode 1: Send to List (Targeted)
- Admin manually adds email addresses via the UI
- Frontend loops through the list and calls `POST /email/send` once per recipient
- **Sequential, NOT batched** — one at a time from the browser
- Good for small targeted sends (1-50 emails)
- The admin must keep the page open until all sends complete

### Mode 2: Broadcast to All Users (Job-Based)
- Admin clicks "Broadcast" → single API call creates a `broadcast_jobs` row
- Returns immediately — admin can close the page
- pg_cron worker picks up the job within 1 minute
- Worker processes in batches of 50, multiple batches per minute
- Admin can return to the page anytime to check progress
- Admin can cancel at any time
- Good for mass sends (hundreds to tens of thousands)

### Mode 3: Dry Run (Preview)
- Admin toggles "Test mode" checkbox and clicks broadcast
- API returns total recipient count + sample of 200 emails
- No job created, no emails sent
- Admin can review the sample and then switch off test mode to broadcast for real

---

## 11. Production Results & Lessons Learned

### Real Broadcast Stats
A production broadcast to ~30,770 users completed with these results:

| Metric | Value |
|---|---|
| Total Recipients | 30,770 |
| Successfully Sent | 13,149 (42.7%) |
| Failed | 17,651 (57.3%) |
| Error Log Entries | 26,595 |
| Total Duration | ~8 days |
| Batch Size | 50 |

### Why the High Failure Rate

1. **Malformed emails in the database:** Many users had invalid email addresses (e.g., `user@gmailcom`, `user@gmail` — missing dots or TLDs). The old signup flow had no email validation. **Lesson: Validate email format on signup and sanitize before broadcasting.**

2. **No SPF/DKIM/DMARC records:** Without proper DNS authentication records, recipient servers reject or bounce emails. This likely caused a significant portion of "SMTP send failed" errors. **Lesson: Set up SPF, DKIM, and DMARC BEFORE sending any mass email.**

3. **SMTP rate limiting:** Namecheap Private Email has sending limits (typically ~500/hour for shared hosting plans). Sending 50 emails simultaneously every minute exceeds this. **Lesson: Know your SMTP provider's rate limits and configure batch_size/timing accordingly.**

4. **Connection exhaustion:** 50 simultaneous SMTP connections per batch is aggressive. Some may timeout or be refused. **Lesson: Consider sequential sending within a batch, or use a smaller parallel window (e.g., 10 concurrent).**

### Why 8 Days for 30K Emails

At 50 emails/batch with a 1-minute cron interval, theoretical throughput is ~3,000/hour → ~10 hours for 30K. The 8-day duration suggests:
- SMTP connection timeouts consuming most of the 45-second worker window
- Each failed connection may hang for 10-30 seconds before timing out
- With 50 parallel connections, a few slow connections bottleneck the entire batch
- The worker processes multiple batches per invocation (up to 45 seconds), but SMTP failures eat into that time budget

### Recommendations for Improvement

1. **Validate emails before sending:** Add a pre-processing step that filters out obviously invalid emails (missing TLD, no @ sign, known-bad domains). This alone could cut failures in half.

2. **Use a transactional email service for high volume:** For 10K+ sends, consider services like Resend, Postmark, SendGrid, or Amazon SES. They have proper deliverability infrastructure, higher rate limits, and built-in bounce handling. You can still use Namecheap Private Email as the "from" domain while routing through a service.

3. **Add connection timeout:** Set a per-email SMTP connection timeout of 10 seconds. Don't let one hanging connection block the batch.

4. **Reduce parallelism:** Instead of 50 concurrent SMTP connections, consider 5-10 concurrent with chunking. This reduces connection exhaustion.

5. **Set up DNS records:** SPF, DKIM, DMARC are non-negotiable for any mass email operation.

6. **Add unsubscribe handling:** CAN-SPAM and GDPR require a one-click unsubscribe mechanism. Add an `email_unsubscribed` boolean to the user profile and filter them out during broadcasts.

---

## 12. Environment Variables

These must be set in your Supabase project's Edge Function secrets:

| Variable | Description | Example |
|---|---|---|
| `SMTP_EMAIL` | The "from" email address (your mailbox) | `support@yourdomain.com` |
| `SMTP_PASSWORD` | The mailbox password | `YourSecurePassword` |
| `SUPABASE_URL` | Auto-set by Supabase | — |
| `SUPABASE_ANON_KEY` | Auto-set by Supabase | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Needed for `auth.admin.listUsers()` | — |

**Setting secrets via CLI:**
```bash
supabase secrets set SMTP_EMAIL=support@yourdomain.com
supabase secrets set SMTP_PASSWORD=YourSecurePassword
```

**Or via the Supabase Dashboard:**
Settings → Edge Functions → Secrets

---

## 13. Full API Reference

### POST `/email/send`
**Auth:** Admin required
**Body:**
```json
{
  "to": "user@example.com",
  "subject": "Your Subject",
  "html": "<div>HTML content</div>"
}
```
**Success Response (200):**
```json
{ "success": true, "message": "Email sent" }
```
**Error Response (500):**
```json
{ "error": "SMTP connection failed: ..." }
```

---

### POST `/email/broadcast`
**Auth:** Admin required
**Body:**
```json
{
  "subject": "Newsletter Update",
  "html": "<div>HTML content</div>",
  "dryRun": false
}
```
**Success Response — Real Broadcast (200):**
```json
{
  "success": true,
  "message": "Broadcast queued. 30770 recipients will be emailed automatically.",
  "jobId": "a1b2c3d4-...",
  "totalRecipients": 30770
}
```
**Success Response — Dry Run (200):**
```json
{
  "success": true,
  "dryRun": true,
  "totalRecipients": 30770,
  "recipients": ["user1@example.com", "user2@example.com", "...up to 200"]
}
```

---

### POST `/email/process-broadcast`
**Auth:** None (called by pg_cron)
**Body:**
```json
{ "source": "pg_cron" }
```
**Response (200):**
```json
{
  "success": true,
  "jobId": "a1b2c3d4-...",
  "processed": 150,
  "sent": 142,
  "failed": 8,
  "isComplete": false
}
```

---

### GET `/email/broadcast-status`
**Auth:** Admin required
**Response (200):**
```json
{
  "success": true,
  "jobs": [
    {
      "id": "a1b2c3d4-...",
      "subject": "Newsletter Update",
      "status": "processing",
      "total_recipients": 30770,
      "sent_count": 5000,
      "failed_count": 1200,
      "current_offset": 6200,
      "batch_size": 50,
      "created_at": "2025-02-25T18:37:00Z",
      "started_at": "2025-02-25T18:38:00Z",
      "completed_at": null,
      "last_processed_at": "2025-02-25T19:15:00Z",
      "error_log": [
        { "email": "bad@gmail", "error": "SMTP send failed", "at": "2025-02-25T18:39:12Z" }
      ]
    }
  ]
}
```

---

### POST `/email/cancel-broadcast`
**Auth:** Admin required
**Body:**
```json
{ "jobId": "a1b2c3d4-..." }
```
**Response (200):**
```json
{ "success": true, "message": "Broadcast cancelled" }
```

---

### POST `/email/welcome`
**Auth:** Any authenticated user
**Body (optional):**
```json
{ "userId": "target-user-id" }
```
(Only admins can specify a different userId. Regular users get the welcome email sent to themselves.)
**Response (200):**
```json
{ "success": true, "message": "Welcome email sent" }
```
