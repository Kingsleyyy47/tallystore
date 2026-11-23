import {
  liveSmmCatalogue,
  publicSmmService,
  refreshSmmService,
} from "../supabase/functions/_shared/smm-live-catalog.ts";
import {
  fundedSmmRoutes,
  smmProviderCatalogue,
  smmServiceIdentity,
  syncSmmProviders,
} from "../supabase/functions/_shared/smm-provider-router.ts";
import { invalidateProviderRead } from "../supabase/functions/_shared/provider-read-cache.ts";
const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw new Error(message);
};
const equal = (a: unknown, b: unknown) =>
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
  );
const rejects = async (task: () => Promise<unknown>) => {
  let failed = false;
  try {
    await task();
  } catch {
    failed = true;
  }
  assert(failed, "Expected rejection");
};
const row = (id = 123, extra: Record<string, unknown> = {}) => ({
  service: id,
  name: "Live Followers",
  category: "Instagram Followers",
  type: "Default",
  rate: "2",
  min: "10",
  max: "1000",
  refill: true,
  cancel: false,
  ...extra,
});
const stored = (external = 123, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(external).padStart(12, "0")}`,
  external_id: external,
  is_active: true,
  name: "Old label",
  category: "Old category",
  service_type: "Default",
  rate_usd: 1,
  price_ngn: 2000,
  min_quantity: 1,
  max_quantity: 5000,
  supplier_routing: false,
  ...extra,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
async function fixture(task: (state: any) => Promise<void>) {
  const fetch = globalThis.fetch, clock = Date.now;
  const names = [
    "LORDOFPANELS_API_KEY",
    "SMM_PANEL_API_KEY",
    "BULKFOLLOWS_API_KEY",
  ];
  const saved = names.map((key) => Deno.env.get(key));
  names.forEach((key) => Deno.env.delete(key));
  Deno.env.set("SMM_PANEL_API_KEY", "synthetic-lord");
  Deno.env.set("BULKFOLLOWS_API_KEY", "synthetic-bulk");
  invalidateProviderRead("");
  const state: any = {
    now: clock(),
    catalogues: { lordofpanels: [row()], bulkfollows: [row(456)] },
    balances: { lordofpanels: "100", bulkfollows: "100" },
    calls: [],
    enabled: [stored()],
    reads: 0,
    fail: false,
  };
  Date.now = () => state.now;
  state.admin = {
    rpc: async (name: string, args: any) => {
      equal(name, "get_enabled_smm_catalog");
      state.reads++;
      return { data: state.enabled, error: null };
    },
    from: (table: string) => {
      equal(table, "app_settings");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({ data: { value: "1000" }, error: null }),
      };
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const provider = url.hostname === "bulkfollows.com"
      ? "bulkfollows"
      : "lordofpanels";
    const action = new URLSearchParams(String(init.body)).get("action");
    assert(
      action === "services" || action === "balance",
      "Read-only fixtures never buy",
    );
    state.calls.push({ provider, action });
    if (action === "balance") {
      return json({ currency: "USD", balance: state.balances[provider] });
    }
    if (state.fail) throw new Error("synthetic outage");
    if (state.hold) return state.hold(provider);
    return json(state.catalogues[provider]);
  };
  try {
    await task(state);
  } finally {
    globalThis.fetch = fetch;
    Date.now = clock;
    names.forEach((key, i) =>
      saved[i] === undefined
        ? Deno.env.delete(key)
        : Deno.env.set(key, saved[i]!)
    );
    invalidateProviderRead("");
  }
}
Deno.test("boost browse intersects enabled IDs with live details and never returns private supplier fields", async () => {
  await fixture(async (state) => {
    state.enabled = [stored(), stored(999), stored(456, { is_active: false })];
    state.catalogues.lordofpanels = [row(), row(321, { name: "Not imported" })];
    const result = await liveSmmCatalogue(state.admin, {
      query: "Live",
      platform: "instagram",
    });
    equal(result.length, 1);
    equal(result[0].id, stored().id);
    equal(result[0].name, "Live Followers");
    equal(result[0].price_ngn, 4000);
    equal([
      result[0].min_quantity,
      result[0].max_quantity,
      result[0].has_refill,
      result[0].has_cancel,
    ], [10, 1000, true, false]);
    const body = JSON.stringify(result);
    for (
      const secret of [
        "external_id",
        "supplier_routes",
        "rate_usd",
        "_live",
        "synthetic-lord",
        "lordofpanels",
      ]
    ) assert(!body.includes(secret));
    state.enabled = [];
    equal(await liveSmmCatalogue(state.admin), []);
  });
});
Deno.test("boost catalogue shares reads for 30 seconds, owner toggles remain fresh, removed IDs disappear", async () => {
  await fixture(async (state) => {
    await Promise.all(
      Array.from({ length: 12 }, () => liveSmmCatalogue(state.admin)),
    );
    equal(
      state.calls.filter((call: any) => call.action === "services").length,
      1,
    );
    state.enabled = [];
    equal(await liveSmmCatalogue(state.admin), []);
    state.enabled = [stored()];
    state.catalogues.lordofpanels = [row(777, { name: "Live Followers" })];
    equal((await liveSmmCatalogue(state.admin)).length, 1);
    state.now += 30_001;
    equal(await liveSmmCatalogue(state.admin), []);
    equal(
      state.calls.filter((call: any) => call.action === "services").length,
      2,
    );
    equal(
      state.calls.filter((call: any) => call.action === "balance").length,
      1,
    );
  });
});
Deno.test("purchase refresh bypasses browsing cache for price, quantity, type and removal checks", async () => {
  await fixture(async (state) => {
    await liveSmmCatalogue(state.admin);
    state.catalogues.lordofpanels = [
      row(123, {
        rate: "3",
        min: "40",
        max: "80",
        name: "Renamed Live Service",
        cancel: true,
      }),
    ];
    const current = await refreshSmmService(state.admin, stored(), {
      fresh: true,
    });
    equal([
      current.price_ngn,
      current.min_quantity,
      current.max_quantity,
      current.name,
      current.has_cancel,
    ], [6000, 40, 80, "Renamed Live Service", true]);
    equal(current._live_smm_routes[0].rate, 3);
    state.catalogues.lordofpanels = [];
    await rejects(() =>
      refreshSmmService(state.admin, stored(), { fresh: true })
    );
    state.catalogues.lordofpanels = [row(123, { type: "Subscriptions" })];
    await rejects(() =>
      refreshSmmService(state.admin, stored(), { fresh: true })
    );
    await rejects(() =>
      refreshSmmService(state.admin, stored(123, { is_active: false }), {
        fresh: true,
      })
    );
    equal(Object.keys(publicSmmService(current)).length, 11);
  });
});
Deno.test("purchase fresh catalogue does not join an old browsing read in flight", async () => {
  await fixture(async (state) => {
    let release: (response: Response) => void = () => {};
    let arrived: () => void = () => {};
    const started = new Promise<void>((resolve) => arrived = resolve);
    state.hold = () => {
      arrived();
      return new Promise<Response>((resolve) => release = resolve);
    };
    const browsing = smmProviderCatalogue("lordofpanels");
    await started;
    state.hold = null;
    state.catalogues.lordofpanels = [row(123, { rate: "9" })];
    const fresh = await smmProviderCatalogue("lordofpanels", true);
    equal(fresh[0].rate, "9");
    release(json([row(123, { rate: "2" })]));
    equal((await browsing)[0].rate, "2");
    equal(
      state.calls.filter((call: any) => call.action === "services").length,
      2,
    );
  });
});
Deno.test("failed provider catalogue is not cached and duplicate supplier IDs fail closed", async () => {
  await fixture(async (state) => {
    state.fail = true;
    await rejects(() => smmProviderCatalogue("lordofpanels"));
    state.fail = false;
    equal((await smmProviderCatalogue("lordofpanels")).length, 1);
    state.catalogues.lordofpanels = [row(), row()];
    await rejects(() => smmProviderCatalogue("lordofpanels", true));
  });
});
Deno.test("live matching keeps fallback only for unchanged product promises and primary ID presence", async () => {
  await fixture(async (state) => {
    const service = stored(123, {
      supplier_routing: true,
      supplier_routes: [{ provider: "lordofpanels", serviceId: 123 }, {
        provider: "bulkfollows",
        serviceId: 456,
      }],
    });
    let current = await refreshSmmService(state.admin, service, {
      fresh: true,
    });
    equal(current._live_smm_routes.length, 2);
    state.catalogues.bulkfollows = [row(456, { refill: false })];
    current = await refreshSmmService(state.admin, service, { fresh: true });
    equal(current._live_smm_routes.length, 1);
    state.catalogues.lordofpanels = [];
    await rejects(() =>
      refreshSmmService(state.admin, service, { fresh: true })
    );
    state.balances.lordofpanels = "0";
    state.balances.bulkfollows = "5";
    equal(
      await fundedSmmRoutes(
        [{ provider: "lordofpanels", rate: 2 }, {
          provider: "bulkfollows",
          rate: 2,
        }] as any,
        1000,
        false,
      ),
      true,
    );
  });
});
Deno.test("sync never transfers owner approval to a replacement supplier ID with the same name", async () => {
  await fixture(async (state) => {
    Deno.env.delete("BULKFOLLOWS_API_KEY");
    state.catalogues.lordofpanels = [row(777)];
    const writes: Record<string, any[]> = {};
    const admin = {
      from: (table: string) => ({
        select: () => ({
          eq: async () => ({
            data: [{
              match_key: smmServiceIdentity(row()),
              product_key: "123",
            }],
            error: null,
          }),
        }),
        upsert: async (rows: any[]) => {
          writes[table] = rows;
          return { error: null };
        },
      }),
    };
    await syncSmmProviders(admin, 1000);
    equal(writes.smm_services[0].external_id, 777);
    equal(writes.supplier_product_routes[0].product_key, "777");
    assert(
      !Object.hasOwn(writes.smm_services[0], "is_active"),
      "Existing owner toggles must survive sync",
    );
  });
});
Deno.test("live catalogue loads beyond 1000 enabled services with one database and one upstream read", async () => {
  await fixture(async (state) => {
    state.enabled = Array.from({ length: 1501 }, (_, i) => stored(i + 1));
    state.catalogues.lordofpanels = state.enabled.map((service: any) =>
      row(service.external_id)
    );
    state.admin.rpc = async (_name: string, _args: any) => {
      state.reads++;
      return { data: state.enabled, error: null };
    };
    const services = await liveSmmCatalogue(state.admin);
    equal(services.length, 1501);
    equal(state.reads, 1);
    equal(
      state.calls.filter((call: any) => call.action === "services").length,
      1,
    );
  });
});
