import 'dotenv/config';
import { discoverWallets } from './services/walletDiscovery.js';
import { analyzeWallet } from './services/walletAnalysis.js';
import { upsertWallet, getSmartWallets, pruneNonSmartWallets } from './db/walletStore.js';
import { createPaperTrader } from './services/paperTrader.js';
import { startCopyTrading } from './services/copyTrader.js';
import { getPublicClient } from './clients/polymarket.js';
import type { WalletMetrics } from './models/types.js';
import { sleep } from './utils/evaluation.js';

const KELLY_FRACTION = parseFloat(process.env.KELLY_FRACTION ?? '0.5');
const MAX_POSITION_FRAC = parseFloat(process.env.MAX_POSITION_FRAC ?? '0.1');
const TEST_BANKROLL_USD = parseFloat(process.env.TEST_BANKROLL_USD ?? '10000');
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

  const trader = createPaperTrader(TEST_BANKROLL_USD, KELLY_FRACTION, MAX_POSITION_FRAC);
  const client = getPublicClient();
  const trackedPositions = new Map<string, Set<string>>();

  await trader.resume();
  console.log(`\n[TEST] Paper trading — watching ${smartWallets.length} smart wallets.`);
  console.log(`[TEST] Bankroll: $${TEST_BANKROLL_USD} | Kelly fraction: ${KELLY_FRACTION} | Max position: ${(MAX_POSITION_FRAC * 100).toFixed(1)}% of bankroll`);
  console.log(`[TEST] Polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl+C to stop.\n`);

  let initialized = false;

  async function poll() {
    for (const wallet of smartWallets) {
      try {
        const currentIds = new Set<string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const page of client.listPositions({ user: wallet.address as any, pageSize: 50 })) {
          for (const pos of page.items) {
            const id = pos.conditionId;
            currentIds.add(id);
            // Only signal if wallet has been seen before (has a baseline) and this id is new
            const walletKnown = trackedPositions.has(wallet.address);
            const isNew = walletKnown && !trackedPositions.get(wallet.address)!.has(id);
            if (initialized && isNew) {
              await trader.onSignal(
                id,
                pos.tokenId ?? '',
                pos.title ?? id,
                pos.outcome ?? 'Yes',
                parseFloat((pos.avgPrice as string | null) ?? '0.5'),
                wallet.address,
                wallet.avgEdge,
              );
            }
          }
        }

        if (initialized) {
          const prev = trackedPositions.get(wallet.address);
          if (prev) {
            for (const id of prev) {
              if (!currentIds.has(id)) {
                await trader.onClose(id, 1.0);
              }
            }
          }
        }

        trackedPositions.set(wallet.address, currentIds);
      } catch {
        // Per-wallet errors are non-fatal
      }
    }

    if (!initialized) {
      initialized = true;
      const total = [...trackedPositions.values()].reduce((n, s) => n + s.size, 0);
      console.log(`[TEST] Baseline snapshot: ${total} pre-existing position(s) ignored. Watching for new entries.`);
    }

    const walletSummary = smartWallets
      .map((w) => `${w.address.slice(0, 10)}: ${trackedPositions.get(w.address)?.size ?? 0}`)
      .join(' | ');
    console.log(`[WALLETS] ${walletSummary}`);
  }

  async function refreshWallets() {
    console.log('\n[TEST] Daily refresh — re-running wallet analysis...');
    await runAnalyze();
    smartWallets = await getSmartWallets();
    console.log(`[TEST] Refresh complete — now watching ${smartWallets.length} smart wallet(s).`);
  }

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
  setInterval(refreshWallets, REFRESH_INTERVAL_MS);
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
