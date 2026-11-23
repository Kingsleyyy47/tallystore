import {
  productMatchKey,
  ProviderDeclined,
  smsProductName,
  tryProductFallback,
} from "../supabase/functions/_shared/provider-contract.ts";
import { providerHttp } from "../supabase/functions/_shared/provider-http.ts";
import { providerRead, invalidateProviderRead } from "../supabase/functions/_shared/provider-read-cache.ts";
import {
  parseSmsReference,
  smsBuy,
  smsCancel,
  smsCatalogue,
  smsCountries,
  smsReference,
  smsStatus,
  syncDaisySimPage,
} from "../supabase/functions/_shared/sms-provider-router.ts";
import {
  dispatchSmmRoutes,
  planSmmRoutes,
  syncSmmProviders,
  routedSmmStatuses,
} from "../supabase/functions/_shared/smm-provider-router.ts";
import { validKoraSignature } from "../supabase/functions/_shared/korapay-client.ts";
import { isoCountry } from "../supabase/functions/_shared/provider-countries.ts";

Deno.test("provider reads share in-flight work and cache success, never failures", async () => {
  invalidateProviderRead("");
  let sends = 0;
  const load = async () => { sends++; await Promise.resolve(); return { stock: 4 }; };
  const results = await Promise.all(Array.from({length: 20}, () => providerRead("fixture:catalog", 60000, load)));
  equal(sends, 1); equal(results.length, 20);
  equal(await providerRead("fixture:catalog",60000,load), { stock: 4 }); equal(sends,1);
  invalidateProviderRead("fixture:");
  await providerRead("fixture:catalog",60000,load); equal(sends,2);
  let failures=0;
  const fail=async()=>{failures++;throw new Error("offline")};
  await rejects(()=>providerRead("fixture:failure",60000,fail));
  await rejects(()=>providerRead("fixture:failure",60000,fail));
  equal(failures,2);
});

Deno.test("SMM polling batches by supplier and separates overlapping supplier IDs", async()=>{
  const calls: Record<string,number>={};
  await mock({LORDOFPANELS_API_KEY:"lord-fixture",BULKFOLLOWS_API_KEY:"bulk-fixture"},(url,init)=>{
    const body=new URLSearchParams(String(init.body));
    equal(body.get("action"),"status");
    calls[url.hostname]=(calls[url.hostname]||0)+1;
    const result:Record<string,unknown>={};
    for(const id of (body.get("orders")||body.get("order")||"").split(","))result[id]={status:url.hostname.includes("bulk")?"Pending":"Completed"};
    return json(body.has("order")?Object.values(result)[0]:result);
  },async()=>{
    const orders=[...Array.from({length:101},(_,i)=>({id:`lord-${i}`,external_order_id:i+1,panel_response:{routing:{provider:"lordofpanels"}}})),...Array.from({length:2},(_,i)=>({id:`bulk-${i}`,external_order_id:i+1,panel_response:{routing:{provider:"bulkfollows"}}}))];
    const results=await routedSmmStatuses(orders);
    equal(Object.keys(results).length,103);
    equal(results["lord-0"].status,"Completed"); equal(results["bulk-0"].status,"Pending");
    equal(Object.values(calls).reduce((a,b)=>a+b,0),3);
  });
});

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
async function rejects(task: () => Promise<unknown>) {
  let failed = false;
  try {
    await task();
  } catch {
    failed = true;
  }
  assert(failed, "Expected rejection");
}
const smmProduct = {
  name: "Instagram Followers",
  category: "Instagram",
  type: "Default",
  rate: "1",
  min: "1",
  max: "1000",
  refill: false,
  cancel: false,
};
const smmKey = productMatchKey({
  kind: "smm",
  name: smmProduct.name,
  category: smmProduct.category,
  serviceType: smmProduct.type,
  refill: false,
  cancel: false,
})!;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const environment = [
  "DAISYSMS_API_KEY",
  "DAISYSMS_IO_API_KEY",
  "DAISYSMS_COM_API_KEY",
  "GETATEXT_API_KEY",
  "DAISYSIM_API_KEY",
  "HEROSMS_API_KEY",
  "SMSACTIVATE_API_KEY",
  "TEXTVERIFY_API_KEY",
  "SMSBUS_API_KEY",
  "SMM_PANEL_API_KEY",
  "LORDOFPANELS_API_KEY",
  "BULKFOLLOWS_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
async function mock<T>(
  keys: Record<string, string>,
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
  task: () => Promise<T>,
) {
  invalidateProviderRead("");
  const original = globalThis.fetch,
    saved = new Map(environment.map((key) => [key, Deno.env.get(key)]));
  for (const key of environment) Deno.env.delete(key);
  for (
    const [key, value] of Object.entries({
      ...keys,
      SUPABASE_URL: "https://fixture.supabase.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    })
  ) Deno.env.set(key, value);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "fixture.supabase.invalid") {
      return url.pathname.endsWith("security_admit_request")
        ? json({ allowed: true, lease_id: "synthetic-lease" })
        : new Response(null, { status: 204 });
    }
    assert(
      init.redirect === "error",
      "Redirects must not resend supplier requests",
    );
    return handler(url, init);
  };
  try {
    return await task();
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of saved) {
      value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    }
  }
}
Deno.test("matching keeps country, term, denomination, refill, quality and service type", () => {
  equal(smsProductName("Twitter / X"), "twitter");
  assert(smsProductName("Google Voice") !== smsProductName("Google"));
  const otp = { kind: "otp" as const, name: "WhatsApp", country: "US" };
  assert(productMatchKey(otp) !== productMatchKey({ ...otp, country: "CA" }));
  const rental = {
    kind: "rental" as const,
    name: "All services",
    country: "US",
    duration: "1 month",
  };
  assert(
    productMatchKey(rental) !==
      productMatchKey({ ...rental, duration: "30 days" }),
  );
  const card = {
    kind: "giftcard" as const,
    name: "Amazon",
    country: "US",
    currency: "USD",
    denomination: 10,
  };
  assert(
    productMatchKey(card) !== productMatchKey({ ...card, denomination: 100 }),
  );
  const smm = {
    kind: "smm" as const,
    name: "Instagram Followers 30 day refill",
    category: "Instagram",
    serviceType: "Default",
    refill: true,
    cancel: false,
  };
  assert(
    productMatchKey(smm) !==
      productMatchKey({ ...smm, name: "Instagram Followers no refill" }),
  );
  assert(productMatchKey(smm) !== productMatchKey({ ...smm, refill: false }));
  equal(isoCountry("United States of America"), "US");
  equal(isoCountry("Canada"), "CA");
});
Deno.test("fallback advances on explicit rejection and stops on unknown outcomes", async () => {
  const calls: number[] = [];
  equal(
    await tryProductFallback([1, 2], async (id) => {
      calls.push(id);
      if (id === 1) throw new ProviderDeclined("NO_NUMBERS");
      return id;
    }),
    2,
  );
  equal(calls, [1, 2]);
  calls.length = 0;
  await rejects(() =>
    tryProductFallback([1, 2], async (id) => {
      calls.push(id);
      throw new Error("timeout");
    })
  );
  equal(calls, [1]);
});
Deno.test("bounded transport rejects stalled and oversized bodies without another send", async () => {
  let sends = 0;
  await rejects(() =>
    providerHttp("https://supplier.invalid", {}, async () => {
      sends++;
      return new Response(new ReadableStream({ start() {} }));
    }, 5)
  );
  equal(sends, 1);
  await rejects(() =>
    providerHttp(
      "https://supplier.invalid",
      {},
      async () =>
        new Response("x", { headers: { "content-length": "4194305" } }),
    )
  );
});
function smsFixture(
  url: URL,
  init: RequestInit,
  outcome: "decline" | "unknown" = "decline",
  paid: string[] = [],
): Response {
  const action = url.searchParams.get("action");
  if (action === "getPricesVerification") {
    return json({
      wa: { 187: { price: 0.7, count: 2 } },
      go: { 187: { price: 0.9, count: 3 } },
    });
  }
  if (url.pathname.endsWith("/prices-info")) {
    return json([{
      service_name: "WhatsApp",
      api_name: "whatsapp",
      price: "0.5",
      stock: 3,
      multiple_sms: "true",
    }, {
      service_name: "Google Voice",
      api_name: "google_voice",
      price: "0.8",
      stock: 2,
    }]);
  }
  if (url.pathname.endsWith("/rent-a-number")) {
    paid.push("getatext");
    assert(new Headers(init.headers).get("auth") === "synthetic-getatext");
    return outcome === "decline"
      ? json({ errors: "Service is out of stock" }, 400)
      : json({ unexpected: true });
  }
  if (action === "getNumber") {
    paid.push(url.hostname);
    return new Response("ACCESS_NUMBER:1234:15550001234", {
      headers: { "x-price": "0.7" },
    });
  }
  if (action === "getStatus") return new Response("STATUS_OK:123456");
  if (action === "setStatus") return new Response("ACCESS_CANCEL");
  throw new Error(`Unexpected fixture path: ${url.hostname}${url.pathname}`);
}
Deno.test("SMS catalogue groups exact names and fallback stays bound to accepting supplier", async () => {
  const paid: string[] = [];
  await mock(
    {
      DAISYSMS_COM_API_KEY: "synthetic-com",
      GETATEXT_API_KEY: "synthetic-getatext",
    },
    (url, init) => smsFixture(url, init, "decline", paid),
    async () => {
      const catalog = await smsCatalogue(true);
      const whatsapp = catalog.products.find((row) => row.code === "wa")!;
      equal(whatsapp.offers.length, 2);
      equal(whatsapp.count, 5);
      assert(
        catalog.products.some((row) =>
          row.name === "Google Voice" && row.code !== "go"
        ),
      );
      const result = await smsBuy("wa", 1);
      equal(paid, ["getatext", "daisysms.com"]);
      equal(result.priceUsd, 0.7);
      equal(parseSmsReference(result.activationId)?.provider, "daisysms_com");
      equal(await smsStatus(result.activationId), {
        status: "ok",
        code: "123456",
      });
      equal((await smsCancel(result.activationId)).cancelled, true);
    },
  );
});
Deno.test("SMS malformed purchase reply stops fallback and preserves review outcome", async () => {
  const paid: string[] = [];
  await mock(
    {
      DAISYSMS_COM_API_KEY: "synthetic-com",
      GETATEXT_API_KEY: "synthetic-getatext",
    },
    (url, init) => smsFixture(url, init, "unknown", paid),
    async () => {
      await smsCatalogue(true);
      await rejects(() => smsBuy("wa", 1));
      equal(paid, ["getatext"]);
    },
  );
});
Deno.test("live Daisy brand-slug catalogue matches verified names while numeric IDs stay isolated",async()=>{
  await mock({DAISYSMS_IO_API_KEY:'io-fixture',DAISYSMS_COM_API_KEY:'com-fixture'},()=>json({whatsapp:{cost:0.6,count:3,multi:1},'12345':{cost:0.4,count:2}}),async()=>{
    const catalog=await smsCatalogue(true);
    const whatsapp=catalog.products.find(product=>product.code==='wa');
    assert(whatsapp);equal(whatsapp.offers.length,2);equal(whatsapp.multipleMessages,true);
    equal(catalog.products.filter(product=>product.name.includes('12345')).length,2);
  });
});
Deno.test("DaisySim dead status explicitly cancels and confirms refund", async () => {
  const requests: string[] = [];
  await mock({ DAISYSIM_API_KEY: "synthetic-daisysim" }, (url) => {
    requests.push(url.pathname);
    if (url.pathname.endsWith("/check/123")) {
      return json({
        success: true,
        data: { activation_id: "123", status: "Cancelled", refunded: false },
      });
    }
    if (url.pathname.endsWith("/cancel/123")) {
      return json({
        success: true,
        data: { activation_id: "123", refund: 0.55 },
      });
    }
    throw new Error("Unexpected request");
  }, async () => {
    equal(await smsStatus(smsReference("daisysim", "123")), {
      status: "cancelled",
    });
    equal(requests, [
      "/api/v1/virtual/check/123",
      "/api/v1/virtual/cancel/123",
    ]);
  });
});
Deno.test("DaisySim refuses customer refund when supplier cancellation is unconfirmed", async () => {
  await mock(
    { DAISYSIM_API_KEY: "synthetic-daisysim" },
    (url) =>
      url.pathname.includes("/check/")
        ? json({
          success: true,
          data: { status: "Cancelled", refunded: false },
        })
        : json({ success: false, code: "IN_PROGRESS" }, 409),
    async () => {
      await rejects(() => smsStatus(smsReference("daisysim", "123")));
    },
  );
});
Deno.test("SMM routing journals each paid attempt and accepts string order IDs", async () => {
  const sends: string[] = [], journal: Record<string, unknown>[] = [];
  const admin = {
    from: () => ({
      update: (data: any) => ({
        eq: async () => {
          journal.push(data.panel_response);
          return { error: null };
        },
      }),
    }),
  };
  const routes = [{
    provider: "lordofpanels" as const,
    serviceId: 1,
    rate: 1,
    min: 10,
    max: 1000,
    matchKey: smmKey,
  }, {
    provider: "bulkfollows" as const,
    serviceId: 2,
    rate: 1.1,
    min: 10,
    max: 1000,
    matchKey: smmKey,
  }];
  await mock({
    SMM_PANEL_API_KEY: "synthetic-lord",
    BULKFOLLOWS_API_KEY: "synthetic-bulk",
  }, (url, init) => {
    if (new URLSearchParams(String(init.body)).get("action") === "services") {
      return json([{
        ...smmProduct,
        service: url.hostname === "bulkfollows.com" ? 2 : 1,
      }]);
    }
    sends.push(url.hostname);
    return url.hostname === "bulkfollows.com"
      ? json({ order: "42" })
      : json({ error: "Service is not available" });
  }, async () => {
    const result = await dispatchSmmRoutes(admin, "synthetic-order", routes, {
      service: 1,
      quantity: 100,
      link: "https://example.invalid",
    });
    equal(result.order, 42);
    equal(sends, ["thelordofthepanels.com", "bulkfollows.com"]);
    equal(journal.length, 3);
    equal(result.routing.provider, "bulkfollows");
  });
});
Deno.test("SMM unknown result never invokes a second supplier", async () => {
  let sends = 0;
  const admin = {
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  };
  await mock({
    SMM_PANEL_API_KEY: "synthetic-lord",
    BULKFOLLOWS_API_KEY: "synthetic-bulk",
  }, (url, init) => {
    if (new URLSearchParams(String(init.body)).get("action") === "services") {
      return json([{
        ...smmProduct,
        service: url.hostname === "bulkfollows.com" ? 2 : 1,
      }]);
    }
    sends++;
    return json({ order: null });
  }, async () => {
    await rejects(() =>
      dispatchSmmRoutes(admin, "synthetic-order", [{
        provider: "lordofpanels",
        serviceId: 1,
        rate: 1,
        min: 1,
        max: 1000,
        matchKey: smmKey,
      }, {
        provider: "bulkfollows",
        serviceId: 2,
        rate: 1,
        min: 1,
        max: 1000,
        matchKey: smmKey,
      }], { service: 1, quantity: 10 })
    );
    equal(sends, 1);
  });
});
Deno.test("Kora signs only data, rejects altered data and rejects unsigned callbacks", async () => {
  const data = {
      reference: "KORA-synthetic",
      amount: 1000,
      currency: "NGN",
      status: "success",
    },
    secret = "synthetic-kora-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  const signature = [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  equal(await validKoraSignature(data, signature, secret), true);
  equal(
    await validKoraSignature({ ...data, amount: 10000 }, signature, secret),
    false,
  );
  equal(await validKoraSignature(data, "", secret), false);
});
Deno.test("DaisySim imports exact quotes and buys a freshly priced opaque route", async () => {
  const stored: any[] = [], sent: any[] = [];
  const admin = {
    from: () => ({
      upsert: async (row: any) => {
        stored.push(row);
        return { error: null };
      },
      select: () => ({
        eq: () => ({ like: async () => ({ data: stored, error: null }) }),
      }),
    }),
  };
  await mock({ DAISYSIM_API_KEY: "synthetic-daisysim" }, (url, init) => {
    if (url.pathname.endsWith("/countries")) {
      return json({
        success: true,
        data: {
          countries: [{ id: 187, name: "United States" }, {
            id: 36,
            name: "Canada",
          }],
        },
      });
    }
    if (url.pathname.includes("/services/")) {
      return json({
        success: true,
        data: { services: [{ code: "wa", name: "WhatsApp" }] },
      });
    }
    if (url.pathname.endsWith("/prices")) {
      return json({
        success: true,
        data: {
          tiers: [{
            price: 0.4524123,
            available: 17,
            route: "opaque-live-route",
          }],
        },
      });
    }
    if (url.pathname.endsWith("/purchase")) {
      sent.push(JSON.parse(String(init.body)));
      return json({
        success: true,
        data: {
          activation_id: "77",
          phone_number: "+15550001234",
          amount_charged: 0.4524123,
        },
      }, 201);
    }
    throw new Error("Unexpected route");
  }, async () => {
    equal((await syncDaisySimPage(admin)).processed, 1);
    const catalog = await smsCatalogue(true, admin);
    equal(catalog.products[0].priceUsd, 0.4524123);
    const result = await smsBuy("wa", 0.6, admin);
    equal(result.priceUsd, 0.4524123);
    equal(sent, [{
      country: 187,
      service: "wa",
      price: 0.4524123,
      route: "opaque-live-route",
    }]);
  });
});
Deno.test("TextVerify uses the documented service_key and keeps country scope", async () => {
  const sent: any[] = [];
  await mock({ TEXTVERIFY_API_KEY: "synthetic-textverify" }, (url, init) => {
    if (url.pathname.endsWith("/tn101/get-services")) {
      return json({
        success: true,
        data: {
          temporary: {
            "United States": {
              "service-key-42": { service: "WhatsApp", price: 0.6 },
            },
          },
        },
      });
    }
    if (url.pathname.endsWith("/tn101/request-number")) {
      sent.push(JSON.parse(String(init.body)));
      return json({
        success: true,
        data: { order_id: 88, number: "+15550001234", price: 0.6 },
      });
    }
    if (url.pathname.endsWith("/tn101/get-number-details")) {
      return json({
        success: true,
        data: { status: "Success", pin: "123456" },
      });
    }
    throw new Error("Unexpected route");
  }, async () => {
    await smsCatalogue(true);
    const receipt = await smsBuy("wa", 1);
    equal(sent, [{ service_key: "service-key-42" }]);
    equal(await smsStatus(receipt.activationId), {
      status: "ok",
      code: "123456",
    });
    equal((await smsCatalogue(true, undefined, "CA")).products.length, 0);
  });
});
Deno.test("SMSBus resolves provider country/project IDs and refreshes price before purchase", async () => {
  const sent: string[] = [];
  await mock({ SMSBUS_API_KEY: "synthetic-smsbus" }, (url) => {
    if (url.pathname.endsWith("/list/countries")) {
      return json({
        code: 200,
        data: {
          one: { id: 1, code: "us", title: "United States" },
          two: { id: 7, code: "ca", title: "Canada" },
        },
      });
    }
    if (url.pathname.endsWith("/list/projects")) {
      return json({ code: 200, data: { one: { id: 55, title: "WhatsApp" } } });
    }
    if (url.pathname.endsWith("/list/prices")) {
      return json({
        code: 200,
        data: { one: { project_id: 55, cost: 0.5, total_count: 4 } },
      });
    }
    if (url.pathname.endsWith("/get/number")) {
      sent.push(
        `${url.searchParams.get("country_id")}:${
          url.searchParams.get("project_id")
        }`,
      );
      return json({
        code: 200,
        data: { request_id: "bus-77", number: "15550001234" },
      });
    }
    if (url.pathname.endsWith("/get/sms")) {
      return json({ code: 200, data: "123456" });
    }
    throw new Error("Unexpected route");
  }, async () => {
    assert((await smsCountries()).some((row) => row.code === "ca"));
    await smsCatalogue(true, undefined, "CA");
    const receipt = await smsBuy("c-CA~wa", 1);
    equal(sent, ["7:55"]);
    equal(await smsStatus(receipt.activationId), {
      status: "ok",
      code: "123456",
    });
  });
});
Deno.test("HeroSMS uses current V2 allocation and treats USD configuration explicitly", async () => {
  Deno.env.set("HEROSMS_CURRENCY", "USD");
  const actions: string[] = [];
  try {
    await mock({ HEROSMS_API_KEY: "synthetic-hero" }, (url) => {
      const action = url.searchParams.get("action") || "";
      actions.push(action);
      if (action === "getCountries") {
        return json({ 187: { id: 187, eng: "United States" } });
      }
      if (action === "getServicesList") {
        return json({ services: [{ code: "wa", name: "WhatsApp" }] });
      }
      if (action === "getPrices") {
        return json({ 187: { wa: { cost: 0.7, count: 5 } } });
      }
      if (action === "getNumberV2") {
        equal(url.searchParams.get("country"), "187");
        equal(url.searchParams.get("maxPrice"), "1");
        return json({
          activationId: "999",
          phoneNumber: "15550001234",
          activationCost: 0.7,
        });
      }
      throw new Error("Unexpected route");
    }, async () => {
      await smsCatalogue(true);
      equal(
        parseSmsReference((await smsBuy("wa", 1)).activationId)?.provider,
        "herosms",
      );
      assert(actions.includes("getNumberV2"));
    });
  } finally {
    Deno.env.delete("HEROSMS_CURRENCY");
  }
});
Deno.test("boost catalogue retains stable products, batches sync and refuses ambiguous duplicate matches", async () => {
  const saved: Record<string, any[]> = {}, key = smmKey;
  const admin = {
    from: (table: string) => ({
      select: () => ({
        eq: async () => ({
          data: [{ match_key: key, product_key: "1" }],
          error: null,
        }),
      }),
      upsert: async (rows: any[]) => {
        saved[table] = [...(saved[table] || []), ...rows];
        return { error: null };
      },
    }),
  };
  await mock({
    SMM_PANEL_API_KEY: "synthetic-lord",
    BULKFOLLOWS_API_KEY: "synthetic-bulk",
  }, (url, init) => {
    const action = new URLSearchParams(String(init.body)).get("action");
    if (action === "balance") return json({ balance: "100", currency: "USD" });
    const base = {
      ...smmProduct,
      service: url.hostname === "bulkfollows.com" ? 2 : 1,
    };
    return json([
      base,
      {
        ...base,
        service: Number(base.service) + 10,
        name: "Generic Followers",
      },
      ...(url.hostname === "bulkfollows.com"
        ? [{ ...base, service: 30, name: "Generic Followers" }]
        : []),
    ]);
  }, async () => {
    const result = await syncSmmProviders(admin, 1500);
    equal(result.processed, 4);
    const exact = saved.supplier_product_routes.find((row) =>
      row.match_key === key
    );
    equal(exact.product_key, "1");
    equal(exact.routes.length, 2);
    const ambiguous = saved.supplier_product_routes.filter((row) =>
      row.match_key !== key
    );
    equal(ambiguous.length, 3);
    assert(ambiguous.every((row) => row.routes.length === 1));
    assert(
      saved.smm_services.every((row) => row.is_active === undefined),
      "Sync must preserve admin visibility choices",
    );
  });
});
Deno.test("boost dispatch never buys a live product whose refill terms changed", async () => {
  let buys = 0;
  const admin = {
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  };
  await mock({ SMM_PANEL_API_KEY: "synthetic-lord" }, (_url, init) => {
    if (new URLSearchParams(String(init.body)).get("action") === "services") {
      return json([{ ...smmProduct, service: 1, refill: true }]);
    }
    buys++;
    return json({ order: 42 });
  }, async () => {
    await rejects(() =>
      dispatchSmmRoutes(admin, "synthetic-order", [{
        provider: "lordofpanels",
        serviceId: 1,
        rate: 1,
        min: 1,
        max: 1000,
        matchKey: smmKey,
      }], { service: 1, quantity: 10 })
    );
    equal(buys, 0);
  });
});
