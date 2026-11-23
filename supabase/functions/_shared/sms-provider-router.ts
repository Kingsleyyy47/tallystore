import { smsRoutingState, rankedSmsOffers, recordSmsProviderEvent } from './sms-provider-policy.ts';
import { providerRead, invalidateProviderRead } from "./provider-read-cache.ts";
import { countryInfo, isoCountry } from "./provider-countries.ts";
import { providerHttp } from "./provider-http.ts";
import {
  ProviderDeclined,
  smsProductName,
  tryProductFallback,
} from "./provider-contract.ts";
import { SERVICE_NAMES } from "./daisysms-client.ts";

type Provider =
  | "daisysms_io"
  | "daisysms_com"
  | "getatext"
  | "daisysim"
  | "herosms"
  | "textverify"
  | "smsbus";
export type SmsOffer = {
  provider: Provider;
  id: string;
  name: string;
  country: string;
  countryId: string;
  price: number;
  count: number;
  route?: string;
  multipleMessages?: boolean;
};
export type SmsProduct = {
  code: string;
  name: string;
  count: number;
  priceUsd: number;
  multipleMessages: boolean;
  offers: SmsOffer[];
};
export type SmsReceipt = {
  activationId: string;
  phoneNumber: string;
  priceUsd: number;
};
export type SmsStatus =
  | { status: "ok"; code: string }
  | { status: "waiting" }
  | { status: "cancelled" };
const env = (key: string) => Deno.env.get(key)?.trim() || "";
const keys: Record<Provider, () => string> = {
  daisysms_io: () =>
    env("DAISYSMS_IO_API_KEY") ||
    (legacyDomain() === "io" ? env("DAISYSMS_API_KEY") : ""),
  daisysms_com: () =>
    env("DAISYSMS_COM_API_KEY") ||
    (legacyDomain() === "com" ? env("DAISYSMS_API_KEY") : ""),
  getatext: () => env("GETATEXT_API_KEY"),
  daisysim: () => env("DAISYSIM_API_KEY"),
  herosms: () => env("HEROSMS_API_KEY") || env("SMSACTIVATE_API_KEY"),
  textverify: () => env("TEXTVERIFY_API_KEY"),
  smsbus: () => env("SMSBUS_API_KEY"),
};
function legacyDomain() {
  return env("DAISYSMS_BASE_URL").includes("daisysms.com/") ? "com" : "io";
}
export function smsProvidersConfigured() {
  return Object.entries(keys).filter(([, key]) => !!key()).map(([name]) =>
    name
  );
}
export function smsCountryFromCode(code: string) {
  return /^c-([A-Z]{2})~/.exec(code)?.[1] || "US";
}
async function fetchSmsCountries() {
  const output = new Set<string>();
  if (
    smsProvidersConfigured().some((provider) =>
      ["daisysms_io", "daisysms_com", "getatext", "textverify"].includes(
        provider,
      )
    )
  ) output.add("US");
  const tasks: Array<Promise<void>> = [];
  if (keys.smsbus()) {
    tasks.push(
      bus("/list/countries").then((result) => {
        assertRead(result);
        for (const row of values(result.data?.data)) {
          const code = isoCountry(String(row.code || row.title));
          if (code) output.add(code);
        }
      }),
    );
  }
  if (keys.daisysim()) {
    tasks.push(
      json("daisysim", "/countries").then((result) => {
        assertRead(result);
        for (const row of values(result.data?.data?.countries)) {
          const code = isoCountry(String(row.name));
          if (code) output.add(code);
        }
      }),
    );
  }
  if (keys.herosms() && env("HEROSMS_CURRENCY") === "USD") {
    tasks.push(
      handler("herosms", { action: "getCountries" }).then((result) => {
        assertRead(result);
        for (const row of values(result.data)) {
          const code = isoCountry(String(row.eng || row.name));
          if (code) output.add(code);
        }
      }),
    );
  }
  await Promise.allSettled(tasks);
  return [...output].map(countryInfo).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

// DaisySim quotes expire after five minutes and its prices API permits only
// 30 calls/minute. Admin sync imports at most 20 exact service quotes per page;
// each paid purchase obtains a fresh route instead of reusing an expired one.
export async function syncDaisySimPage(
  admin: any,
  countryCode = "US",
  cursor = 0,
) {
  countryInfo(countryCode);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("CURSOR_INVALID");
  }
  const countries = await json("daisysim", "/countries");
  assertRead(countries);
  const country = values(countries.data?.data?.countries).find((row) =>
    isoCountry(String(row.name)) === countryCode
  );
  if (!country) return { processed: 0, next_cursor: null };
  const services = await json("daisysim", `/services/${country.id}`);
  assertRead(services);
  const list = values(services.data?.data?.services);
  let processed = 0;
  for (const row of list.slice(cursor, cursor + 20)) {
    const result = await json("daisysim", "/prices", {
      country: country.id,
      service: row.code,
    });
    assertRead(result);
    const tiers = values(result.data?.data?.tiers).filter((tier) =>
      Number(tier.available) > 0 && Number(tier.price) > 0
    ).sort((a, b) => Number(a.price) - Number(b.price));
    if (!tiers.length) continue;
    const offer: SmsOffer = {
      provider: "daisysim",
      id: String(row.code),
      name: String(row.name),
      country: countryCode,
      countryId: String(country.id),
      price: Number(tiers[0].price),
      count: tiers.reduce((sum, tier) => sum + Number(tier.available), 0),
    };
    const saved = await admin.from("supplier_product_routes").upsert({
      family: "sms",
      product_key: `daisysim:${countryCode}:${offer.id}`,
      match_key: `${countryCode}:${smsProductName(offer.name)}`,
      routes: [offer],
      synced_at: new Date().toISOString(),
    }, { onConflict: "family,product_key" });
    if (saved.error) throw new Error("SMS_CATALOG_SAVE_FAILED");
    processed++;
  }
  caches.delete(countryCode);
  invalidateProviderRead(`sms-catalogue:${countryCode}`);
  return {
    processed,
    next_cursor: cursor + 20 < list.length ? cursor + 20 : null,
  };
}
const handlerBases: Partial<Record<Provider, string>> = {
  daisysms_io: "https://daisysms.io/stubs/handler_api.php",
  daisysms_com: "https://daisysms.com/stubs/handler_api.php",
  herosms: "https://hero-sms.com/stubs/handler_api.php",
};
function credential(provider: Provider) {
  const value = keys[provider]?.();
  if (!value) throw new Error("SUPPLIER_NOT_CONFIGURED");
  return value;
}
async function handler(
  provider: Provider,
  params: Record<string, string | number>,
  timeoutMs=20_000,
) {
  const url = new URL(handlerBases[provider]!);
  url.searchParams.set("api_key", credential(provider));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  if(params.action==='getCountries'||params.action==='getServicesList')return providerRead(`sms-metadata:${provider}:${String(params.action)}:${String(params.country||'')}`,300_000,async()=>{const result=await providerHttp(url,{},undefined,timeoutMs);assertRead(result);return result});
  return providerHttp(url,{},undefined,timeoutMs);
}
async function json(provider: Provider, path: string, body?: unknown, timeoutMs=20_000) {
  const base = provider === "getatext"
    ? "https://getatext.com/api/v1"
    : provider === "daisysim"
    ? "https://daisysim.com/api/v1/virtual"
    : "https://panel.textverify.io/api/v2";
  return providerHttp(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider === "getatext"
        ? { Auth: credential(provider) }
        : { Authorization: `Bearer ${credential(provider)}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  },undefined,timeoutMs);
}
async function bus(
  path: string,
  params: Record<string, string | number> = {},
  rental = false,
  timeoutMs=20_000,
) {
  const url = new URL(
    `${
      rental
        ? "https://api.sms-bus.com/v1/rent"
        : "https://sms-bus.com/api/control"
    }${path}`,
  );
  url.searchParams.set("token", credential("smsbus"));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  if(path==='/list/countries'||path==='/list/projects')return providerRead(`smsbus-metadata:${path}`,300_000,async()=>{const result=await providerHttp(url,{},undefined,timeoutMs);assertRead(result);return result});
  return providerHttp(url,{},undefined,timeoutMs);
}
const values = (data: any): any[] =>
  Array.isArray(data)
    ? data
    : data && typeof data === "object"
    ? Object.values(data)
    : [];
function validOffer(offer: SmsOffer) {
  return offer.id && offer.name && Number.isFinite(offer.price) &&
    offer.price > 0 && Number.isFinite(offer.count) && offer.count >= 0;
}
function assertRead(result: Awaited<ReturnType<typeof providerHttp>>) {
  if (
    !result.ok || result.data?.success === false || result.text === "BAD_KEY"
  ) throw new Error("SUPPLIER_CATALOG_UNAVAILABLE");
}
async function listOffers(
  provider: Provider,
  countryCode = "US",
): Promise<SmsOffer[]> {
  if (
    ["daisysms_io", "daisysms_com", "getatext", "textverify"].includes(
      provider,
    ) && countryCode !== "US"
  ) return [];
  if (provider === "daisysms_io" || provider === "daisysms_com") {
    const result = await handler(provider, { action: "getPricesVerification" });
    assertRead(result);
    if (!result.data || typeof result.data !== "object") {
      throw new Error("SUPPLIER_CATALOG_UNAVAILABLE");
    }
    const output: SmsOffer[] = [];
    const raw = result.data;
    const add = (id: string, row: any) => {
      if (!row || typeof row !== "object") return;
      // Unknown shortcodes are isolated per provider until a readable name is supplied.
      const name = row.name || row.service_name || SERVICE_NAMES[id] ||
        `${provider} ${id}`;
      output.push({
        provider,
        id,
        name,
        country: "US",
        countryId: "187",
        price: Number(row.price ?? row.cost),
        count: Number(row.count ?? row.total_count ?? 0),
        multipleMessages: Number(row.multipleMessages ?? row.multi) === 1,
      });
    };
    if (raw["187"]) {
      for (const [id, row] of Object.entries(raw["187"])) add(id, row);
    } else {for (const [id, countries] of Object.entries(raw)) {
        add(id, (countries as any)?.["187"] ?? countries);
      }}
    return output.filter(validOffer);
  }
  if (provider === "getatext") {
    const result = await json(provider, "/prices-info");
    assertRead(result);
    const raw = result.data?.prices ?? result.data?.data ?? result.data;
    const rows = raw?.api_name ? [raw] : values(raw);
    return rows.filter(row=>row&&typeof row==="object"&&!Array.isArray(row)).map((row) => ({
      provider,
      id: String(row.api_name || ""),
      name: String(row.service_name || ""),
      country: "US",
      countryId: "US",
      price: Number(row.price),
      count: Number(row.stock),
      multipleMessages: row.multiple_sms === true ||
        row.multiple_sms === "true",
    })).filter(validOffer);
  }
  if (provider === "daisysim") {
    const countries = await json(provider, "/countries");
    assertRead(countries);
    const country = values(countries.data?.data?.countries).find((row) =>
      isoCountry(String(row.name)) === countryCode
    );
    if (!country) return [];
    const result = await json(provider, `/services/${country.id}`);
    assertRead(result);
    // Discovery is inexpensive. Price lookup is limited to 30/min, so quotes are
    // fetched on selection, not for every service in a catalogue fan-out.
    const list = values(result.data?.data?.services);
    return list.flatMap((row) => {
      const price = Number(row.price);
      return Number.isFinite(price) && price > 0
        ? [{
          provider,
          id: String(row.code),
          name: String(row.name),
          country: countryCode,
          countryId: String(country.id),
          price,
          count: Number(row.available ?? row.count ?? 0),
        }]
        : [];
    });
  }
  if (provider === "herosms") {
    // HeroSMS supports account currencies. Require an explicit USD account
    // contract; never interpret RUB-denominated costs as dollars.
    if (env("HEROSMS_CURRENCY") !== "USD") return [];
    const countries = await handler(provider, { action: "getCountries" });
    assertRead(countries);
    const country = values(countries.data).find((row) =>
      isoCountry(String(row.eng || row.name || row.iso)) === countryCode
    );
    if (!country) return [];
    const services = await handler(provider, {
      action: "getServicesList",
      country: country.id,
      lang: "en",
    });
    assertRead(services);
    const prices = await handler(provider, {
      action: "getPrices",
      country: country.id,
    });
    assertRead(prices);
    const names = new Map(
      values(services.data?.services ?? services.data).map(
        (row) => [String(row.code), String(row.name)],
      ),
    );
    return Object.entries(prices.data?.[String(country.id)] || {}).map((
      [id, row]: [string, any],
    ) => ({
      provider,
      id,
      name: names.get(id) || `${provider} ${id}`,
      country: countryCode,
      countryId: String(country.id),
      price: Number(row.cost),
      count: Number(row.count),
    })).filter(validOffer);
  }
  if (provider === "textverify") {
    const result = await json(provider, "/tn101/get-services");
    assertRead(result);
    const raw = result.data?.data?.temporary?.["United States"];
    // Some catalogues key each entry by service_key; never use an array index
    // or its display name as the provider purchase identifier.
    const entries = Array.isArray(raw)
      ? raw.map((row) => [row.service_key, row])
      : Object.entries(raw || {});
    return entries.flatMap(([key, row]: any) =>
      key
        ? [{
          provider,
          id: String(row.service_key || key),
          name: String(row.service),
          country: "US",
          countryId: "US",
          price: Number(row.price),
          count: Number(row.stock ?? row.count ?? 1),
        }]
        : []
    ).filter(validOffer);
  }
  const countries = await bus("/list/countries");
  assertRead(countries);
  const country = values(countries.data?.data).find((row) =>
    String(row.code).toUpperCase() === countryCode
  );
  if (!country) return [];
  const projects = await bus("/list/projects");
  assertRead(projects);
  const prices = await bus("/list/prices", { country_id: country.id });
  assertRead(prices);
  const names = new Map(
    values(projects.data?.data).map(
      (row) => [String(row.id), String(row.title)],
    ),
  );
  return values(prices.data?.data).map((row) => ({
    provider,
    id: String(row.project_id),
    name: names.get(String(row.project_id)) || String(row.title || ""),
    country: countryCode,
    countryId: String(country.id),
    price: Number(row.cost),
    count: Number(row.total_count),
  })).filter(validOffer);
}

const canonicalCodes = new Map(
  Object.entries(SERVICE_NAMES).map((
    [code, name],
  ) => [smsProductName(name), code]),
);
const caches = new Map<
  string,
  { until: number; products: SmsProduct[]; diagnostics: Record<string, string> }
>();
async function fetchSmsCatalogue(
  force = false,
  admin?: any,
  countryCode = "US",
) {
  countryInfo(countryCode);
  const policy=await smsRoutingState(admin);
  const enabledProviders=smsProvidersConfigured().filter(provider=>policy.controls[provider]!==false);
  const cache = caches.get(countryCode);
  if (!force && cache && cache.until > Date.now()) return cache;
  const diagnostics: Record<string, string> = {};
  const results = await Promise.allSettled(
    enabledProviders.map(async (id) => {
      const offers = await listOffers(id as Provider, countryCode);
      diagnostics[id] = offers.length ? "ready" : "no_verified_offers";
      return offers;
    }),
  );
  // The .io API also returns descriptive brand slugs without display labels.
  // Resolve only full alphabetic slugs against verified catalogue names. Short
  // and numeric provider-local IDs remain isolated. Quality terms stay intact.
  const labels=new Map(Object.values(SERVICE_NAMES).map(name=>[smsProductName(name),name]));
  for(const result of results)if(result.status==='fulfilled')for(const offer of result.value){
    if(!offer.name.startsWith(`${offer.provider} `))labels.set(smsProductName(offer.name),offer.name);
  }
  for(const result of results)if(result.status==='fulfilled')for(const offer of result.value){
    if(!offer.provider.startsWith('daisysms')||offer.name!==`${offer.provider} ${offer.id}`||!/^[A-Za-z][A-Za-z _-]{3,}$/.test(offer.id))continue;
    const label=labels.get(smsProductName(offer.id));if(label)offer.name=label;
  }
  const groups = new Map<string, SmsOffer[]>();
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      diagnostics[enabledProviders[i]] = "unavailable";
      return;
    }
    for (const offer of result.value) {
      const key = `${offer.country}:${smsProductName(offer.name)}`;
      groups.set(key, [...(groups.get(key) || []), offer]);
    }
  });
  if (admin && keys.daisysim() && policy.controls.daisysim!==false) {
    const saved = await admin.from("supplier_product_routes").select("routes")
      .eq("family", "sms").like("product_key", `daisysim:${countryCode}:%`);
    if (saved.error) throw new Error("SMS_CATALOG_CACHE_UNAVAILABLE");
    for (const row of saved.data || []) {
      for (const offer of row.routes || []) {
        if (
          !validOffer(offer) || offer.country !== countryCode ||
          offer.provider !== "daisysim"
        ) continue;
        const key = `${offer.country}:${smsProductName(offer.name)}`;
        groups.set(key, [
          ...(groups.get(key) || []).filter((existing) =>
            existing.provider !== "daisysim" || existing.id !== offer.id
          ),
          offer,
        ]);
      }
    }
  }
  const products = [...groups.values()].map((offers) => {
    const productCode=(countryCode==='US'?'':`c-${countryCode}~`)+(canonicalCodes.get(smsProductName(offers[0].name))||`u-${encodeURIComponent(smsProductName(offers[0].name))}`);
    offers=rankedSmsOffers(offers,policy,productCode);
    const available = offers.filter((row) => row.count > 0);
    const primary = available[0] || offers[0];
    const name = smsProductName(primary.name);
    return {
      code: (countryCode === "US" ? "" : `c-${countryCode}~`) +
        (canonicalCodes.get(name) || `u-${encodeURIComponent(name)}`),
      name: primary.name,
      count: available.reduce((sum, row) => sum + row.count, 0),
      priceUsd: primary.price,
      multipleMessages: offers.every((row) => row.multipleMessages === true),
      offers,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const result = { until: Date.now() + 60_000, products, diagnostics };
  caches.set(countryCode, result);
  return result;
}

// Provider identity travels with the activation so polling and cancellation
// continue using the original account even after stock or priorities change.
export function smsReference(provider: string, id: string) {
  return `p1:${provider}:${encodeURIComponent(id)}`;
}
export function parseSmsReference(
  value: string,
): { provider: Provider; id: string } | null {
  const match = /^p1:([a-z_]+):([^:]+)$/.exec(value);
  if (!match || !Object.hasOwn(keys, match[1])) return null;
  return { provider: match[1] as Provider, id: decodeURIComponent(match[2]) };
}
function declineText(text: string) {
  if (["NO_NUMBERS", "NO_NUMBERS_AVAILABLE"].includes(text)) {
    throw new ProviderDeclined("NO_NUMBERS");
  }
  if (["NO_MONEY", "NO_BALANCE", "INSUFFICIENT_BALANCE"].includes(text)) {
    throw new ProviderDeclined("NO_MONEY");
  }
  if (text === "MAX_PRICE_EXCEEDED") {
    throw new ProviderDeclined("MAX_PRICE_EXCEEDED");
  }
  if (text === "BAD_KEY") throw new ProviderDeclined("BAD_KEY");
}
function receipt(
  provider: Provider,
  id: unknown,
  phone: unknown,
  price: number,
): SmsReceipt {
  if (typeof id === "number" && !Number.isSafeInteger(id)) {
    throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
  }
  const identifier = String(id ?? "");
  let number = String(phone ?? "").replace(/^\+/, "");
  if (provider === "getatext" && number.length === 10) number = `1${number}`;
  if (
    !identifier || identifier.length > 160 || !/^\d{7,16}$/.test(number) ||
    !Number.isFinite(price) || price <= 0
  ) throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
  return {
    activationId: smsReference(provider, identifier),
    phoneNumber: number,
    priceUsd: price,
  };
}
async function buyOffer(
  offer: SmsOffer,
  maxPrice: number,
  onReply?: (reply: {text:string;headers:Headers;status:number;bodyComplete:boolean})=>Promise<void>,
): Promise<SmsReceipt> {
  if (offer.price > maxPrice) throw new ProviderDeclined("MAX_PRICE_EXCEEDED");
  const provider = offer.provider;
  if (handlerBases[provider]) {
    const result = await handler(provider, {
      action: provider === "herosms" ? "getNumberV2" : "getNumber",
      service: offer.id,
      ...(provider === "herosms"
        ? { country: offer.countryId, maxPrice }
        : { max_price: maxPrice }),
    });
    if (onReply) await onReply({text:result.text.replaceAll(credential(provider),"[redacted-api-key]").slice(0,32768),headers:new Headers({"x-price":result.headers.get("x-price")||""}),status:result.status,bodyComplete:true});
    if (!result.ok) throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
    declineText(result.text);
    if (provider === "herosms" && result.data?.activationId) {
      return receipt(
        provider,
        result.data.activationId,
        result.data.phoneNumber,
        Number(result.data.activationCost),
      );
    }
    const match = /^ACCESS_NUMBER:(\d+):(\+?\d+)$/.exec(result.text);
    if (!match) throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
    const price = result.headers.get("x-price");
    return receipt(
      provider,
      match[1],
      match[2],
      price === null ? offer.price : Number(price),
    );
  }
  if (provider === "getatext") {
    const result = await json(provider, "/rent-a-number", {
      service: offer.id,
      max_price: maxPrice,
    });
    if (onReply) await onReply({text:result.text.replaceAll(credential(provider),"[redacted-api-key]").slice(0,32768),headers:new Headers({"x-price":result.headers.get("x-price")||""}),status:result.status,bodyComplete:true});
    const error = result.data?.errors;
    if (result.status === 400 && typeof error === "string") {
      if (
        error === "Service is out of stock" ||
        error === "Service is not available" ||
        error === "You have reached the maximum number of active rentals"
      ) throw new ProviderDeclined("NO_NUMBERS");
      if (error === "Insufficient funds") {
        throw new ProviderDeclined("NO_MONEY");
      }
      if (
        error.startsWith(
          "The price of the service exceeds the maximum price you are willing to pay, actual price is:",
        )
      ) throw new ProviderDeclined("MAX_PRICE_EXCEEDED");
    }
    if (!result.ok || result.data?.errors) {
      throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
    }
    const row = result.data;
    return receipt(
      provider,
      row?.id,
      row?.number,
      Number(row?.price ?? row?.cost),
    );
  }
  if (provider === "daisysim") {
    const quote = await json(provider, "/prices", {
      country: Number(offer.countryId),
      service: offer.id,
    });
    assertRead(quote);
    const tier = values(quote.data?.data?.tiers).find((row) =>
      Number(row.available) > 0 && Number(row.price) <= maxPrice
    );
    if (!tier) throw new ProviderDeclined("NO_NUMBERS");
    const result = await json(provider, "/purchase", {
      country: Number(offer.countryId),
      service: offer.id,
      price: tier.price,
      route: tier.route,
    });
    if (onReply) await onReply({text:result.text.replaceAll(credential(provider),"[redacted-api-key]").slice(0,32768),headers:new Headers({"x-price":result.headers.get("x-price")||""}),status:result.status,bodyComplete:true});
    if (result.data?.success === false) {
      if (
        [
          "NO_NUMBERS_AVAILABLE",
          "NO_PRICES",
          "PROVIDER_DISABLED",
          "CONCURRENT_ERROR",
          "SERVER_ERROR",
          "RATE_LIMITED",
        ].includes(result.data.code)
      ) throw new ProviderDeclined("NO_NUMBERS");
      if (result.data.code === "INSUFFICIENT_BALANCE") {
        throw new ProviderDeclined("NO_MONEY");
      }
      if (result.data.code === "INVALID_TOKEN") {
        throw new ProviderDeclined("BAD_KEY");
      }
    }
    if (!result.ok || result.data?.success !== true) {
      throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
    }
    const row = result.data.data;
    return receipt(
      provider,
      row?.activation_id,
      row?.phone_number,
      Number(row?.amount_charged),
    );
  }
  if (provider === "textverify") {
    // This API has no price ceiling. Re-read the quote immediately before send.
    const offers = await listOffers(provider);
    const fresh = offers.find((row) => row.id === offer.id);
    if (!fresh || fresh.price > maxPrice) {
      throw new ProviderDeclined("MAX_PRICE_EXCEEDED");
    }
    const result = await json(provider, "/tn101/request-number", {
      service_key: offer.id,
    });
    if (onReply) await onReply({text:result.text.replaceAll(credential(provider),"[redacted-api-key]").slice(0,32768),headers:new Headers({"x-price":result.headers.get("x-price")||""}),status:result.status,bodyComplete:true});
    if (!result.ok || result.data?.success !== true) {
      throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
    }
    const row = result.data.data;
    return receipt(provider, row?.order_id, row?.number, Number(row?.price));
  }
  const freshOffers = await listOffers("smsbus", offer.country);
  const fresh = freshOffers.find((row) =>
    row.id === offer.id && row.countryId === offer.countryId
  );
  if (!fresh || fresh.count < 1) throw new ProviderDeclined("NO_NUMBERS");
  if (fresh.price > maxPrice) throw new ProviderDeclined("MAX_PRICE_EXCEEDED");
  const result = await bus("/get/number", {
    country_id: offer.countryId,
    project_id: offer.id,
  });
    if (onReply) await onReply({text:result.text.replaceAll(credential(provider),"[redacted-api-key]").slice(0,32768),headers:new Headers({"x-price":result.headers.get("x-price")||""}),status:result.status,bodyComplete:true});
  if (result.ok && [50001, 50002, 50004].includes(result.data?.code)) {
    throw new ProviderDeclined("NO_NUMBERS");
  }
  if (result.ok && result.data?.code === 50201) {
    throw new ProviderDeclined("NO_MONEY");
  }
  if (!result.ok || result.data?.code !== 200) {
    throw new Error("SUPPLIER_OUTCOME_UNKNOWN");
  }
  return receipt(
    provider,
    result.data.data?.request_id,
    result.data.data?.number,
    fresh.price,
  );
}
export async function smsBuy(code: string, maxPrice: number, admin?: any, onReply?: (reply: {text:string;headers:Headers;status:number;bodyComplete:boolean})=>Promise<void>) {
  let policy;
  try{policy=await smsRoutingState(admin,code,true)}catch{throw new ProviderDeclined("NO_NUMBERS")}
  const countryCode = smsCountryFromCode(code);
  const catalog = await smsCatalogue(false, admin, countryCode);
  const product = catalog.products.find((row) => row.code === code);
  if (!product) throw new ProviderDeclined("NO_NUMBERS");
  let offers = product.offers.filter((row) =>
    row.count > 0 && row.price <= maxPrice
  );
  // DaisySim's prices API is per service, so obtain its short-lived exact tier
  // only for a selected matching product, respecting its 30/min limit.
  if (keys.daisysim() && policy.controls.daisysim!==false && !offers.some((row) => row.provider === "daisysim")) {
    try {
      const countries = await json("daisysim", "/countries");
      assertRead(countries);
      const country = values(countries.data?.data?.countries).find((row) =>
        isoCountry(String(row.name)) === countryCode
      );
      if (country) {
        const services = await json("daisysim", `/services/${country.id}`);
        assertRead(services);
        const service = values(services.data?.data?.services).find((row) =>
          smsProductName(String(row.name)) === smsProductName(product.name)
        );
        if (service) {
          const quote = await json("daisysim", "/prices", {
            country: Number(country.id),
            service: service.code,
          });
          assertRead(quote);
          for (const tier of values(quote.data?.data?.tiers)) {
            if (Number(tier.available) > 0 && Number(tier.price) <= maxPrice) {
              offers = [...offers, {
                provider: "daisysim",
                id: String(service.code),
                name: String(service.name),
                country: countryCode,
                countryId: String(country.id),
                price: Number(tier.price),
                count: Number(tier.available),
                route: tier.route,
              }];
              break;
            }
          }
        }
      }
    } catch {
      /* Optional quote discovery must not block other matching suppliers. */
    }
  }
  return tryProductFallback(
    rankedSmsOffers(offers,policy,code),
    async(offer)=>{
      try{const result=await buyOffer(offer,maxPrice,onReply);await recordSmsProviderEvent(admin,offer.provider,code,'accepted',result.activationId);return result}
      catch(error){await recordSmsProviderEvent(admin,offer.provider,code,error instanceof ProviderDeclined?(error.code==='NO_NUMBERS'?'no_stock':'declined'):'unknown');throw error}
    },
  );
}
async function fetchSmsStatus(reference: string, timeoutMs: number): Promise<SmsStatus> {
  const parsed = parseSmsReference(reference);
  if (!parsed) throw new Error("SUPPLIER_REFERENCE_INVALID");
  const { provider, id } = parsed;
  if (handlerBases[provider]) {
    const result = await handler(provider, { action: "getStatus", id },timeoutMs);
    if(result.status===429||result.text==="RATE_LIMIT_EXCEEDED")throw new Error("SUPPLIER_RATE_LIMITED");
    if (!result.ok) throw new Error("SUPPLIER_STATUS_UNAVAILABLE");
    if (result.text === "STATUS_CANCEL") return { status: "cancelled" };
    if (/^STATUS_WAIT_(CODE|RETRY|RESEND)/.test(result.text)) {
      return { status: "waiting" };
    }
    if (result.text.startsWith("STATUS_OK:")) {
      return { status: "ok", code: result.text.slice(10) };
    }
    throw new Error("SUPPLIER_STATUS_UNAVAILABLE");
  }
  if (provider === "smsbus") {
    const result = await bus("/get/sms", { request_id: id },false,timeoutMs);
    if (!result.ok) throw new Error("SUPPLIER_STATUS_UNAVAILABLE");
    if (result.data?.code === 50101) return { status: "waiting" };
    if (
      result.data?.code === 200 && typeof result.data.data === "string" &&
      result.data.data.trim()
    ) return { status: "ok", code: result.data.data };
    // Expiry and not-found do not prove a supplier refund.
    throw new Error("SUPPLIER_STATUS_UNAVAILABLE");
  }
  const result = await json(
    provider,
    provider === "getatext"
      ? "/rental-status"
      : provider === "daisysim"
      ? `/check/${encodeURIComponent(id)}`
      : `/tn101/get-number-details?order_id=${encodeURIComponent(id)}`,
    provider === "getatext" ? { id } : undefined,
    timeoutMs,
  );
  assertRead(result);
  const row = result.data?.data ?? result.data;
  const code = row?.code ?? row?.pin;
  if (code) return { status: "ok", code: String(code) };
  const status = String(row?.status || "").toLowerCase();
  if (provider === "daisysim" && status === "cancelled") {
    // DaisySim polling never refunds money; Cancelled/refunded:false requires
    // a successful explicit /cancel/{id} before releasing customer funds.
    if (row.refunded === true) return { status: "cancelled" };
    const cancelled = await smsCancel(reference);
    if (cancelled.cancelled) return { status: "cancelled" };
    throw new Error("SUPPLIER_CANCELLATION_UNCONFIRMED");
  }
  if (["cancelled", "canceled", "rejected"].includes(status)) {
    return { status: "cancelled" };
  }
  if (["waiting", "active", "reserved", "awaiting"].includes(status)) {
    return { status: "waiting" };
  }
  throw new Error("SUPPLIER_STATUS_UNAVAILABLE");
}
export async function smsCancel(reference: string) {
  invalidateProviderRead(`sms-status:${reference}`);
  const parsed = parseSmsReference(reference);
  if (!parsed) throw new Error("SUPPLIER_REFERENCE_INVALID");
  const { provider, id } = parsed;
  let cancelled = false;
  if (handlerBases[provider]) {
    const result = await handler(provider, {
      action: "setStatus",
      id,
      status: 8,
    });
    cancelled = result.ok && result.text === "ACCESS_CANCEL";
  } else if (provider === "smsbus") {
    const result = await bus("/cancel", { request_id: id });
    cancelled = result.ok && result.data?.code === 200;
  } else {
    const result = await json(
      provider,
      provider === "getatext"
        ? "/cancel-rental"
        : provider === "daisysim"
        ? `/cancel/${encodeURIComponent(id)}`
        : "/tn101/reject-number",
      provider === "daisysim"
        ? {}
        : provider === "getatext"
        ? { id }
        : { order_id: id },
    );
    if (provider === "getatext") {
      cancelled = result.ok && result.data?.status === "cancelled";
    } else if (provider === "daisysim") {
      cancelled = result.ok && result.data?.success === true &&
        Number(result.data?.data?.refund) > 0;
    } else if (result.ok && result.data?.success === true) {
      cancelled = (await smsStatus(reference)).status === "cancelled";
    }
  }
  return {
    cancelled,
    response: cancelled ? "ACCESS_CANCEL" : "CANCELLATION_UNCONFIRMED",
  };
}
export async function smsDone(reference: string) {
  const parsed = parseSmsReference(reference);
  if (!parsed) throw new Error("SUPPLIER_REFERENCE_INVALID");
  if (handlerBases[parsed.provider]) {
    await handler(parsed.provider, {
      action: "setStatus",
      id: parsed.id,
      status: 6,
    });
  } else if (parsed.provider === "getatext") {
    await json(
      "getatext",
      `/rental-status/${encodeURIComponent(parsed.id)}/completed`,
      {},
    );
  }
  // Other suppliers settle automatically once an SMS arrives.
}

export async function smsCountries() { return providerRead("sms-countries",300_000,fetchSmsCountries) }

export async function smsCatalogue(force=false,admin?:any,countryCode="US") { const state=await smsRoutingState(admin); const active=smsProvidersConfigured().filter(provider=>state.controls[provider]!==false).sort().join(','); const key=`sms-catalogue:${countryCode}:${active}`; if(force)invalidateProviderRead(key); return providerRead(key,60_000,()=>fetchSmsCatalogue(true,admin,countryCode)) }

export async function smsStatus(reference:string,timeoutMs=12_000,admin?:any):Promise<SmsStatus> {
  const result=await providerRead(`sms-status:${reference}:${timeoutMs}`,3000,()=>fetchSmsStatus(reference,timeoutMs));
  const provider=parseSmsReference(reference)?.provider;
  if(provider&&result.status!=='waiting')await recordSmsProviderEvent(admin,provider,null,result.status==='ok'?'delivered':'cancelled',reference);
  return result;
}
