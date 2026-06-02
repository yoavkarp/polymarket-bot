import { kellyFraction } from './kelly.js';
import type { ClosedTradeRecord, WalletMetrics, Classification } from '../models/types.js';

const MIN_TRADES = 10;
const MIN_WIN_RATE = 0.5;
const MIN_EDGE = 0;
const MIN_KE = 0.05;
const MAX_KE = 2.0;
const SMART_SCORE_THRESHOLD = 0.6;
const NEUTRAL_SCORE_THRESHOLD = 0.4;

export function computeMetrics(
  address: string,
  userName: string | null,
  trades: ClosedTradeRecord[],
): WalletMetrics {
  const valid = trades.filter(
    (t) => t.avgPrice > 0 && t.avgPrice < 1 && t.totalBought > 0,
  );

  if (valid.length === 0) return zero(address, userName);

  const totalCapital = valid.reduce((s, t) => s + t.totalBought, 0);
  const winRate = valid.filter((t) => t.realizedPnl > 0).length / valid.length;
  const avgEdge = valid.reduce((s, t) => s + (t.curPrice - t.avgPrice), 0) / valid.length;

  // Kelly Efficiency: how close is the trader's actual sizing to the Kelly-optimal fraction?
  // actual_fraction is normalized relative to total capital deployed (proxy for portfolio allocation).
  const keValues: number[] = [];
  for (const t of valid) {
    const f = kellyFraction(t.curPrice, t.avgPrice);
    if (f <= 0) continue;
    keValues.push((t.totalBought / totalCapital) / f);
  }
  const kellyEfficiency =
    keValues.length > 0 ? keValues.reduce((s, v) => s + v, 0) / keValues.length : 0;

  const smartScore =
    0.4 * winRate +
    0.3 * Math.min(1, Math.max(0, avgEdge / 0.2)) +
    0.3 * Math.min(1, Math.max(0, kellyEfficiency));

  const classification = classify(smartScore, winRate, avgEdge, kellyEfficiency, valid.length);

  return { address, userName, tradeCount: valid.length, winRate, avgEdge, kellyEfficiency, smartScore, classification };
}

function classify(
  smartScore: number,
  winRate: number,
  avgEdge: number,
  ke: number,
  tradeCount: number,
): Classification {
  if (
    tradeCount >= MIN_TRADES &&
    winRate > MIN_WIN_RATE &&
    avgEdge > MIN_EDGE &&
    ke >= MIN_KE &&
    ke <= MAX_KE &&
    smartScore >= SMART_SCORE_THRESHOLD
  ) {
    return 'smart';
  }
  return smartScore >= NEUTRAL_SCORE_THRESHOLD ? 'neutral' : 'dumb';
}

function zero(address: string, userName: string | null): WalletMetrics {
  return { address, userName, tradeCount: 0, winRate: 0, avgEdge: 0, kellyEfficiency: 0, smartScore: 0, classification: 'dumb' };
}
