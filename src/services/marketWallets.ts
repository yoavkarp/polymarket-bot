import { getPublicClient } from '../clients/polymarket.js';
import { collectPages } from '../utils/evaluation.js';
import type { WalletSeed } from '../models/types.js';

function extractTokenIds(market: unknown): string[] {
  const m = market as any;
  return [m?.outcomes?.yes?.tokenId, m?.outcomes?.no?.tokenId].filter((id): id is string => id != null);
}

export async function discoverWalletsFromMarket(url: string): Promise<{ seeds: WalletSeed[]; title: string }> {
  const client = getPublicClient();

  const slug = url.split('/').filter(Boolean).pop() ?? url;
  let title = url;
  let tokenIds: string[] = [];

  // Try market first, then event — by slug so any URL format works
  let resolved = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const market = await client.fetchMarket({ slug } as any);
    title = (market as any).question ?? (market as any).title ?? slug;
    tokenIds = extractTokenIds(market);
    resolved = true;
  } catch { /* not a market slug */ }

  if (!resolved) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = await client.fetchEvent({ slug } as any);
    title = (event as any).title ?? (event as any).name ?? slug;
    const markets: unknown[] = (event as any).markets ?? [];
    tokenIds = markets.flatMap(extractTokenIds);
  }

  if (tokenIds.length === 0) {
    throw new Error('No outcome tokens found for this URL.');
  }

  const seen = new Set<string>();
  const seeds: WalletSeed[] = [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const page of client.listTrades({ market: tokenIds as any, pageSize: 100 })) {
      for (const trade of page.items) {
        const wallet = (trade as any).wallet;
        if (wallet && !seen.has(wallet)) {
          seen.add(wallet);
          seeds.push({ address: wallet, userName: (trade as any).name ?? null });
        }
      }
    }
  } catch (err: any) {
    // API caps trade history at offset 3000 — stop gracefully
    if (!err?.message?.includes('max historical activity offset')) throw err;
    console.log(`(Trade history capped at API limit — ${seen.size} unique traders collected so far)`);
  }

  return { seeds, title };
}
