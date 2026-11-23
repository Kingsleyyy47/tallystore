import { providerHttp } from "./provider-http.ts";
import { providerRead } from "./provider-read-cache.ts";
import { IStarProvider } from "./istar-provider.ts";
import { isVisibleProvider, SMSBUS_DISPLAY_NAME } from "./provider-display.ts";
const env = (name: string) => Deno.env.get(name)?.trim() || "";
export type AccountBalance = {
  currency: string;
  available: string;
  pending?: string;
  label?: string;
};
export type ProviderBalance = {
  id: string;
  name: string;
  kind: string;
  configured: boolean;
  status: "ready" | "missing" | "unavailable" | "blocked" | "unsupported";
  balances: AccountBalance[];
  checked_at: string;
  message?: string;
};
type Definition = {
  id: string;
  name: string;
  kind: string;
  keys: string[];
  read?: (key: string) => Promise<AccountBalance[]>;
};
const amount = (value: unknown) => {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
  if (!/^-?\d+(?:\.\d{1,18})?$/.test(text) || !Number.isFinite(Number(text))) {
    throw new Error("BALANCE_UNAVAILABLE");
  }
  return text;
};
const balance = (
  currency: string,
  value: unknown,
  pending?: unknown,
): AccountBalance => ({
  currency,
  available: amount(value),
  ...(pending === undefined ? {} : { pending: amount(pending) }),
});
async function json(
  url: string,
  headers: Record<string, string> = {},
  body?: URLSearchParams,
) {
  const result = await providerHttp(url, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: body.toString() } : {}),
  });
  if (result.status === 403 || result.status === 401) {
    throw new Error("BALANCE_BLOCKED");
  }
  if (
    !result.ok || !result.data || result.data.error ||
    result.data.status === false || result.data.success === false
  ) throw new Error("BALANCE_UNAVAILABLE");
  return result.data;
}
export function parseAccountBalances(
  input: any,
  defaultCurrency?: string,
): AccountBalance[] {
  const data = input?.data ?? input;
  if (Array.isArray(data)) {
    return data.flatMap((row) => parseAccountBalances(row, defaultCurrency));
  }
  if (!data || typeof data !== "object") throw new Error("BALANCE_UNAVAILABLE");
  if (Array.isArray(data.accounts)) {
    return parseAccountBalances(data.accounts, defaultCurrency);
  }
  if (data.balance && typeof data.balance === "object") {
    return parseAccountBalances(data.balance, defaultCurrency);
  }
  const currency = data.currency || data.asset || defaultCurrency;
  const value = data.available_balance ?? data.available ?? data.balance ??
    data.amount;
  if (currency && value !== undefined && typeof value !== "object") {
    return [
      balance(
        String(currency).toUpperCase(),
        value,
        data.pending_balance ?? data.pending ?? data.pendingAmount,
      ),
    ];
  }
  const rows: AccountBalance[] = [];
  for (const [code, row] of Object.entries(data.balances ?? data)) {
    if (!/^[A-Z][A-Z0-9]{2,9}$/i.test(code)) continue;
    try {
      rows.push(
        ...(row && typeof row === "object"
          ? parseAccountBalances(row, code.toUpperCase())
          : [balance(code.toUpperCase(), row)]),
      );
    } catch { /* Skip non-balance metadata. */ }
  }
  if (!rows.length) throw new Error("BALANCE_UNAVAILABLE");
  return rows;
}
const handlerBalance =
  (host: string, currency: () => string) => async (key: string) => {
    const url = new URL(`https://${host}/stubs/handler_api.php`);
    url.searchParams.set("api_key", key);
    url.searchParams.set("action", "getBalance");
    const result = await providerHttp(url);
    const match = /^ACCESS_BALANCE:(-?\d+(?:\.\d+)?)$/.exec(result.text);
    if (!result.ok || !match) throw new Error("BALANCE_UNAVAILABLE");
    return [balance(currency(), match[1])];
  };
const panelBalance = (url: string) => async (key: string) =>
  parseAccountBalances(
    await json(
      url,
      { "Content-Type": "application/x-www-form-urlencoded" },
      new URLSearchParams({ key, action: "balance" }),
    ),
  );
let sageToken: { token: string; until: number } | undefined;
async function sageBalance(key: string): Promise<AccountBalance[]> {
  const publicKey = env("SAGECLOUD_PUBLIC_KEY");
  if (!publicKey) throw new Error("BALANCE_UNAVAILABLE");
  if (!sageToken || sageToken.until <= Date.now()) {
    const response = await providerHttp(
      "https://api.sagecloud.ng/api/merchant/authorization",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${publicKey}:${key}`)}`,
        },
      },
    );
    const auth = response.data?.data?.token;
    if (response.status === 401 || response.status === 403) throw new Error("BALANCE_BLOCKED");
    if (!response.ok || !auth?.access_token) {
      throw new Error("BALANCE_UNAVAILABLE");
    }
    sageToken = {
      token: String(auth.access_token),
      until: Math.min(
        Date.parse(auth.expires_at) || Date.now(),
        Date.now() + 300_000,
      ) - 30_000,
    };
  }
  const data = await json("https://api.sagecloud.ng/api/wallet/balance", {
    Authorization: `Bearer ${sageToken.token}`,
  });
  if (data.success !== true) throw new Error("BALANCE_UNAVAILABLE");
  return [["general_wallet", "General"], ["sme_data_wallet", "SME data"], [
    "corporate_data_wallet",
    "Corporate data",
  ]].flatMap(([field, label]) =>
    data[field]?.balance === undefined
      ? []
      : [{ ...balance("NGN", data[field].balance), label }]
  );
}
const definitions: Definition[] = [
  {
    id: "getatext",
    name: "GetAText",
    kind: "sms",
    keys: ["GETATEXT_API_KEY"],
    read: async (key) =>
      parseAccountBalances(
        await json("https://getatext.com/api/v1/balance", { Auth: key }),
        "USD",
      ),
  },
  {
    id: "daisysms_io",
    name: "DaisySMS .io",
    kind: "sms",
    keys: [
      "DAISYSMS_IO_API_KEY",
      ...(!env("DAISYSMS_BASE_URL").includes("daisysms.com/")
        ? ["DAISYSMS_API_KEY"]
        : []),
    ],
    read: handlerBalance("daisysms.io", () => "USD"),
  },
  {
    id: "daisysms_com",
    name: "DaisySMS .com",
    kind: "sms",
    keys: [
      "DAISYSMS_COM_API_KEY",
      ...(env("DAISYSMS_BASE_URL").includes("daisysms.com/")
        ? ["DAISYSMS_API_KEY"]
        : []),
    ],
    read: handlerBalance("daisysms.com", () => "USD"),
  },
  {
    id: "daisysim",
    name: "DaisySim direct API (legacy)",
    kind: "sms",
    keys: ["DAISYSIM_API_KEY"],
    read: async (key) =>
      parseAccountBalances(
        await json("https://daisysim.com/api/v1/virtual/balance", {
          Authorization: `Bearer ${key}`,
        }),
        "USD",
      ),
  },
  {
    id: "herosms",
    name: "HeroSMS",
    kind: "sms",
    keys: ["HEROSMS_API_KEY", "SMSACTIVATE_API_KEY"],
    read: handlerBalance(
      "hero-sms.com",
      () => env("HEROSMS_CURRENCY") || "account units",
    ),
  },
  {
    id: "textverify",
    name: "TextVerify",
    kind: "sms",
    keys: ["TEXTVERIFY_API_KEY"],
    read: async (key) =>
      parseAccountBalances(
        await json("https://panel.textverify.io/api/v2/account-details", {
          Authorization: `Bearer ${key}`,
        }),
        "USD",
      ),
  },
  {
    id: "smsbus",
    name: SMSBUS_DISPLAY_NAME,
    kind: "sms",
    keys: ["SMSBUS_API_KEY"],
    read: async (key) => {
      const url = new URL("https://sms-bus.com/api/control/get/balance");
      url.searchParams.set("token", key);
      const data = await json(url.toString());
      if (data.code !== 200) throw new Error("BALANCE_UNAVAILABLE");
      return [balance("USD", data.data?.balance, data.data?.frozen)];
    },
  },
  { id: "pvacodes", name: "PVACodes", kind: "sms", keys: ["PVACODES_API_KEY"] },
  {
    id: "lordofpanels",
    name: "Lord of Panels",
    kind: "boosting",
    keys: ["LORDOFPANELS_API_KEY", "SMM_PANEL_API_KEY"],
    read: panelBalance("https://thelordofthepanels.com/api/v2"),
  },
  {
    id: "bulkfollows",
    name: "BulkFollows",
    kind: "boosting",
    keys: ["BULKFOLLOWS_API_KEY"],
    read: panelBalance("https://bulkfollows.com/api/v2"),
  },
  {
    id: "bitrefill",
    name: "Bitrefill",
    kind: "digital",
    keys: ["BITREFILL_API_KEY"],
    read: async (key) =>
      parseAccountBalances(
        await json("https://api.bitrefill.com/v2/accounts/balance", {
          Authorization: `Bearer ${key}`,
        }),
      ),
  },
  {
    id: "fragmentapi",
    name: "FragmentAPI",
    kind: "digital",
    keys: ["FRAGMENTAPI_API_KEY", "ISTAR_API_KEY"],
    read: async (key) => {
      const client = new IStarProvider({
        apiKey: key,
        baseURL: env("FRAGMENTAPI_BASE_URL") || env("ISTAR_BASE_URL") ||
          "https://v1.fragmentapi.app/api/v1/partner",
      });
      return (await Promise.all(
        ["USDT", "TON"].map(async (currency) =>
          parseAccountBalances(
            await client.get(`/wallet/balance?wallet_type=${currency}`),
            currency,
          )
        ),
      )).flat();
    },
  },
  {
    id: "korapay",
    name: "Kora",
    kind: "payments",
    keys: ["KORAPAY_SECRET_KEY"],
    read: async (key) =>
      parseAccountBalances(
        await json("https://api.korapay.com/merchant/api/v1/balances", {
          Authorization: `Bearer ${key}`,
        }),
      ),
  },
  {
    id: "nowpayments",
    name: "NOWPayments",
    kind: "payments",
    keys: ["NOWPAYMENTS_API_KEY"],
    read: async (key) =>
      parseAccountBalances(
        await json("https://api.nowpayments.io/v1/balance", {
          "x-api-key": key,
        }),
      ),
  },
  {
    id: "pocketfi",
    name: "PocketFi",
    kind: "payments",
    keys: ["POCKETFI_API_TOKEN", "POCKETFI_PUBLIC_KEY"],
    read: async (key) =>
      parseAccountBalances(
        await json("https://api.pocketfi.ng/api/v1/account/balance", {
          Authorization: `Bearer ${key}`,
        }),
        "NGN",
      ),
  },
  {
    id: "ercaspay",
    name: "ErcasPay",
    kind: "payments",
    keys: ["ERCASPAY_SECRET_KEY"],
  },
  {
    id: "sagecloud",
    name: "Sagecloud",
    kind: "other",
    keys: ["SAGECLOUD_SECRET_KEY"],
    read: sageBalance,
  },
  {
    id: "muabanvia",
    name: "Muabanvia",
    kind: "other",
    keys: ["MUABANVIA_API_KEY"],
  },
  {
    id: "shopclone",
    name: "ShopClone",
    kind: "other",
    keys: ["SHOPCLONE_API_KEY"],
  },
  {
    id: "shopviaclone",
    name: "ShopViaClone",
    kind: "other",
    keys: ["SHOPVIACLONE_API_KEY"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "other",
    keys: ["ANTHROPIC_API_KEY"],
  },
];
export async function providerBalances(): Promise<ProviderBalance[]> {
  const visible=definitions.filter(definition => isVisibleProvider(definition.id,definition.keys.some(name=>!!env(name))));
  return Promise.all(visible.map(async (definition) => {
    const key = definition.keys.map(env).find(Boolean),
      base = {
        id: definition.id,
        name: definition.name,
        kind: definition.kind,
        configured: !!key,
      };
    if (!key) {
      return {
        ...base,
        status: "missing" as const,
        balances: [],
        checked_at: new Date().toISOString(),
        message: "API key not configured.",
      };
    }
    if (!definition.read) {
      return {
        ...base,
        status: "unsupported" as const,
        balances: [],
        checked_at: new Date().toISOString(),
        message:
          "A verified balance endpoint is not available for this integration.",
      };
    }
    return providerRead(
      `provider-balance:${definition.id}`,
      60_000,
      async () => {
        const checked_at = new Date().toISOString();
        try {
          return {
            ...base,
            status: "ready" as const,
            balances: await definition.read!(key),
            checked_at,
          };
        } catch (error) {
          const blocked = error instanceof Error &&
            error.message === "BALANCE_BLOCKED";
          return {
            ...base,
            status: blocked ? "blocked" as const : "unavailable" as const,
            balances: [],
            checked_at,
            message: blocked
              ? "Provider denied the API request. Check API access or IP restrictions."
              : "Balance could not be verified. Refresh after one minute.",
          };
        }
      },
    );
  }));
}
