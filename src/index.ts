import 'dotenv/config';
import { discoverWallets } from './services/walletDiscovery.js';
import { analyzeWallet } from './services/walletAnalysis.js';
import { upsertWallet, getSmartWallets, pruneNonSmartWallets, deleteWallet } from './db/walletStore.js';
import { getConfig, setConfig } from './db/configStore.js';
import { getOpenPaperTrades, updateOpenTradePrices } from './db/paperStore.js';
import { createPaperTrader } from './services/paperTrader.js';
import { startCopyTrading } from './services/copyTrader.js';
import { startApiServer } from './api/server.js';
import { botEvents } from './api/events.js';
import { getPublicClient } from './clients/polymarket.js';
import type { WalletMetrics } from './models/types.js';
import { sleep } from './utils/evaluation.js';

const KELLY_FRACTION = parseFloat(process.env.KELLY_FRACTION ?? '0.5');
const MAX_TOTAL_EXPOSURE = parseFloat(process.env.MAX_TOTAL_EXPOSURE ?? '0.5');
const TEST_BANKROLL_USD = parseFloat(process.env.TEST_BANKROLL_USD ?? '10000');
const API_PORT = parseInt(process.env.API_PORT ?? '3000');
const PRICE_MATCH_TOLERANCE = parseFloat(process.env.PRICE_MATCH_TOLERANCE ?? '0.02');
const POLL_INTERVAL_MS = parseFloat(process.env.POLL_INTERVAL_S ?? '60') * 1000;
const REFRESH_INTERVAL_MS = parseFloat(process.env.REFRESH_INTERVAL_H ?? '24') * 60 * 60 * 1000;

const mode = process.argv.find((a) => a.startsWith('--'))?.slice(2) ?? 'analyze';

async function runAnalyze() {
  console.log('Discovering wallets from leaderboard (WEEK + MONTH + ALL)...');
  const seeds = await discoverWallets();
  console.log(`Found ${seeds.length} unique wallets. Analyzing...`);

  const results: WalletMetrics[] = [];
  for (const seed of seeds) {
    try {
      const metrics = await analyzeWallet(seed);
      if (metrics.classification === 'smart') {
        await upsertWallet(metrics);
      }
      results.push(metrics);
      process.stdout.write(metrics.classification === 'smart' ? 'S' : '.');
    } catch {
      process.stdout.write('x');
    }
  }

  const pruned = await pruneNonSmartWallets();
  console.log('\n');

  const byClass = { smart: 0, neutral: 0, dumb: 0 };
  results.forEach((r) => byClass[r.classification]++);
  console.log(
    `Scored ${results.length} wallets — smart: ${byClass.smart}, neutral: ${byClass.neutral}, dumb: ${byClass.dumb}` +
    (pruned > 0 ? ` | removed ${pruned} stale non-smart wallet(s)` : ''),
  );

  const smart = results
    .filter((r) => r.classification === 'smart')
    .sort((a, b) => b.smartScore - a.smartScore);

  if (smart.length === 0) {
    console.log('No smart wallets found in this leaderboard sample.');
    return;
  }

  await setConfig('lastRefreshAt', new Date().toISOString());
  botEvents.emit('wallets-updated', { smartCount: smart.length, totalScored: results.length });
  console.log(`\n=== Smart Wallets (${smart.length}) ===`);
  for (const w of smart) {
    const name = w.userName ? ` (${w.userName})` : '';
    console.log(
      `${w.address.slice(0, 10)}...${name}` +
      ` | score=${w.smartScore.toFixed(3)}` +
      ` | WR=${(w.winRate * 100).toFixed(1)}%` +
      ` | edge=${w.avgEdge.toFixed(3)}` +
      ` | KE=${w.kellyEfficiency.toFixed(3)}` +
      ` | trades=${w.tradeCount}`,
    );
  }
}

async function runTest() {
  let smartWallets = await getSmartWallets();
  if (smartWallets.length === 0) {
    console.log('No smart wallets in DB — running analysis first...');
    await runAnalyze();
    smartWallets = await getSmartWallets();
  }
  if (smartWallets.length === 0) {
    console.log('Still no smart wallets found. Try again later.');
    process.exit(1);
  }

  const trader = createPaperTrader(TEST_BANKROLL_USD, KELLY_FRACTION, MAX_TOTAL_EXPOSURE);
  const client = getPublicClient();
  // wallet address → (conditionId → last known curPrice)
  const trackedPositions = new Map<string, Map<string, number>>();

  startApiServer(API_PORT);
  await trader.resume();
  console.log(`\n[TEST] Paper trading — watching ${smartWallets.length} smart wallets.`);
  console.log(`[TEST] Portfolio: $${TEST_BANKROLL_USD} | Kelly: ${KELLY_FRACTION} | Max exposure: ${(MAX_TOTAL_EXPOSURE * 100).toFixed(0)}%`);
  console.log(`[TEST] Polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl+C to stop.\n`);

  let initialized = false;
  const failStrikes = new Map<string, number>();
  const MAX_STRIKES = 3;

  const WALLET_TIMEOUT_MS = 15_000;

  type PositionEntry = { id: string; tokenId: string; title: string; outcome: string; avgPrice: number; curPrice: number; totalBought: number };

  async function fetchPositions(address: string): Promise<PositionEntry[]> {
    const collect = async () => {
      const results: PositionEntry[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const page of client.listPositions({ user: address as any, pageSize: 50 })) {
        for (const pos of page.items) {
          results.push({
            id: pos.conditionId,
            tokenId: pos.tokenId ?? '',
            title: pos.title ?? pos.conditionId,
            outcome: pos.outcome ?? 'Yes',
            avgPrice: parseFloat((pos.avgPrice as string | null) ?? '0.5'),
            curPrice: parseFloat((pos.curPrice as string | null) ?? '0.5'),
            totalBought: parseFloat((pos.totalBought as string | null) ?? '0'),
          });
        }
      }
      return results;
    };

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), WALLET_TIMEOUT_MS),
    );

    return Promise.race([collect(), timeout]);
  }

  async function poll() {
    console.log(`[TEST] Polling ${smartWallets.length} wallet(s)...`);
    for (const wallet of smartWallets) {
      try {
        const allPositions = await fetchPositions(wallet.address);

        const totalDeployed = allPositions.reduce((s, p) => s + p.totalBought, 0);
        const currentMap = new Map(allPositions.map((p) => [p.id, p.curPrice]));
        const walletKnown = trackedPositions.has(wallet.address);
        const prev = trackedPositions.get(wallet.address);

        for (const p of allPositions) {
          const isNew = walletKnown && !prev!.has(p.id);
          const priceUnchanged = Math.abs(p.curPrice - p.avgPrice) <= PRICE_MATCH_TOLERANCE;
          const shouldSignal = initialized ? isNew : (!walletKnown && priceUnchanged);
          if (shouldSignal) {
            const walletFraction = totalDeployed > 0 ? p.totalBought / totalDeployed : 0;
            await trader.onSignal(p.id, p.tokenId, p.title, p.outcome, p.curPrice, wallet.address, walletFraction);
          }
        }

        if (initialized && prev) {
          for (const p of allPositions) {
            // Detect market resolution: curPrice hits 0 or 1 before the wallet redeems.
            // Require prev.has so we don't open and close on the same poll.
            if (prev.has(p.id) && (p.curPrice >= 0.99 || p.curPrice <= 0.01)) {
              await trader.onClose(p.id, p.curPrice);
              currentMap.delete(p.id);
            }
          }
          // Detect exit: position disappeared from smart wallet's live positions
          for (const [id, lastPrice] of prev) {
            if (!currentMap.has(id)) {
              await trader.onClose(id, lastPrice);
            }
          }
        }

        trackedPositions.set(wallet.address, currentMap);
        failStrikes.delete(wallet.address);
      } catch (err: unknown) {
        const strikes = (failStrikes.get(wallet.address) ?? 0) + 1;
        failStrikes.set(wallet.address, strikes);
        console.error(`[TEST] Error polling ${wallet.address.slice(0, 10)}: ${(err as Error).message ?? err} (strike ${strikes}/${MAX_STRIKES})`);

        if (strikes >= MAX_STRIKES) {
          console.warn(`[TEST] Removing ${wallet.address.slice(0, 10)} after ${MAX_STRIKES} consecutive failures.`);
          await deleteWallet(wallet.address).catch(() => {});
          smartWallets = smartWallets.filter((w) => w.address !== wallet.address);
          failStrikes.delete(wallet.address);
          trackedPositions.delete(wallet.address);
        }
      }
    }

    if (!initialized) {
      initialized = true;
      const total = [...trackedPositions.values()].reduce((n, m) => n + m.size, 0);
      console.log(`[TEST] Baseline snapshot: ${total} pre-existing position(s) scanned (price-matched ones copied, rest ignored).`);
    }

    const walletSummary = smartWallets
      .map((w) => `${w.address.slice(0, 10)}: ${trackedPositions.get(w.address)?.size ?? 0} positions`)
      .join(' | ');
    console.log(`[WALLETS] ${walletSummary}`);
  }

  async function refreshWallets() {
    console.log('\n[TEST] Wallet refresh — re-running analysis...');
    await runAnalyze();
    smartWallets = await getSmartWallets();
    console.log(`[TEST] Refresh complete — now watching ${smartWallets.length} smart wallet(s).`);
    setTimeout(refreshWallets, REFRESH_INTERVAL_MS);
  }

  async function scheduleRefresh() {
    const lastRefreshStr = await getConfig('lastRefreshAt');
    const msSinceLast = lastRefreshStr
      ? Date.now() - new Date(lastRefreshStr).getTime()
      : Infinity;
    const msUntilNext = Math.max(0, REFRESH_INTERVAL_MS - msSinceLast);

    if (msUntilNext === 0) {
      await refreshWallets();
    } else {
      const hoursLeft = (msUntilNext / 3_600_000).toFixed(1);
      console.log(`[TEST] Next wallet refresh in ${hoursLeft}h (last ran ${lastRefreshStr})`);
      setTimeout(refreshWallets, msUntilNext);
    }
  }

  async function refreshPrices() {
    const open = await getOpenPaperTrades();
    if (open.length === 0) return;

    // Group open trades by trackedWallet to minimise API calls
    const byWallet = new Map<string, string[]>();
    for (const t of open) {
      const ids = byWallet.get(t.trackedWallet) ?? [];
      ids.push(t.conditionId);
      byWallet.set(t.trackedWallet, ids);
    }

    const updates: { conditionId: string; currentPrice: number }[] = [];
    for (const [address, conditionIds] of byWallet) {
      try {
        const set = new Set(conditionIds);
        for await (const page of client.listPositions({ user: address as any, pageSize: 50 })) {
          for (const pos of page.items) {
            if (set.has(pos.conditionId)) {
              updates.push({
                conditionId: pos.conditionId,
                currentPrice: parseFloat((pos.curPrice as string | null) ?? '0'),
              });
            }
          }
        }
      } catch {
        // non-fatal — skip this wallet this tick
      }
    }

    await updateOpenTradePrices(updates);
    if (updates.length > 0) {
      console.log(`[PRICES] Updated current price for ${updates.length} open trade(s).`);
    }
  }

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
  setInterval(refreshPrices, POLL_INTERVAL_MS);
  await scheduleRefresh();
}

async function main() {
  if (mode === 'analyze') {
    await runAnalyze();
    process.exit(0);
  } else if (mode === 'test') {
    await runTest();
  } else if (mode === 'copy') {
    await startCopyTrading();
  } else {
    console.log('Usage: npm run dev -- --analyze | --test | --copy');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
