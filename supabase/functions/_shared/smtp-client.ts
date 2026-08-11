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
