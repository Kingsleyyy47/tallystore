import { smsBrandIcons } from "@/lib/sms-brand-icons";
import { Link } from "react-router-dom";

export type SmsCardService = {
  service_id: string;
  service_name: string;
  country_code?: string | null;
  country_id: number;
  multiple_sms?: boolean;
  available_count: number;
  price_ngn: number;
};
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
export function smsCardTitle(service: SmsCardService) {
  const code = (service.country_code || "US").toUpperCase();
  return `${
    code === "US" ? "US" : countryNames.of(code) || code
  } ${service.service_name}`;
}
export const smsMessageMode = (service: SmsCardService) =>
  service.multiple_sms === true ? "Multi SMS" : "Single SMS";
export const smsCardPrice = (value: number) =>
  `₦${value.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const brands: Record<string, string> = {
  whatsapp: "whatsapp",
  telegram: "telegram",
  signal: "signal",
  instagram: "instagram",
  facebook: "facebook",
  tiktok: "tiktok",
  snapchat: "snapchat",
  discord: "discord",
  twitter: "x",
  linkedin: "linkedin",
  reddit: "reddit",
  viber: "viber",
  twitch: "twitch",
  pinterest: "pinterest",
  youtube: "youtube",
  netflix: "netflix",
  spotify: "spotify",
  google: "google",
  gmail: "gmail",
  paypal: "paypal",
  amazon: "amazon",
  apple: "apple",
  zoom: "zoom",
  bumble: "bumble",
  tinder: "tinder",
  steam: "steam",
  yahoo: "yahoo",
  threads: "threads",
  douyin: "tiktok",
  wechat: "wechat",
  line: "line",
  kakaotalk: "kakaotalk",
  weibo: "sinaweibo",
  vk: "vk",
  tumblr: "tumblr",
  badoo: "badoo",
  quora: "quora",
  patreon: "patreon",
  onlyfans: "onlyfans",
  bluesky: "bluesky",
  mastodon: "mastodon",
  messenger: "messenger",
};
export function SmsServiceIcon(
  { service, className = "" }: { service: SmsCardService; className?: string },
) {
  const name = service.service_name.toLowerCase(),
    slug = Object.entries(brands).find(([term]) => name.includes(term))?.[1];
  return (
    <span
      aria-hidden="true"
      className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-2 shadow-sm ${className}`}
    >
      {name.includes("microsoft") || name.includes("outlook")
        ? (
          <svg viewBox="0 0 24 24" className="h-8 w-8">
            <path fill="#f35325" d="M1 1h10v10H1z" />
            <path fill="#81bc06" d="M13 1h10v10H13z" />
            <path fill="#05a6f0" d="M1 13h10v10H1z" />
            <path fill="#ffba08" d="M13 13h10v10H13z" />
          </svg>
        )
        : slug && smsBrandIcons[slug]
        ? (
          <img
            src={smsBrandIcons[slug]}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-8 w-8 object-contain"
            />
        )
        : (
          <span className="text-xl font-black text-violet-600">
            {service.service_name.trim().slice(0, 2).toUpperCase()}
          </span>
        )}
    </span>
  );
}
export function SmsServiceCard(
  { service, selected, onSelect }: {
    service: SmsCardService;
    selected: boolean;
    onSelect: () => void;
  },
) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${smsCardTitle(service)}, ${smsMessageMode(service)}, ${
        smsCardPrice(service.price_ngn)
      }`}
      data-sms-service={service.service_id}
      data-sms-country={service.country_code || "us"}
      onClick={onSelect}
      className={`flex w-full min-w-0 items-center gap-3 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-violet-500 bg-violet-50 dark:bg-violet-400/20"
          : "border-slate-200 bg-slate-50 hover:border-violet-400 dark:border-slate-600/60 dark:bg-slate-800"
      }`}
    >
      <SmsServiceIcon service={service} />
      <div className="min-w-0 flex-1">
        <p
          className={`break-words text-sm font-bold sm:text-base ${
            selected
              ? "text-violet-600 dark:text-violet-300"
              : "text-slate-950 dark:text-white"
          }`}
        >
          {smsCardTitle(service)}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {smsMessageMode(service)}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-[#7566f5] px-3 py-2 text-sm font-bold text-white">
        {smsCardPrice(service.price_ngn)}
      </span>
    </button>
  );
}
export function SmsPurchasePanel({
  service,
  ready,
  busy,
  walletBalance,
  walletLoading,
  walletUnavailable,
  onBuy,
  onDismiss,
}: {
  service: SmsCardService;
  ready: boolean;
  busy: boolean;
  walletBalance: number;
  walletLoading: boolean;
  walletUnavailable: boolean;
  onBuy: () => void;
  onDismiss?: () => void;
}) {
  const shortfall = Math.max(0, service.price_ngn - walletBalance);
  const insufficient = !walletUnavailable && !walletLoading && shortfall > 0;
  const pending = busy || walletLoading || walletUnavailable;
  const canContinue = ready && !pending &&
    !insufficient;
  return (
    <section
      aria-label="Selected SMS service"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-40 px-3 md:bottom-5"
    >
      <div className="pointer-events-auto mx-auto max-w-2xl overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-[0_8px_45px_rgba(76,29,149,0.24)] dark:border-violet-400/25 dark:bg-[#171323]">
        <div className="h-1 bg-gradient-to-r from-violet-500 via-fuchsia-400 to-violet-500" />
        <div className="px-4 pb-3 pt-3">
          <div className="flex items-center gap-3">
            <SmsServiceIcon service={service} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-bold sm:text-base">
                {smsCardTitle(service)}
              </p>
              <span className="mt-1 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-400/15 dark:text-violet-300">
                {smsMessageMode(service)}
              </span>
            </div>
            {onDismiss && (
              <button
                type="button"
                aria-label="Clear selected SMS service"
                disabled={busy}
                onClick={onDismiss}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xl text-slate-400 hover:bg-violet-100 dark:hover:bg-white/10"
              >
                ×
              </button>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl bg-violet-50 px-3 py-2.5 dark:bg-white/5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Total
              </p>
              <p className="text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                {smsCardPrice(service.price_ngn)}
              </p>
            </div>
            {insufficient && ready && !busy
              ? (
                <Link
                  to="/wallet"
                  className="inline-flex h-11 shrink-0 items-center gap-3 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-500"
                >
                  Add Funds <span aria-hidden="true">↗</span>
                </Link>
              )
              : (
                <button
                  type="button"
                  disabled={!canContinue}
                  onClick={onBuy}
                  className="inline-flex h-11 shrink-0 items-center gap-3 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? "Please wait…"
                    : walletLoading
                    ? "Checking…"
                    : walletUnavailable
                    ? "Check wallet"
                    : !ready
                    ? "Checking…"
                    : "Continue"}
                  {canContinue && <span aria-hidden="true">→</span>}
                </button>
              )}
          </div>
          <p
            className={`mt-2 flex flex-wrap items-center justify-between gap-1 px-1 text-[11px] ${
              insufficient
                ? "text-amber-700 dark:text-amber-300"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            <span>
              Wallet {walletLoading
                ? "checking…"
                : walletUnavailable
                ? "unavailable"
                : smsCardPrice(walletBalance)}
            </span>
            <span>
              {!ready
                ? "Checking connection"
                : insufficient
                ? `${smsCardPrice(shortfall)} left to add`
                : walletUnavailable
                ? "Refresh your balance to continue"
                : walletLoading
                ? ""
                : busy
                ? "Preparing your number"
                : "Review before payment"}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
