import { fetchClosedTrades } from './tradeHistory.js';
import { computeMetrics } from '../analysis/kellyEfficiency.js';
import type { WalletMetrics, WalletSeed } from '../models/types.js';

export async function analyzeWallet(seed: WalletSeed): Promise<WalletMetrics> {
  const trades = await fetchClosedTrades(seed.address);
  return computeMetrics(seed.address, seed.userName, trades);
}
