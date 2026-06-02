import { getPrisma } from './client.js';

export async function openPaperTrade(data: {
  conditionId: string;
  trackedWallet: string;
  title: string;
  outcome: string;
  tokenId: string;
  entryPrice: number;
  sizeUsd: number;
  kellyFrac: number;
}) {
  return getPrisma().paperTrade.create({
    data: { ...data, status: 'open' },
  });
}

export async function closePaperTrade(conditionId: string, exitPrice: number, pnl: number) {
  return getPrisma().paperTrade.updateMany({
    where: { conditionId, status: 'open' },
    data: { status: 'closed', exitPrice, pnl, closedAt: new Date() },
  });
}

export async function getOpenPaperTrades() {
  return getPrisma().paperTrade.findMany({
    where: { status: 'open' },
    orderBy: { openedAt: 'desc' },
  });
}

export async function getPaperTradeHistory() {
  return getPrisma().paperTrade.findMany({
    orderBy: { openedAt: 'desc' },
  });
}

export async function getPaperTradeSummary() {
  const trades = await getPrisma().paperTrade.findMany({ where: { status: 'closed' } });
  if (trades.length === 0) return { count: 0, totalPnl: 0, winRate: 0, totalDeployed: 0 };
  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
  const totalDeployed = trades.reduce((s, t) => s + t.sizeUsd, 0);
  return { count: trades.length, totalPnl, winRate: wins / trades.length, totalDeployed };
}
