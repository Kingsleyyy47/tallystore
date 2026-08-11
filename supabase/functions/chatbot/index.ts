import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Real support contact (kept in sync with src/lib/support.ts).
const SUPPORT_WHATSAPP_URL =
  "https://wa.me/2349024595121?text=Hello%20TallyStore%20support%2C%20I%20need%20help%20with%20my%20account%2C%20wallet%2C%20or%20order.";
// TODO: same placeholder as src/lib/support.ts — fill in your real Telegram support link.
const SUPPORT_TELEGRAM_URL = "https://t.me/REPLACE_WITH_YOUR_TELEGRAM_SUPPORT_HANDLE";

// Static "how things work" knowledge, kept in sync with src/pages/HowItWorksPage.tsx.
// This is what lets the bot explain purchase/deposit/referral flows accurately
// without having to read the live page.
const SITE_GUIDE = `
HOW TO PURCHASE
1. Browse — pick a category (Instagram, TikTok, Twitter, Facebook, and more) and find a product.
2. Fund your wallet — every purchase is paid from the wallet balance, not card-by-card.
3. Checkout — choose quantity (bulk/quantity discounts apply automatically), enter a discount
   code if you have one, then confirm.
4. Get instant access — login details are delivered immediately to the Orders page, no manual
   approval step.

HOW TO DEPOSIT (fund the wallet)
There are two payment gateways:
- Ercas Pay: redirect-to-checkout flow (card, bank transfer, or USSD). IMPORTANT: Ercas Pay
  generates a brand-new checkout session every time, so the bank account number shown can be
  DIFFERENT on every top-up. Users should always pay into whichever account number is shown on
  the screen at that moment, not one they remember from a previous top-up. Funds land
  automatically once payment confirms.
- PocketFi: gives the user ONE permanent virtual bank account tied to their account, generated
  once and reused forever. Users can save that account number and transfer to it directly from
  their bank app any time, without opening a new checkout. This is the easier option for people
  who don't want to look up a new account number every time. Wallet credits automatically once
  the transfer lands.
Both gateways credit the wallet automatically. If a deposit doesn't reflect after a few minutes,
the user should check Wallet -> Transaction History before contacting support.

HOW TO REFER
1. Get your link — every account has a unique referral code/link on the Referrals page.
2. They sign up — anyone who registers through that link or code is linked permanently as a
   referral.
3. You earn — a percentage of every purchase your referrals make is credited to your referral
   balance, withdrawable any time from the Referrals page. No cap on referral earnings.

DISCOUNTS
Quantity discounts apply automatically based on how many of a product someone buys. A discount
code, if entered at checkout, applies on top of that. Both are validated and calculated securely
when the order is processed (the displayed totals match what's actually charged).

ACCOUNT SAFETY
Every account sold goes through a verification step before being listed, and stock levels are
shown honestly, including when something is running low.
`.trim();

const SYSTEM_PROMPT_HEADER = `
You are the TallyStore support and shopping assistant — a small chat widget on the TallyStore
website. TallyStore sells verified social media and digital accounts (Instagram, TikTok,
Twitter/X, Facebook, etc.) paid for via an in-site wallet.

Your job:
- Answer questions about how purchasing, depositing, and referrals work, using the guide below.
- Act as a shopping assistant: help users find products from the live catalog below, compare
  options, and point them to the right category or product.
- Be concise, friendly, and accurate. Do not invent prices, stock levels, or policies that
  aren't in the information given to you.
- If you don't know something, or the user explicitly asks for a human / says the issue isn't
  resolved, give them the support contact links below rather than guessing.
- Never ask for or handle passwords, card numbers, or 2FA codes in this chat — if a user pastes
  sensitive account credentials, tell them not to share that here and to use the proper account
  delivery flow / support channel instead.

Support contact (only mention this when the user truly needs a human, not for every reply):
- Telegram: ${SUPPORT_TELEGRAM_URL}
- WhatsApp: ${SUPPORT_WHATSAPP_URL}

SITE GUIDE:
${SITE_GUIDE}
`.trim();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured in Edge Function secrets");
    }

    const body = await req.json();
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];

    if (messages.length === 0) {
      return json({ success: false, error: "messages is required" }, 400);
    }

    // Cap history sent to the model to keep latency/cost predictable.
    const trimmedMessages = messages.slice(-20).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? "").slice(0, 4000),
    }));

    // Pull a live, lightweight product catalog so the bot can act as a real
    // shopping assistant instead of guessing at prices/stock. Uses the anon
    // key — these tables are already publicly readable by the storefront.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    let catalogText = "No live product data available right now.";
    try {
      const { data: groups } = await supabase
        .from("product_groups")
        .select("name, description, price, stock_count, categories(name)")
        .eq("is_active", true)
        .order("stock_count", { ascending: false })
        .limit(150);

      if (groups && groups.length > 0) {
        catalogText = groups
          .map((g: any) => {
            const cat = g.categories?.name ?? "Uncategorized";
            const stock =
              g.stock_count > 0 ? `${g.stock_count} in stock` : "out of stock right now";
            return `- [${cat}] ${g.name} — ₦${g.price} (${stock})${
              g.description ? `: ${g.description}` : ""
            }`;
          })
          .join("\n");
      }
    } catch (catalogErr) {
      console.error("Chatbot: failed to load catalog:", catalogErr);
      // Non-fatal — the bot can still answer general questions without it.
    }

    const systemPrompt = `${SYSTEM_PROMPT_HEADER}\n\nLIVE PRODUCT CATALOG (name — price — stock):\n${catalogText}`;

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: systemPrompt,
        messages: trimmedMessages,
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errText);
      throw new Error(`Anthropic API error (${anthropicResponse.status})`);
    }

    const completion = await anthropicResponse.json();
    const reply: string =
      completion?.content?.find((block: any) => block.type === "text")?.text ??
      "Sorry, I couldn't generate a reply just now.";

    return json({ success: true, reply });
  } catch (error: any) {
    console.error("Chatbot error:", error);
    return json(
      {
        success: false,
        error: error?.message || "Something went wrong",
        reply:
          "Sorry, I'm having trouble responding right now. You can reach a human via WhatsApp or Telegram from the Support page.",
      },
      500,
    );
  }
});
