import 'dotenv/config';
import { discoverWalletsFromMarket } from '../services/marketWallets.js';
import { analyzeWallet } from '../services/walletAnalysis.js';
import { upsertWallet } from '../db/walletStore.js';
import type { WalletMetrics } from '../models/types.js';

const url = process.argv[2];

if (!url) {
  console.log('Usage: npm run market <polymarket-url>');
  console.log('Example: npm run market https://polymarket.com/sports/nhl/nhl-las-car-2026-06-02');
  process.exit(1);
}

async function main() {
  console.log(`Fetching traders from: ${url}\n`);
  const { seeds, title } = await discoverWalletsFromMarket(url);
  console.log(`Market: "${title}"`);
  console.log(`Found ${seeds.length} unique traders. Analyzing...\n`);

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
  console.log('\n');

  const byClass = { smart: 0, neutral: 0, dumb: 0 };
  results.forEach((r) => byClass[r.classification]++);
  console.log(`Scored ${results.length} traders — smart: ${byClass.smart}, neutral: ${byClass.neutral}, dumb: ${byClass.dumb}`);

  const smart = results
    .filter((r) => r.classification === 'smart')
    .sort((a, b) => b.smartScore - a.smartScore);

  if (smart.length === 0) {
    console.log('No smart wallets found among traders of this market.');
    return;
  }

  console.log(`\n=== Smart Wallets found (${smart.length}) — added to DB ===`);
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

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
