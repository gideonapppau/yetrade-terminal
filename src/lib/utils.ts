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

/**
 * Rounds a lot size DOWN to the broker's volume step, so rounding can never
 * risk more than computed. The epsilon absorbs float error (0.29 / 0.01 is
 * 28.999...) that would otherwise drop a whole step.
 */
export function floorToStep(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  const decimals = (String(step).split('.')[1] || '').length;
  return Number((Math.floor(value / step + 1e-9) * step).toFixed(decimals));
}
