import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ── Inlined from _shared/exchange-rate.ts (dashboard deploy can't resolve shared imports) ──
async function getNgnUsdRate(supabaseAdmin: any): Promise<{ rate: number; source: 'override' | 'live' }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'ngn_usd_rate').single()
    if (!error && data?.value) {
      const parsed = parseFloat(data.value)
      if (!isNaN(parsed) && parsed > 0) return { rate: parsed, source: 'override' }
    }
  } catch (_) { /* fall through */ }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    const json = await res.json()
    const liveRate = json?.rates?.NGN
    if (liveRate && typeof liveRate === 'number' && liveRate > 0) return { rate: liveRate, source: 'live' }
  } catch (_) { /* fall through */ }
  throw new Error('NGN/USD rate unavailable')
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type CatalogProduct = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  stock_count: number;
  availability_status?: string | null;
  is_sellable?: boolean | null;
  auto_fulfill_enabled?: boolean | null;
  muabanvia_product_id?: string | null;
  shopclone_product_id?: string | null;
  shopviaclone_product_id?: string | null;
  category_id?: string | null;
  categories?: { name?: string | null } | null;
};

type ProductCard = {
  id: string;
  name: string;
  price: number;
  categoryId: string | null;
  categoryName: string | null;
  availability: string;
  href: string;
};

type PublicAccountPointer = {
  id: string;
  product_group_id: string;
  status?: string | null;
};

type Intent =
  | "PRODUCT_SEARCH"
  | "CHEAPER"
  | "BETTER"
  | "COMPARE"
  | "VARIANT_QUERY"
  | "BUDGET_QUERY"
  | "PRICE_QUERY"
  | "AVAILABILITY"
  | "DEPOSIT"
  | "PURCHASE"
  | "REFERRAL"
  | "DELIVERY"
  | "REFUND"
  | "PAYMENT"
  | "GIFT_SEARCH"
  | "SUPPORT"
  | "GREETING"
  | "THANKS"
  | "GOODBYE"
  | "UNKNOWN";

type DialogueStage =
  | "OPEN"
  | "DISCOVERY"
  | "QUALIFICATION"
  | "PRODUCT_SELECTION"
  | "COMPARISON"
  | "DECISION"
  | "PURCHASE"
  | "SUPPORT"
  | "POST_PURCHASE";

type ChatEntities = {
  budget: number | null;
  currency: "NGN" | "USD" | null;
  quantity: number | null;
  category: string | null;
  productName: string | null;
  color: string | null;
  size: string | null;
  attributes: string[];
  numbers: number[];
  tokens: string[];
};

type ConversationContext = {
  referenceProductId: string | null;
  referenceProductName: string | null;
  referenceCategory: string | null;
  budget: number | null;
  currency: "NGN" | "USD" | null;
  scope: "current_search" | "product_reference" | "support" | "general";
  confidence: number;
  expiresAfterTurns: number;
};

type PersonalityDecision = {
  humourAllowed: boolean;
  humourProbability: number;
  tone: "support_sensitive" | "direct" | "warm" | "playful";
  reason: string;
};

type DisplayCurrency = "NGN" | "USD";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9₦$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: unknown) {
  const stop = new Set([
    "a", "an", "and", "are", "can", "do", "for", "from", "get", "give", "have",
    "i", "in", "is", "it", "me", "my", "need", "of", "on", "or", "please", "show",
    "the", "this", "to", "want", "what", "with", "you", "much", "price", "cost",
    "available", "stock",
  ]);
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 1 && !stop.has(token));
}

function formatDisplayPrice(valueNgn: number, displayCurrency: DisplayCurrency, ngnUsdRate: number | null) {
  const amount = Number(valueNgn || 0);
  if (displayCurrency === "USD" && ngnUsdRate && ngnUsdRate > 0) {
    return `$${(amount / ngnUsdRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `₦${amount.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

async function resolveNgnUsdRate(supabaseAdmin: ReturnType<typeof createClient> | null) {
  if (!supabaseAdmin) return null;
  try {
    const { rate } = await getNgnUsdRate(supabaseAdmin);
    return rate;
  } catch {
    return null;
  }
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function recentAssistantText(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role === "assistant")
    .slice(-6)
    .map((message) => normalize(message.content))
    .join(" ");
}

function chooseTemplate(candidates: string[], messages: ChatMessage[], seed: string) {
  const recent = recentAssistantText(messages);
  const fresh = candidates.filter((candidate) => !recent.includes(normalize(candidate).slice(0, 36)));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool[hashText(seed) % pool.length] || candidates[0] || "";
}

function extractBudget(message: string) {
  const normalized = normalize(message).replace(/,/g, "");
  const parseAmount = (rawAmount: string, rawSuffix?: string | null) => {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const suffix = String(rawSuffix || "").toLowerCase();
    const multiplier =
      suffix === "k" || suffix === "thousand" ? 1_000 :
      suffix === "m" || suffix === "million" ? 1_000_000 :
      1;
    return Math.round(amount * multiplier);
  };
  const budgetMatch =
    normalized.match(/(?:under|below|less than|max|maximum|budget|not more than)\s*(?:₦|ngn|n|\$)?\s*(\d+(?:\.\d+)?)\s*(k|m|thousand|million)?\b/i) ||
    normalized.match(/(?:₦|ngn|n|\$)\s*(\d+(?:\.\d+)?)\s*(k|m|thousand|million)?\b/i);
  if (!budgetMatch) return null;
  return parseAmount(budgetMatch[1], budgetMatch[2]);
}

function extractCurrency(message: string): "NGN" | "USD" | null {
  const text = normalize(message);
  if (/(?:₦|ngn|\bnaira\b|\bn\b)/i.test(message) || /\bngn\b/.test(text)) return "NGN";
  if (/(?:\$|usd|\bdollar\b|\bdollars\b)/i.test(message) || /\busd\b/.test(text)) return "USD";
  return null;
}

function extractQuantity(message: string) {
  const text = normalize(message);
  const match =
    text.match(/\b(?:qty|quantity|x)\s*(\d{1,3})\b/) ||
    text.match(/\b(\d{1,3})\s*(?:pcs|pieces|accounts|account|items|item)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.min(999, Math.round(value)) : null;
}

function extractColor(message: string) {
  const text = normalize(message);
  const colors = [
    "black", "white", "blue", "red", "green", "yellow", "purple", "pink", "orange",
    "brown", "grey", "gray", "silver", "gold", "beige", "cream", "navy",
  ];
  return colors.find((color) => new RegExp(`\\b${color}\\b`).test(text)) || null;
}

function extractSize(message: string) {
  const text = normalize(message);
  const match =
    text.match(/\b(?:size|sz)\s*([a-z0-9._-]{1,12})\b/) ||
    text.match(/\b([xsml]{1,4}|xxl|xl|small|medium|large)\b/) ||
    text.match(/\b(\d{1,3})\s*(?:gb|tb|mb|ml|l|inch|inches|cm|kg|g)\b/);
  return match ? match[1] : null;
}

function extractNumbers(message: string) {
  return [...normalize(message).matchAll(/\b\d+(?:\.\d+)?\b/g)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value))
    .slice(0, 8);
}

function extractAttributeTokens(message: string) {
  const genericIntentWords = new Set([
    "available", "best", "better", "budget", "buy", "cheaper", "compare", "cost",
    "find", "how", "much", "price", "show", "stock", "under",
  ]);
  return tokenize(message)
    .filter((token) => !genericIntentWords.has(token))
    .filter((token) => token.length >= 3 || /\d/.test(token))
    .slice(0, 12);
}

function classifyIntent(message: string): Intent {
  const text = normalize(message);
  if (/\b(cancel|cancelled|canceled|refund|refunded|money back|reversal|reverse)\b/.test(text)) return "REFUND";
  if (/\b(payment failed|failed payment|deducted|not credited|debited|charged|payment issue|transaction issue|stuck payment|missing payment)\b/.test(text)) return "PAYMENT";
  if (/\b(human|agent|support|whatsapp|telegram|complaint|issue|problem|stuck|missing)\b/.test(text)) return "SUPPORT";
  if (/\b(deposit|top up|topup|fund|wallet|bank transfer|ercas|pocketfi|credit)\b/.test(text)) return "DEPOSIT";
  if (/\b(referral|refer|invite|commission|earn)\b/.test(text)) return "REFERRAL";
  if (/\b(delivery|delivered|login details|details|credentials|order history)\b/.test(text)) return "DELIVERY";
  if (/\b(how.*buy|how.*purchase|checkout|order|buy now|purchase)\b/.test(text)) return "PURCHASE";
  if (/\b(compare|versus|vs|difference|which one)\b/.test(text)) return "COMPARE";
  if (/\b(variant|another type|same but|color|colour|different)\b/.test(text)) return "VARIANT_QUERY";
  if (/\b(budget|under|below|less than|max|maximum|not more than)\b/.test(text)) return "BUDGET_QUERY";
  if (/\b(gift|present|for someone)\b/.test(text)) return "GIFT_SEARCH";
  if (/\b(cheaper|less expensive|lower price|affordable)\b/.test(text)) return "CHEAPER";
  if (/\b(better|upgrade|stronger|higher quality|best)\b/.test(text)) return "BETTER";
  if (/\b(price|cost|how much|amount)\b/.test(text)) return "PRICE_QUERY";
  if (/\b(available|stock|left|in stock)\b/.test(text)) return "AVAILABILITY";
  if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text)) return "GREETING";
  if (/\b(thanks|thank you|appreciate)\b/.test(text)) return "THANKS";
  if (/\b(bye|goodbye|later|see you)\b/.test(text)) return "GOODBYE";
  if (tokenize(message).length > 0) return "PRODUCT_SEARCH";
  return "UNKNOWN";
}

function productText(product: CatalogProduct) {
  return normalize(`${product.name} ${product.description || ""} ${product.categories?.name || ""}`);
}

function characterNgrams(value: string, size = 3) {
  const compact = normalize(value).replace(/\s+/g, "");
  if (!compact) return [];
  if (compact.length <= size) return [compact];
  const grams: string[] = [];
  for (let index = 0; index <= compact.length - size; index += 1) {
    grams.push(compact.slice(index, index + size));
  }
  return grams;
}

function tokenSimilarity(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(left.length, right.length);
}

function scoreTextRelevance(message: string, product: CatalogProduct) {
  const normalizedQuery = normalize(message);
  const normalizedName = normalize(product.name);
  const normalizedCategory = normalize(product.categories?.name);
  const haystack = productText(product);
  const queryTokens = tokenize(message);
  const productTokens = haystack.split(" ").filter(Boolean);
  const productTokenSet = new Set(productTokens);
  const exactName = Boolean(normalizedName && normalizedQuery.includes(normalizedName));
  const phrase = Boolean(normalizedQuery && haystack.includes(normalizedQuery));
  const exactTokenMatches = queryTokens.filter((token) => productTokenSet.has(token)).length;
  const prefixMatches = queryTokens.filter((token) =>
    token.length >= 2 && !productTokenSet.has(token) && productTokens.some((productToken) => productToken.startsWith(token)),
  ).length;
  const missingTokens = Math.max(0, queryTokens.length - exactTokenMatches - prefixMatches);
  const ngramSimilarity = tokenSimilarity(characterNgrams(normalizedQuery), characterNgrams(haystack));
  const categoryMatch = Boolean(normalizedCategory && (
    normalizedCategory === normalizedQuery ||
    normalizedCategory.includes(normalizedQuery) ||
    queryTokens.some((token) => normalizedCategory.split(" ").includes(token))
  ));
  const score = Math.round(
    (exactName ? 5000 : phrase ? 3500 : 0) +
      exactTokenMatches * 700 +
      prefixMatches * 360 -
      missingTokens * 110 +
      ngramSimilarity * 520 +
      (categoryMatch ? 420 : 0),
  );
  const matched = exactName || phrase || exactTokenMatches > 0 || prefixMatches > 0 || ngramSimilarity >= 0.16 || categoryMatch;

  return {
    score,
    matched,
    exactName,
    phrase,
    exactTokenMatches,
    prefixMatches,
    ngramSimilarity,
    categoryMatch,
  };
}

function canAutoFulfill(product: CatalogProduct) {
  return Boolean(
    product.auto_fulfill_enabled &&
      (product.muabanvia_product_id ||
        product.shopclone_product_id ||
        product.shopviaclone_product_id),
  );
}

function isLiveSellableProduct(product: CatalogProduct) {
  const price = Number(product.price);
  const explicitSellable = product.is_sellable;
  const availabilityStatus = String(product.availability_status || "").toUpperCase();
  const statusSellable = ["AVAILABLE", "LOW_STOCK", "PREORDER", "BACKORDER", "UNLIMITED"].includes(availabilityStatus);
  const statusBlocked = ["UNAVAILABLE", "PAUSED"].includes(availabilityStatus);
  return Number.isFinite(price) &&
    price > 0 &&
    explicitSellable !== false &&
    (explicitSellable === true || (!statusBlocked && (statusSellable || Number(product.stock_count || 0) > 0 || canAutoFulfill(product))));
}

function findReferencedProduct(messages: ChatMessage[], products: CatalogProduct[], maxTurns = 4) {
  const recentAssistantText = messages
    .filter((message) => message.role === "assistant")
    .slice(-maxTurns)
    .map((message) => normalize(message.content))
    .join(" ");

  if (!recentAssistantText) return null;
  return products.find((product) => recentAssistantText.includes(normalize(product.name))) || null;
}

function extractEntities(message: string, products: CatalogProduct[], referencedProduct: CatalogProduct | null): ChatEntities {
  const tokens = tokenize(message);
  const normalizedMessage = normalize(message);
  const exactProduct = products.find((product) => {
    const name = normalize(product.name);
    return name && normalizedMessage.includes(name);
  }) || null;
  const categories = [...new Set(products.map((product) => product.categories?.name).filter(Boolean).map((name) => String(name)))]
  const category = categories.find((name) => {
    const normalizedName = normalize(name);
    return normalizedName && normalizedMessage.includes(normalizedName);
  }) || referencedProduct?.categories?.name || null;

  return {
    budget: extractBudget(message),
    currency: extractCurrency(message),
    quantity: extractQuantity(message),
    category,
    productName: exactProduct?.name || referencedProduct?.name || null,
    color: extractColor(message),
    size: extractSize(message),
    attributes: extractAttributeTokens(message),
    numbers: extractNumbers(message),
    tokens,
  };
}

function resolveConversationContext(
  messages: ChatMessage[],
  products: CatalogProduct[],
  latest: string,
  intent: Intent,
  referencedProduct: CatalogProduct | null,
  entities: ChatEntities,
): ConversationContext {
  const userTurnsSinceReference = messages
    .slice()
    .reverse()
    .findIndex((message) => message.role === "assistant" && referencedProduct && normalize(message.content).includes(normalize(referencedProduct.name)));
  const freshReference = referencedProduct && userTurnsSinceReference >= 0 && userTurnsSinceReference <= 6;
  const exactProduct = entities.productName
    ? products.find((product) => normalize(product.name) === normalize(entities.productName)) || referencedProduct
    : referencedProduct;
  const hasScopedProductIntent = ["CHEAPER", "BETTER", "COMPARE", "VARIANT_QUERY", "PRICE_QUERY", "AVAILABILITY"].includes(intent);
  const scope: ConversationContext["scope"] = intent === "SUPPORT"
    ? "support"
    : exactProduct && (freshReference || hasScopedProductIntent)
      ? "product_reference"
      : entities.tokens.length > 0
        ? "current_search"
        : "general";
  const expiresAfterTurns = scope === "product_reference" ? 4 : scope === "current_search" ? 2 : 1;
  const confidence =
    scope === "product_reference" && exactProduct ? 0.82 :
    scope === "current_search" && entities.tokens.length > 0 ? 0.58 :
    scope === "support" ? 0.9 :
    0.35;

  return {
    referenceProductId: exactProduct?.id || null,
    referenceProductName: exactProduct?.name || null,
    referenceCategory: exactProduct?.categories?.name || entities.category || null,
    budget: entities.budget,
    currency: entities.currency,
    scope,
    confidence,
    expiresAfterTurns,
  };
}

function dialogueStageForIntent(intent: Intent, scoredCount = 0): DialogueStage {
  if (["SUPPORT", "REFUND", "PAYMENT"].includes(intent)) return "SUPPORT";
  if (["DELIVERY", "THANKS", "GOODBYE"].includes(intent)) return "POST_PURCHASE";
  if (["PURCHASE", "PRICE_QUERY", "AVAILABILITY"].includes(intent)) return "DECISION";
  if (["COMPARE", "CHEAPER", "BETTER", "VARIANT_QUERY"].includes(intent)) return "COMPARISON";
  if (["BUDGET_QUERY", "GIFT_SEARCH"].includes(intent)) return "QUALIFICATION";
  if (intent === "PRODUCT_SEARCH" && scoredCount > 0) return "PRODUCT_SELECTION";
  if (intent === "GREETING") return "OPEN";
  return "DISCOVERY";
}

function decidePersonality(messages: ChatMessage[], intent: Intent, latest: string): PersonalityDecision {
  const text = normalize(latest);
  const supportSensitive = ["SUPPORT", "REFUND", "PAYMENT"].includes(intent)
    || /\b(failed|deducted|refund|complaint|angry|scam|wrong|missing|not credited)\b/.test(text);
  if (supportSensitive) {
    return {
      humourAllowed: false,
      humourProbability: 0,
      tone: "support_sensitive",
      reason: "support_or_payment_state_overrides_personality",
    };
  }

  const playfulSignal = /(?:😂|🤣|lol|lmao|\bfair\b|\bsay less\b|\bsharp\b|\babeg\b)/i.test(latest);
  const recentAssistant = recentAssistantText(messages);
  const recentlyPlayful = /\b(?:fair|say less|makes sense)\b/.test(recentAssistant);
  const humourAllowed = playfulSignal && !recentlyPlayful && !["PURCHASE", "PRICE_QUERY", "AVAILABILITY"].includes(intent);
  return {
    humourAllowed,
    humourProbability: humourAllowed ? 0.25 : 0,
    tone: humourAllowed ? "playful" : "warm",
    reason: humourAllowed ? "customer_style_allows_light_humour" : "default_commerce_tone",
  };
}

function scoreProducts(
  message: string,
  intent: Intent,
  products: CatalogProduct[],
  referencedProduct: CatalogProduct | null,
  entities: ChatEntities,
  ngnUsdRate: number | null,
) {
  const queryTokens = tokenize(message);
  const budget = entities.currency === "USD" && entities.budget != null
    ? ngnUsdRate && ngnUsdRate > 0
      ? entities.budget * ngnUsdRate
      : null
    : entities.budget;

  return products
    .map((product) => {
      const text = productText(product);
      const relevance = scoreTextRelevance(message, product);
      const tokenMatches = queryTokens.filter((token) => text.includes(token)).length;
      const colorMatch = entities.color ? text.includes(normalize(entities.color)) : false;
      const sizeMatch = entities.size ? text.includes(normalize(entities.size)) : false;
      const attributeMatches = entities.attributes.filter((attribute) => text.includes(normalize(attribute))).length;
      const categoryMatch = entities.category && normalize(product.categories?.name) === normalize(entities.category);
      const exactNameMatch = normalize(product.name) && normalize(message).includes(normalize(product.name));
      const hasSearchEvidence = Boolean(relevance.matched || exactNameMatch || categoryMatch || tokenMatches > 0 || colorMatch || sizeMatch || attributeMatches > 0);
      const inStock = isLiveSellableProduct(product);
      const budgetOk = budget == null || Number(product.price || 0) <= budget;
      const cheaperOk = intent !== "CHEAPER" || !referencedProduct || Number(product.price || 0) < Number(referencedProduct.price || 0);
      const betterOk = !["BETTER", "COMPARE"].includes(intent) || !referencedProduct || Number(product.price || 0) >= Number(referencedProduct.price || 0);
      const variantOk = intent !== "VARIANT_QUERY" || !referencedProduct || (
        product.id !== referencedProduct.id &&
        normalize(product.categories?.name) === normalize(referencedProduct.categories?.name)
      );

      let score = 0;
      score += relevance.score;
      if (exactNameMatch && !relevance.exactName) score += 5000;
      if (categoryMatch) score += 900;
      score += Math.max(0, tokenMatches - relevance.exactTokenMatches) * 420;
      if (colorMatch) score += 650;
      if (sizeMatch) score += 650;
      score += attributeMatches * 220;
      if (intent === "VARIANT_QUERY" && variantOk) score += 1200;
      if (intent === "COMPARE" && referencedProduct && product.id !== referencedProduct.id) score += 900;
      if (intent === "BUDGET_QUERY" && budgetOk) score += 850;
      if (intent === "GIFT_SEARCH") score += categoryMatch ? 800 : 120;
      if (budgetOk) score += 300;
      if (inStock) score += Math.min(Number(product.stock_count || 0), 100);
      else score -= 5000;
      if (!cheaperOk || !betterOk || !variantOk) score -= 10000;
      if (intent === "PRICE_QUERY" || intent === "AVAILABILITY") score += relevance.matched || exactNameMatch || tokenMatches > 0 ? 1000 : 0;
      if (["PRODUCT_SEARCH", "PRICE_QUERY", "AVAILABILITY"].includes(intent) && !hasSearchEvidence && !budget) score -= 10000;
      if (["CHEAPER", "BETTER", "COMPARE", "VARIANT_QUERY"].includes(intent) && !referencedProduct && !hasSearchEvidence) score -= 10000;

      return { product, score, budgetOk, inStock };
    })
    .filter((row) => row.score > 0 && row.budgetOk && row.inStock)
    .sort((a, b) => b.score - a.score || Number(b.product.stock_count || 0) - Number(a.product.stock_count || 0))
    .slice(0, 4);
}

function needsClarifyingProductReference(intent: Intent, entities: ChatEntities, referencedProduct: CatalogProduct | null) {
  if (referencedProduct) return false;
  if (entities.productName || entities.category || entities.budget || entities.attributes.length > 0 || entities.color || entities.size) return false;
  return ["PRICE_QUERY", "AVAILABILITY", "CHEAPER", "BETTER", "COMPARE", "VARIANT_QUERY"].includes(intent);
}

function clarificationReply(intent: Intent, messages: ChatMessage[], latest: string) {
  if (intent === "CHEAPER") {
    return chooseTemplate([
      "Which product should I compare against? Send the product name and I’ll look for cheaper live stock.",
      "Tell me the product you want cheaper than, then I’ll compare only available live stock.",
    ], messages, latest);
  }
  if (intent === "BETTER" || intent === "COMPARE" || intent === "VARIANT_QUERY") {
    return chooseTemplate([
      "Which product or category should I compare? Send the name and I’ll check live alternatives.",
      "Send the product name or category first, then I’ll compare available options without guessing.",
    ], messages, latest);
  }
  return chooseTemplate([
    "Which product do you mean? Send the name or category and I’ll check the live price and stock.",
    "Tell me the product or category first, then I’ll check the live catalogue.",
  ], messages, latest);
}

async function loadAppSetting(supabase: ReturnType<typeof createClient>, key: string, fallback: string) {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value || fallback;
}

function scrubSupportContext(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email hidden]")
    .replace(/\b(password|pass|2fa|otp|token|secret|api[_ -]?key|key)\s*[:=]\s*\S+/gi, "$1: [hidden]")
    .replace(/\b(order|order[_ -]?id|payment|payment[_ -]?id|payment[_ -]?reference|transaction|transaction[_ -]?id|transaction[_ -]?reference|reference|ref)\s*[:=#-]?\s*[a-z0-9_-]{6,}/gi, "$1: [hidden]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id hidden]")
    .replace(/https?:\/\/\S+/gi, "[link hidden]")
    .replace(/\b\d{12,19}\b/g, "[number hidden]")
    .replace(/(?:\+?\d[\s().-]*){10,}/g, "[number hidden]")
    .trim()
    .slice(0, 220);
}

function withWhatsappPrefill(rawUrl: string, message: string) {
  if (!rawUrl || !message) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("text", message);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function supportReply(whatsappUrl: string, telegramUrl: string, latest: string, pagePath = "") {
  const safeContext = scrubSupportContext(latest);
  const safePath = scrubSupportContext(String(pagePath || "")).slice(0, 120);
  const suggested = [
    "I need help with this issue:",
    safeContext || "Please help me check my account/order.",
    safePath ? `Page: ${safePath}` : "",
  ].filter(Boolean).join(" ");
  const whatsappSupportUrl = withWhatsappPrefill(whatsappUrl, suggested);
  const lines = [
    "This one is better handled by support so we do not guess with your money or order.",
    whatsappSupportUrl ? `WhatsApp support: ${whatsappSupportUrl}` : "",
    telegramUrl ? `Telegram support: ${telegramUrl}` : "",
    `Suggested message: ${suggested}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function staticReply(intent: Intent, whatsappUrl: string, telegramUrl: string, messages: ChatMessage[], latest: string, pagePath = "") {
  if (intent === "GREETING") {
    return chooseTemplate([
      "Hi. Tell me the account type, platform, or budget you want and I’ll search live stock.",
      "Hi. Send the platform, account type, or budget and I’ll check what is actually available.",
      "Hello. Give me a product name, platform, or budget and I’ll search live stock only.",
    ], messages, latest);
  }
  if (intent === "THANKS") {
    return chooseTemplate(["You’re welcome.", "Anytime.", "No problem."], messages, latest);
  }
  if (intent === "GOODBYE") {
    return chooseTemplate(["No problem. I’ll be here if you need another product check.", "Alright. Come back anytime you want live stock checked."], messages, latest);
  }
  if (intent === "DEPOSIT") {
    return "To fund your wallet, open Wallet and choose Add Funds. Ercas creates a fresh checkout each time, while PocketFi gives you a reusable virtual account if enabled. If a successful payment delays, use payment recovery before contacting support.";
  }
  if (intent === "PURCHASE") {
    return "Browse a product, choose the quantity, then confirm checkout from your wallet. Delivered account details appear in Orders after a successful purchase.";
  }
  if (intent === "DELIVERY") {
    return "Completed purchases stay in Orders. Open Order History, choose the order, then use Copy or Download to view the delivered account details.";
  }
  if (intent === "REFERRAL") {
    return "Your referral link/code is in the Referrals area. When someone signs up through it, their completed purchases can earn referral commission according to the active admin setting.";
  }
  if (["SUPPORT", "REFUND", "PAYMENT"].includes(intent)) return supportReply(whatsappUrl, telegramUrl, latest, pagePath);
  return "";
}

function responsePlanForIntent(intent: Intent) {
  if (intent === "CHEAPER") return "SHOW_DOWNGRADE";
  if (intent === "BETTER") return "SHOW_UPGRADE";
  if (intent === "COMPARE") return "SHOW_ALTERNATIVE";
  if (intent === "VARIANT_QUERY") return "SHOW_ALTERNATIVE";
  if (intent === "BUDGET_QUERY") return "SHOW_REQUESTED_PRODUCT";
  if (intent === "GIFT_SEARCH") return "SHOW_ALTERNATIVE";
  if (intent === "PRICE_QUERY") return "SHOW_REQUESTED_PRODUCT";
  if (intent === "AVAILABILITY") return "SHOW_REQUESTED_PRODUCT";
  return "SHOW_REQUESTED_PRODUCT";
}

function renderProductReply(
  intent: Intent,
  scored: Array<{ product: CatalogProduct; score: number }>,
  referencedProduct: CatalogProduct | null,
  messages: ChatMessage[],
  latest: string,
  personality: PersonalityDecision,
  displayCurrency: DisplayCurrency,
  ngnUsdRate: number | null,
) {
  if (scored.length === 0) {
    if (intent === "CHEAPER" && referencedProduct) {
      return `I could not find a cheaper in-stock alternative to ${referencedProduct.name} from live stock right now.`;
    }
    return "I could not find a matching in-stock product from the live catalogue. Try a product name, category, or budget like “under 5000”.";
  }

  const acknowledgement = chooseTemplate(
    personality.humourAllowed
      ? ["Fair. I checked live stock:", "Got you. Here is the cleanest live match:", "Say less. Live catalogue says:"]
      : ["I checked live stock:", "Here is what is live right now:", "Current live catalogue match:"],
    messages,
    latest,
  );
  const intro = chooseTemplate(
    intent === "CHEAPER" ? ["Closest cheaper live options:", "These are the cheaper in-stock options:", "Lower-priced live matches:"] :
    intent === "BETTER" ? ["Best matching live options:", "Higher-fit live options:", "Strongest live matches:"] :
    intent === "COMPARE" ? ["Closest comparison options:", "Comparable live options:", "Best live products to compare:"] :
    intent === "VARIANT_QUERY" ? ["Closest live variants:", "Same-category live alternatives:", "Available variant-style options:"] :
    intent === "BUDGET_QUERY" ? ["Best live matches inside that budget:", "Budget-safe live options:", "Available options that fit the budget:"] :
    intent === "GIFT_SEARCH" ? ["Gift-friendly live options:", "These are the safest live matches to consider:", "Good live options to check:"] :
    intent === "PRICE_QUERY" ? ["Current live price result:", "Live price match:", "Current price from live stock:"] :
    intent === "AVAILABILITY" ? ["Current live stock result:", "Live availability result:", "Available live stock:"] :
    ["Best live matches:", "Live matches worth checking:", "Matching in-stock options:"],
    messages,
    latest,
  );

  const rows = scored.map(({ product }, index) => {
    const category = product.categories?.name ? `${product.categories.name} · ` : "";
    const stock = Number(product.stock_count || 0);
    const availability = stock > 0 ? `${stock} left` : "auto delivery";
    const comparison = referencedProduct && product.id !== referencedProduct.id
      ? Number(product.price || 0) < Number(referencedProduct.price || 0)
        ? ` · saves ${formatDisplayPrice(Number(referencedProduct.price || 0) - Number(product.price || 0), displayCurrency, ngnUsdRate)}`
        : Number(product.price || 0) > Number(referencedProduct.price || 0)
          ? ` · +${formatDisplayPrice(Number(product.price || 0) - Number(referencedProduct.price || 0), displayCurrency, ngnUsdRate)}`
          : ""
      : "";
    return `${index + 1}. ${product.name}\n${category}${formatDisplayPrice(product.price, displayCurrency, ngnUsdRate)} · ${availability}${comparison}`;
  });

  const cta = intent === "PRICE_QUERY" || intent === "AVAILABILITY"
    ? "Tap the matching product on the page when you are ready."
    : "Tap the product from the page to buy.";
  return `${acknowledgement}\n${intro}\n\n${rows.join("\n\n")}\n\n${cta} I will not invent hidden stock or prices.`;
}

function buildProductCards(
  scored: Array<{ product: CatalogProduct; score: number }>,
  accountMap: Map<string, string>,
): ProductCard[] {
  return scored.slice(0, 4).map(({ product }) => {
    const stock = Number(product.stock_count || 0);
    const accountId = accountMap.get(product.id);
    return {
      id: product.id,
      name: product.name,
      price: Number(product.price || 0),
      categoryId: product.category_id || null,
      categoryName: product.categories?.name || null,
      availability: stock > 0 ? `${stock} left` : "Auto delivery",
      href: accountId
        ? `/product/${accountId}`
        : product.category_id
          ? `/category/${product.category_id}`
          : "/products",
    };
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    const pagePath = typeof body?.pagePath === "string" ? body.pagePath : "";
    const displayCurrency: DisplayCurrency = body?.displayCurrency === "USD" ? "USD" : "NGN";
    const latest = messages.filter((message) => message.role === "user").at(-1)?.content || "";

    if (!latest.trim()) return json({ success: false, error: "A user message is required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const [
      whatsappUrl,
      telegramUrl,
      croGlobalEnabled,
      croFreezeReason,
      { data: products, error: productsError },
      { data: accountPointers, error: accountPointerError },
    ] = await Promise.all([
      loadAppSetting(supabase, "support_whatsapp_url", ""),
      loadAppSetting(supabase, "support_telegram_url", ""),
      loadAppSetting(supabaseAdmin, "cro_global_enabled", "false"),
      loadAppSetting(supabaseAdmin, "cro_maintenance_freeze_reason", ""),
      supabase
        .from("product_groups")
        .select("*,categories(name)")
        .eq("is_active", true)
        .gt("price", 0)
        .order("stock_count", { ascending: false })
        .limit(1000),
      supabase
        .from("individual_accounts_public")
        .select("id,product_group_id,status")
        .in("status", ["available"])
        .limit(500),
    ]);

    if (productsError) throw productsError;
    if (accountPointerError) {
      console.warn("Chatbot could not load public account pointers:", accountPointerError.message);
    }

    const liveProducts = ((products || []) as CatalogProduct[]).filter(isLiveSellableProduct);
    const ngnUsdRate = displayCurrency === "USD" ? await resolveNgnUsdRate(supabaseAdmin) : null;
    const accountMap = new Map<string, string>();
    for (const account of ((accountPointers || []) as PublicAccountPointer[])) {
      if (account.product_group_id && account.id && !accountMap.has(account.product_group_id)) {
        accountMap.set(account.product_group_id, account.id);
      }
    }
    const referenced = findReferencedProduct(messages, liveProducts);
    const intent = classifyIntent(latest);
    const entities = extractEntities(latest, liveProducts, referenced);
    const conversationContext = resolveConversationContext(messages, liveProducts, latest, intent, referenced, entities);
    const personality = decidePersonality(messages, intent, latest);
    const basic = staticReply(intent, whatsappUrl, telegramUrl, messages, latest, pagePath);
    const sellingEnabled = croGlobalEnabled !== "false" && !String(croFreezeReason || "").trim();

    if (!basic && needsClarifyingProductReference(intent, entities, referenced)) {
      const reply = clarificationReply(intent, messages, latest);
      return json({
        success: true,
        reply,
        intent,
        entities,
        conversationContext,
        conversationStage: "QUALIFICATION",
        personality,
        responsePlan: "ASK_FEATURE",
        supportHandoff: false,
        productIds: [],
        productCards: [],
        templateId: `clarify:${intent}:${hashText(reply)}`,
      });
    }

    if (basic) {
      const conversationStage = dialogueStageForIntent(intent, 0);
      const normalizedResponsePlan = ["SUPPORT", "REFUND", "PAYMENT"].includes(intent)
        ? "SUPPORT_HANDOFF"
        : responsePlanForIntent(intent);
      return json({
        success: true,
        reply: basic,
        intent,
        entities,
        conversationContext,
        conversationStage,
        personality,
        responsePlan: normalizedResponsePlan,
        supportHandoff: ["SUPPORT", "REFUND", "PAYMENT"].includes(intent),
        productIds: [],
        productCards: [],
        templateId: `static:${intent}:${hashText(basic)}`,
      });
    }

    if (!sellingEnabled) {
      const reply = croFreezeReason
        ? "Product recommendations are temporarily paused while we verify catalogue and sales data. You can still browse products and buy normally from the page."
        : "Product recommendations are currently paused. You can still browse products and buy normally from the page.";
      return json({
        success: true,
        reply,
        intent,
        entities,
        conversationContext,
        conversationStage: "DISCOVERY",
        personality,
        responsePlan: "DO_NOTHING",
        supportHandoff: false,
        productIds: [],
        productCards: [],
        templateId: `cro_paused:${hashText(reply)}`,
      });
    }

    const scored = scoreProducts(latest, intent, liveProducts, referenced, entities, ngnUsdRate);
    const conversationStage = dialogueStageForIntent(intent, scored.length);
    const responsePlan = responsePlanForIntent(intent);
    return json({
      success: true,
      reply: renderProductReply(intent, scored, referenced, messages, latest, personality, displayCurrency, ngnUsdRate),
      intent,
      entities,
      conversationContext,
      conversationStage,
      personality,
      responsePlan,
      supportHandoff: false,
      productIds: scored.map(({ product }) => product.id),
      productCards: buildProductCards(scored, accountMap),
      templateId: `product:${intent}:${responsePlan}:${scored.length}`,
    });
  } catch (error: any) {
    console.error("Deterministic chatbot error:", error);
    return json({
      success: false,
      error: error?.message || "Something went wrong",
      reply: "I could not check live stock right now. Please use the product page or contact support.",
    }, 500);
  }
});
