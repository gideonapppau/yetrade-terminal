import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

/**
 * Converts a distance in pips to a count of points for an instrument with
 * the given point size. On 5/3-digit instruments one pip equals ten points;
 * on even-digit pricing a point is a pip.
 */
export function pipsToPoints(pips: number, point: number): number {
  if (!(point > 0)) return 0;
  const digits = Math.round(-Math.log10(point));
  return digits % 2 === 1 ? pips * 10 : pips;
}
