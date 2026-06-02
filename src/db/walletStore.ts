import { getPrisma } from './client.js';
import type { WalletMetrics } from '../models/types.js';

export async function upsertWallet(metrics: WalletMetrics) {
  const prisma = getPrisma();
  const scores = {
    classification: metrics.classification,
    smartScore: metrics.smartScore,
    kellyEfficiency: metrics.kellyEfficiency,
    winRate: metrics.winRate,
    avgEdge: metrics.avgEdge,
    tradeCount: metrics.tradeCount,
  };

  await prisma.wallet.upsert({
    where: { address: metrics.address },
    update: { userName: metrics.userName, ...scores },
    create: { address: metrics.address, userName: metrics.userName, ...scores },
  });

  const last = await prisma.scoreSnapshot.findFirst({
    where: { walletAddress: metrics.address },
    orderBy: { recordedAt: 'desc' },
  });

  const changed = !last || Math.abs(last.smartScore - metrics.smartScore) > 0.001;
  if (changed) {
    await prisma.scoreSnapshot.create({
      data: { walletAddress: metrics.address, ...scores },
    });
  }
}

export async function getSmartWallets() {
  return getPrisma().wallet.findMany({
    where: { classification: 'smart' },
    orderBy: { smartScore: 'desc' },
  });
}

export async function getAllWallets() {
  return getPrisma().wallet.findMany({ orderBy: { smartScore: 'desc' } });
}

export async function getWallet(address: string) {
  return getPrisma().wallet.findUnique({ where: { address } });
}

export async function pruneNonSmartWallets(): Promise<number> {
  const { count } = await getPrisma().wallet.deleteMany({
    where: { classification: { not: 'smart' } },
  });
  return count;
}

export async function getScoreHistory(address: string) {
  return getPrisma().scoreSnapshot.findMany({
    where: { walletAddress: address },
    orderBy: { recordedAt: 'desc' },
  });
}
