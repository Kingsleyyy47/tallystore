import { getNgnUsdRate } from "./exchange-rate.ts";
import { providerRead } from "./provider-read-cache.ts";
import { normalizePlatform, type SmmService } from "./smm-panel-client.ts";
import { getSmmOrderContract, SMM_UNAVAILABLE } from "./smm-order-contract.ts";
import {
  SMM_BULK_OFFSET,
  type SmmProvider,
  smmProviderCatalogue,
  type SmmRoute,
  smmServiceIdentity,
} from "./smm-provider-router.ts";

type Options = {
  indexes?: Map<SmmProvider, Map<number, SmmService>>;
  fresh?: boolean;
  rate?: number;
  loadCatalogue?: (
    provider: SmmProvider,
    fresh: boolean,
  ) => Promise<SmmService[]>;
};
const retailPrice = (rate: number, fx: number) => Math.ceil(rate * fx * 2);
function anchor(service: any, routes: SmmRoute[]): SmmRoute | undefined {
  const external = Number(service.external_id),
    provider: SmmProvider = external >= SMM_BULK_OFFSET
      ? "bulkfollows"
      : "lordofpanels";
  const id = external >= SMM_BULK_OFFSET
    ? external - SMM_BULK_OFFSET
    : external;
  return routes.find((route) =>
    route.provider === provider && Number(route.serviceId) === id
  );
}
async function savedRoutes(admin: any, service: any): Promise<SmmRoute[]> {
  if (Object.hasOwn(service, "supplier_routes")) {
    return Array.isArray(service.supplier_routes)
      ? service.supplier_routes
      : service.supplier_routing === true
      ? []
      : [
        {
          provider: "lordofpanels",
          serviceId: Number(service.external_id),
        } as SmmRoute,
      ];
  }
  if (service.supplier_routing !== true) {
    return [
      {
        provider: "lordofpanels",
        serviceId: Number(service.external_id),
      } as SmmRoute,
    ];
  }
  const result = await admin.from("supplier_product_routes").select("routes")
    .eq("family", "smm").eq("product_key", String(service.external_id))
    .maybeSingle();
  if (result.error) throw new Error("SMM_CATALOG_UNAVAILABLE");
  return Array.isArray(result.data?.routes) ? result.data.routes : [];
}
export async function refreshSmmService(
  admin: any,
  stored: any,
  options: Options = {},
): Promise<any> {
  if (!stored || stored.is_active !== true) throw new Error(SMM_UNAVAILABLE);
  const routes = await savedRoutes(admin, stored),
    primary = anchor(stored, routes);
  if (!primary) throw new Error(SMM_UNAVAILABLE);
  const load = options.loadCatalogue || smmProviderCatalogue;
  const snapshots = new Map<SmmProvider, Map<number, SmmService>>();
  await Promise.all(
    [...new Set(routes.map((route) => route.provider))].map(
      async (provider) => {
        try {
          const rows = await load(provider, options.fresh === true);
          let index = options.indexes?.get(provider);
          if (!index) {
            index = new Map(rows.map((row) => [Number(row.service), row]));
            options.indexes?.set(provider, index);
          }
          snapshots.set(provider, index);
        } catch {
          if (provider === primary.provider) {
            throw new Error("SMM_CATALOG_UNAVAILABLE");
          }
        }
      },
    ),
  );
  const current = snapshots.get(primary.provider)?.get(
    Number(primary.serviceId),
  );
  // Owner approval follows this supplier ID. A new ID with the same name must
  // be imported and explicitly enabled; an old DB row cannot resurrect it.
  if (!current || !getSmmOrderContract(current.type)) {
    throw new Error(SMM_UNAVAILABLE);
  }
  const fx = options.rate ?? (await getNgnUsdRate(admin)).rate;
  if (!Number.isFinite(fx) || fx <= 0) {
    throw new Error("SMM_CATALOG_UNAVAILABLE");
  }
  const price = retailPrice(Number(current.rate), fx);
  if (!Number.isSafeInteger(price) || price <= 0) {
    throw new Error(SMM_UNAVAILABLE);
  }
  const key = smmServiceIdentity(current);
  const liveRoutes = routes.flatMap((route) => {
    const live = snapshots.get(route.provider)?.get(Number(route.serviceId));
    return live && smmServiceIdentity(live) === key
      ? [{
        provider: route.provider,
        serviceId: Number(live.service),
        rate: Number(live.rate),
        min: Number(live.min),
        max: Number(live.max),
        matchKey: key!,
      }]
      : [];
  });
  return {
    ...stored,
    name: current.name,
    category: current.category,
    platform: normalizePlatform(current.category),
    service_type: current.type,
    rate_usd: Number(current.rate),
    price_ngn: price,
    min_quantity: Number(current.min),
    max_quantity: Number(current.max),
    has_refill: current.refill === true,
    has_cancel: current.cancel === true,
    supplier_routing: true,
    _live_smm_routes: liveRoutes,
    _live_exchange_rate: fx,
  };
}
export function publicSmmService(service: any) {
  return {
    id: service.id,
    name: service.name,
    category: service.category,
    platform: service.platform,
    service_type: service.service_type,
    price_ngn: service.price_ngn,
    min_quantity: service.min_quantity,
    max_quantity: service.max_quantity,
    has_refill: service.has_refill,
    has_cancel: service.has_cancel,
    is_active: true,
  };
}
export async function liveSmmCatalogue(
  admin: any,
  options: {
    query?: string;
    platform?: string;
    limit?: number;
    internal?: boolean;
  } = {},
) {
  const result: { data: any[] | null; error: any } = await admin.rpc(
    "get_enabled_smm_catalog",
    {},
  );
  if (result.error || !Array.isArray(result.data)) {
    throw new Error("SMM_CATALOG_UNAVAILABLE");
  }
  const enabled = result.data;
  if (!enabled.length) return [];
  const { rate } = await providerRead(
    "smm-browse-fx",
    30_000,
    () => getNgnUsdRate(admin),
  );
  const requests = new Map<SmmProvider, Promise<SmmService[]>>();
  const loadCatalogue = (provider: SmmProvider) => {
    if (!requests.has(provider)) {
      requests.set(provider, smmProviderCatalogue(provider));
    }
    return requests.get(provider)!;
  };
  let unavailable = 0;
  const indexes = new Map<SmmProvider, Map<number, SmmService>>();
  const rows: any[] = [];
  for (let offset = 0; offset < enabled.length; offset += 250) {
    rows.push(
      ...await Promise.all(
        enabled.slice(offset, offset + 250).map(async (stored) => {
          try {
            return await refreshSmmService(admin, stored, {
              rate,
              loadCatalogue,
              indexes,
            });
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === "SMM_CATALOG_UNAVAILABLE"
            ) unavailable++;
            return null;
          }
        }),
      ),
    );
  }
  if (unavailable === enabled.length) {
    throw new Error("SMM_CATALOG_UNAVAILABLE");
  }
  const words = String(options.query || "").toLowerCase().trim().split(/\s+/)
    .filter((word) => word.length > 1);
  const filtered = rows.filter((row) =>
    row &&
    (!options.platform || options.platform === "all" ||
      row.platform === options.platform) &&
    (!words.length ||
      words.some((word) =>
        `${row.name} ${row.category} ${row.platform}`.toLowerCase().includes(
          word,
        )
      ))
  )
    .sort((a, b) =>
      String(a.name).localeCompare(String(b.name)) ||
      String(a.id).localeCompare(String(b.id))
    );
  const limited = options.limit ? filtered.slice(0, options.limit) : filtered;
  return options.internal ? limited : limited.map(publicSmmService);
}
