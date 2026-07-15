import type { EstimateBand } from "@/lib/cost/schema";

export function formatCurrencyMinor(amountMinor: number, currency: string, locale: string) {
  const minorUnitDigits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const minorUnitDivisor = 10 ** minorUnitDigits;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / minorUnitDivisor);
}

export function formatEstimateRange(band: EstimateBand, currency: string, locale: string) {
  return `${formatCurrencyMinor(band.lowMinor, currency, locale)}–${formatCurrencyMinor(band.highMinor, currency, locale)}`;
}
