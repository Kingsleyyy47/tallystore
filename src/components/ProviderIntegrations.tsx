import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Provider = {
  id: string;
  name: string;
  configured: boolean;
  keys: string[];
  docs: string;
  blocked?: boolean;
  note?: string;
};
export default function ProviderIntegrations() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [country, setCountry] = useState("US");
  const [cursor, setCursor] = useState(0);
  const [matches, setMatches] = useState<
    Array<
      {
        name: string;
        routes: Array<{ provider: string; stock?: number; price_usd: number }>;
      }
    >
  >([]);
  async function run(action: string) {
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "provider-integrations",
        { body: { action, country, cursor } },
      );
      if (error || !data?.success) {
        throw new Error(data?.error || "Provider request failed.");
      }
      if (action === "status") setProviders(data.data);
      if (action === "sms_matches" || action === "smm_matches") setMatches(data.data);
      if (action === "sync_daisysim") {
        setCursor(data.next_cursor ?? 0);
        setMessage(
          data.next_cursor == null
            ? `Country sync finished: ${data.processed} quotes imported.`
            : `Imported ${data.processed} quotes. Wait one minute before syncing the next page.`,
        );
      }
      if (action === "sync_smm") {
        setMessage(
          `Synced ${data.processed} boosting products. ${
            JSON.stringify(data.diagnostics)
          }`,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Provider request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add supplier credentials in Supabase Edge Function secrets, then check
        configuration and sync catalogues. Matching preserves each product’s
        country and service features.
      </p>
      <Button disabled={busy} onClick={() => void run("status")}>
        Check provider configuration
      </Button>
      <div className="max-h-96 space-y-3 overflow-y-auto">
        {providers.map((provider) => (
          <div key={provider.id} className="rounded-lg border p-3 text-sm">
            <div className="flex justify-between gap-3">
              <a
                className="font-medium underline"
                href={provider.docs}
                target="_blank"
                rel="noreferrer"
              >
                {provider.name}
              </a>
              <span>
                {provider.blocked
                  ? "Documentation required"
                  : provider.configured
                  ? "Key configured"
                  : "Key missing"}
              </span>
            </div>
            <p className="mt-1 break-words font-mono text-xs">
              {provider.keys.join(", ")}
            </p>
            {provider.note && (
              <p className="mt-1 text-xs text-muted-foreground">
                {provider.note}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Country ISO code"
          value={country}
          maxLength={2}
          className="w-20"
          onChange={(event) => {
            setCountry(event.target.value.toUpperCase());
            setCursor(0);
          }}
        />
        <Button
          variant="outline"
          disabled={busy || country.length !== 2}
          onClick={() => void run("sms_matches")}
        >
          Inspect SMS matches
        </Button>
        {providers.some(provider=>provider.id==='daisysim'&&provider.configured)&&<Button
          variant="outline"
          disabled={busy || country.length !== 2}
          onClick={() => void run("sync_daisysim")}
        >
          Sync legacy direct API {cursor ? `from ${cursor}` : "country"}
        </Button>}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run("sync_smm")}
        >
          Sync boosting providers
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run("smm_matches")}>Inspect boosting matches</Button>
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
      {matches.length > 0 && (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th>Product</th>
                <th>Matching suppliers</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match, index) => (
                <tr key={`${match.name}-${index}`} className="border-t">
                  <td className="p-2">{match.name}</td>
                  <td className="p-2">
                    {match.routes.map((route) =>
                      `${route.provider}: ${route.stock === undefined ? 'rate' : `${route.stock} available`} ($${route.price_usd})`
                    ).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
