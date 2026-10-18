// Currency display — the engine stores everything in USD; this converts + formats
// to the local currency of whichever ASEAN district we're in (or a manual toggle).
// Rates are ~2026 ballparks, labelled; a demo aid, not an FX product.

import fin from "@/data/assumptions/finance.json";

export type CurrencyCode = "USD" | "SGD" | "THB" | "VND";

const CUR = (fin as any).currencies as Record<CurrencyCode, { symbol: string; code: string; per_usd: number }>;
const DISTRICT_CURRENCY = (fin as any).district_currency as Record<string, CurrencyCode>;

export const CURRENCIES = Object.keys(CUR) as CurrencyCode[];

export function currencyForDistrict(districtId: string): CurrencyCode {
  return DISTRICT_CURRENCY[districtId] ?? "SGD";
}

export function convertFromUsd(usd: number, code: CurrencyCode): number {
  return usd * (CUR[code]?.per_usd ?? 1);
}

/** Format a USD amount into the target currency with a compact k/M suffix. */
export function formatMoney(usd: number, code: CurrencyCode = "SGD"): string {
  const c = CUR[code] ?? CUR.SGD;
  const v = usd * c.per_usd;
  const abs = Math.abs(v);
  let body: string;
  if (abs >= 1_000_000_000) body = `${(v / 1_000_000_000).toFixed(1)}B`;
  else if (abs >= 1_000_000) body = `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 1_000) body = `${Math.round(v / 1_000)}k`;
  else body = `${Math.round(v)}`;
  return `${c.symbol}${body}`;
}

export function currencySymbol(code: CurrencyCode): string {
  return CUR[code]?.symbol ?? "$";
}
