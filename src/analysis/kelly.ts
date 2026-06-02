/**
 * Full Kelly fraction for a binary prediction market bet.
 * f* = (q - p) / (1 - p)
 * where p = market entry price, q = true outcome probability.
 * Returns 0 when there is no edge (q <= p).
 */
export function kellyFraction(trueProbability: number, marketPrice: number): number {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  return Math.max(0, (trueProbability - marketPrice) / (1 - marketPrice));
}

export function expectedValue(trueProbability: number, marketPrice: number): number {
  const netOdds = (1 - marketPrice) / marketPrice;
  return trueProbability * netOdds - (1 - trueProbability);
}

/**
 * Fractional Kelly: multiply full Kelly by a safety factor (default 0.5).
 * Half-Kelly captures ~75% of long-run growth at ~25% of full-Kelly variance.
 */
export function fractionalKelly(
  trueProbability: number,
  marketPrice: number,
  fraction: number,
): number {
  return fraction * kellyFraction(trueProbability, marketPrice);
}
