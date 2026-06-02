import { getPublicClient } from '../clients/polymarket.js';
import { collectPages } from '../utils/evaluation.js';
import type { ClosedTradeRecord } from '../models/types.js';

export async function fetchClosedTrades(address: string): Promise<ClosedTradeRecord[]> {
  const client = getPublicClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions = await collectPages(
    client.listClosedPositions({ user: address as any, pageSize: 100 }),
  );
  return positions
    .filter((p) => p.avgPrice != null && p.curPrice != null && p.totalBought != null)
    .map((p) => ({
      conditionId: p.conditionId ?? '',
      tokenId: p.tokenId ?? null,
      outcome: p.outcome ?? null,
      avgPrice: parseFloat(p.avgPrice as string),
      curPrice: parseFloat(p.curPrice as string),
      totalBought: parseFloat(p.totalBought as string),
      realizedPnl: parseFloat((p.realizedPnl as string) ?? '0'),
      timestamp: p.timestamp ?? null,
      title: p.title ?? null,
    }));
}
