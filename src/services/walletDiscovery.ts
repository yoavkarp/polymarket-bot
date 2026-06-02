import { getPublicClient } from '../clients/polymarket.js';
import { collectPages } from '../utils/evaluation.js';
import type { WalletSeed } from '../models/types.js';

const TIME_PERIODS = ['WEEK', 'MONTH', 'ALL'] as const;

export async function discoverWallets(): Promise<WalletSeed[]> {
  const client = getPublicClient();

  const results = await Promise.all(
    TIME_PERIODS.map((period) =>
      collectPages(client.listTraderLeaderboard({ timePeriod: period, orderBy: 'PNL', pageSize: 100 })),
    ),
  );

  const seen = new Set<string>();
  const seeds: WalletSeed[] = [];
  for (const entries of results) {
    for (const e of entries) {
      if (e.wallet != null && !seen.has(e.wallet)) {
        seen.add(e.wallet);
        seeds.push({ address: e.wallet, userName: e.userName ?? null });
      }
    }
  }

  return seeds;
}
