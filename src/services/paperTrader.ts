import { openPaperTrade, closePaperTrade, getPaperTradeSummary, getOpenPaperTrades } from '../db/paperStore.js';
import { botEvents } from '../api/events.js';

interface VirtualPosition {
  conditionId: string;
  trackedWallet: string;
  title: string;
  tokenId: string;
  entryPrice: number;
  sizeUsd: number;
  fraction: number;
  outcome: string;
}

export function createPaperTrader(bankrollUsd: number, kellyFrac: number, maxTotalExposure: number) {
  // portfolioValue = true wealth, updated only on realized P&L (not on entry)
  let portfolioValue = bankrollUsd;
  let totalDeployed = 0;
  const positions = new Map<string, VirtualPosition>();

  async function onSignal(
    conditionId: string,
    tokenId: string,
    title: string,
    outcome: string,
    entryPrice: number,
    trackedWallet: string,
    walletFraction: number,
  ) {
    if (positions.has(conditionId)) return;
    if (walletFraction <= 0 || portfolioValue < 1) return;

    const sizeUsd = portfolioValue * walletFraction * kellyFrac;
    if (sizeUsd < 1) return;

    // Don't exceed max total exposure
    if (totalDeployed + sizeUsd > portfolioValue * maxTotalExposure) return;

    totalDeployed += sizeUsd;
    const pos: VirtualPosition = { conditionId, trackedWallet, title, tokenId, entryPrice, sizeUsd, fraction: walletFraction, outcome };
    positions.set(conditionId, pos);

    await openPaperTrade({ conditionId, trackedWallet, title, outcome, tokenId, entryPrice, sizeUsd, kellyFrac: walletFraction });

    const exposurePct = (totalDeployed / portfolioValue) * 100;
    console.log(
      `[TEST] BUY  "${title.slice(0, 55)}" ${outcome} @ ${entryPrice.toFixed(3)}` +
      ` | $${sizeUsd.toFixed(2)} (wallet ${(walletFraction * 100).toFixed(1)}% × Kelly ${kellyFrac})` +
      ` | exposure ${exposurePct.toFixed(1)}% | tracked: ${trackedWallet.slice(0, 10)}`,
    );
    botEvents.emit('trade-opened', { conditionId, title, outcome, entryPrice, sizeUsd, walletFraction, trackedWallet, exposurePct });
    await printStatus();
  }

  async function onClose(conditionId: string, exitPrice: number) {
    const pos = positions.get(conditionId);
    if (!pos) return;

    const pnl = pos.sizeUsd * (exitPrice / pos.entryPrice - 1);
    // Only here do we update true portfolio value
    portfolioValue += pnl;
    totalDeployed -= pos.sizeUsd;
    positions.delete(conditionId);

    await closePaperTrade(conditionId, exitPrice, pnl);

    const sign = pnl >= 0 ? '+' : '';
    console.log(
      `[TEST] SELL "${pos.title.slice(0, 55)}" @ ${exitPrice.toFixed(3)}` +
      ` | ${sign}$${pnl.toFixed(2)}`,
    );
    botEvents.emit('trade-closed', { conditionId, title: pos.title, exitPrice, pnl });
    await printStatus();
  }

  async function printStatus() {
    const summary = await getPaperTradeSummary();
    const exposurePct = (totalDeployed / portfolioValue) * 100;
    const wr = summary.count > 0 ? (summary.winRate * 100).toFixed(1) : '—';
    const sign = summary.totalPnl >= 0 ? '+' : '';
    console.log(
      `[TEST] Portfolio: $${portfolioValue.toFixed(2)}` +
      ` | Deployed: $${totalDeployed.toFixed(2)} (${exposurePct.toFixed(1)}%)` +
      ` | Closed P&L: ${sign}$${summary.totalPnl.toFixed(2)}` +
      ` | Win rate: ${wr}% (${summary.count} closed)` +
      ` | Open: ${positions.size}`,
    );
    botEvents.emit('portfolio-updated', {
      portfolioValue,
      totalDeployed,
      exposurePct,
      openPositions: positions.size,
      totalPnl: summary.totalPnl,
      winRate: summary.winRate,
      closedCount: summary.count,
    });
  }

  async function resume() {
    const [open, summary] = await Promise.all([getOpenPaperTrades(), getPaperTradeSummary()]);

    // Reconstruct true portfolio value: initial bankroll + all realized P&L so far
    portfolioValue = bankrollUsd + summary.totalPnl;

    // Reconstruct total deployed from open positions
    totalDeployed = open.reduce((s, t) => s + t.sizeUsd, 0);

    for (const t of open) {
      positions.set(t.conditionId, {
        conditionId: t.conditionId,
        trackedWallet: t.trackedWallet,
        title: t.title,
        tokenId: t.tokenId,
        entryPrice: t.entryPrice,
        sizeUsd: t.sizeUsd,
        fraction: t.kellyFrac,
        outcome: t.outcome,
      });
    }

    if (open.length > 0) {
      console.log(`[TEST] Resumed ${open.length} open position(s) | Portfolio: $${portfolioValue.toFixed(2)} | Deployed: $${totalDeployed.toFixed(2)}`);
    }
  }

  return { onSignal, onClose, printStatus, resume };
}
