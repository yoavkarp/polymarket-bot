import express from 'express';
import type { Request, Response } from 'express';
import { getSmartWallets, getAllWallets, getWallet, getScoreHistory } from '../db/walletStore.js';
import { getPaperTradeHistory, getOpenPaperTrades, getPaperTradeSummary } from '../db/paperStore.js';
import { getConfig } from '../db/configStore.js';
import { botEvents } from './events.js';

const app = express();

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── REST ──────────────────────────────────────────────────────────────────────

app.get('/api/wallets', async (_req: Request, res: Response) => {
  const wallets = await getSmartWallets();
  res.json(wallets);
});

app.get('/api/wallets/all', async (_req: Request, res: Response) => {
  const wallets = await getAllWallets();
  res.json(wallets);
});

app.get('/api/wallets/:address', async (req: Request, res: Response) => {
  const { address } = req.params as { address: string };
  const wallet = await getWallet(address);
  if (!wallet) { res.status(404).json({ error: 'Not found' }); return; }
  const history = await getScoreHistory(address);
  res.json({ ...wallet, history });
});

app.get('/api/trades', async (req: Request, res: Response) => {
  const { status } = req.query;
  const all = await getPaperTradeHistory();
  const filtered = status ? all.filter((t) => t.status === status) : all;
  res.json(filtered);
});

app.get('/api/trades/open', async (_req: Request, res: Response) => {
  res.json(await getOpenPaperTrades());
});

app.get('/api/trades/summary', async (_req: Request, res: Response) => {
  res.json(await getPaperTradeSummary());
});

app.get('/api/config', async (_req: Request, res: Response) => {
  const lastRefreshAt = await getConfig('lastRefreshAt');
  res.json({ lastRefreshAt });
});

// ── SSE ───────────────────────────────────────────────────────────────────────

const clients = new Set<Response>();

app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.add(res);
  req.on('close', () => clients.delete(res));

  send(res, 'connected', { clients: clients.size });
});

function send(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event: string, data: unknown) {
  for (const client of clients) send(client, event, data);
}

botEvents.on('trade-opened', (p) => broadcast('trade-opened', p));
botEvents.on('trade-closed', (p) => broadcast('trade-closed', p));
botEvents.on('portfolio-updated', (p) => broadcast('portfolio-updated', p));
botEvents.on('wallets-updated', (p) => broadcast('wallets-updated', p));

// ── Start ─────────────────────────────────────────────────────────────────────

export function startApiServer(port: number) {
  app.listen(port, () => {
    console.log(`[API] Listening on http://localhost:${port}`);
    console.log(`[API] SSE stream: http://localhost:${port}/api/events`);
  });
}
