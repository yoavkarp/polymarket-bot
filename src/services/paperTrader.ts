import { fractionalKelly } from '../analysis/kelly.js';
import { openPaperTrade, closePaperTrade, getPaperTradeSummary, getOpenPaperTrades } from '../db/paperStore.js';

interface VirtualPosition {
  conditionId: string;
  trackedWallet: string;
  title: string;
  tokenId: string;
  entryPrice: number;
  sizeUsd: number;
  kellyFrac: number;
  outcome: string;
}

export function createPaperTrader(
  bankrollUsd: number,
  kellyFrac: number,
  maxPositionFrac: number,
) {
  let bankroll = bankrollUsd;
  let totalDeployed = 0;
  const positions = new Map<string, VirtualPosition>();

  async function onSignal(
    conditionId: string,
    tokenId: string,
    title: string,
    outcome: string,
    entryPrice: number,
    trackedWallet: string,
    walletAvgEdge: number,
  ) {
    if (positions.has(conditionId)) return;

    const estimatedTrueProb = Math.min(0.99, Math.max(0.01, entryPrice + walletAvgEdge));
    const f = fractionalKelly(estimatedTrueProb, entryPrice, kellyFrac);
    if (f <= 0) return;

    const sizeUsd = Math.min(bankroll * f, bankroll * maxPositionFrac);
    if (sizeUsd < 1) return;

    bankroll -= sizeUsd;
    totalDeployed += sizeUsd;
    const pos: VirtualPosition = { conditionId, trackedWallet, title, tokenId, entryPrice, sizeUsd, kellyFrac: f, outcome };
    positions.set(conditionId, pos);

    await openPaperTrade({ conditionId, trackedWallet, title, outcome, tokenId, entryPrice, sizeUsd, kellyFrac: f });

    console.log(
      `[TEST] BUY  "${title.slice(0, 55)}" ${outcome} @ ${entryPrice.toFixed(3)}` +
      ` | $${sizeUsd.toFixed(2)} (f=${f.toFixed(3)}) | tracked: ${trackedWallet.slice(0, 10)}`,
    );
    await printStatus();
  }

  async function onClose(conditionId: string, exitPrice: number) {
    const pos = positions.get(conditionId);
    if (!pos) return;

    const pnl = pos.sizeUsd * (exitPrice / pos.entryPrice - 1);
    bankroll += pos.sizeUsd + pnl;
    positions.delete(conditionId);

    await closePaperTrade(conditionId, exitPrice, pnl);

    const sign = pnl >= 0 ? '+' : '';
    console.log(
      `[TEST] SELL "${pos.title.slice(0, 55)}" @ ${exitPrice.toFixed(3)}` +
      ` | ${sign}$${pnl.toFixed(2)}`,
    );
    await printStatus();
  }

  async function printStatus() {
    const summary = await getPaperTradeSummary();
    const pct = summary.totalDeployed > 0
      ? ((summary.totalPnl / summary.totalDeployed) * 100).toFixed(1)
      : '0.0';
    const wr = summary.count > 0 ? (summary.winRate * 100).toFixed(1) : '—';
    const sign = summary.totalPnl >= 0 ? '+' : '';
    console.log(
      `[TEST] Bankroll: $${bankroll.toFixed(2)}` +
      ` | Closed P&L: ${sign}$${summary.totalPnl.toFixed(2)} (${sign}${pct}%)` +
      ` | Win rate: ${wr}% (${summary.count} closed)` +
      ` | Open: ${positions.size}`,
    );
  }

  async function resume() {
    const open = await getOpenPaperTrades();
    for (const t of open) {
      positions.set(t.conditionId, {
        conditionId: t.conditionId,
        trackedWallet: t.trackedWallet,
        title: t.title,
        tokenId: t.tokenId,
        entryPrice: t.entryPrice,
        sizeUsd: t.sizeUsd,
        kellyFrac: t.kellyFrac,
        outcome: t.outcome,
      });
      bankroll -= t.sizeUsd;
    }
    if (open.length > 0) {
      console.log(`[TEST] Resumed ${open.length} open position(s) from previous session.`);
    }
  }

  return { onSignal, onClose, printStatus, resume };
}
