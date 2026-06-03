import { EventEmitter } from 'events';

export interface TradeOpenedPayload {
  conditionId: string;
  title: string;
  outcome: string;
  entryPrice: number;
  sizeUsd: number;
  walletFraction: number;
  trackedWallet: string;
  exposurePct: number;
}

export interface TradeClosedPayload {
  conditionId: string;
  title: string;
  exitPrice: number;
  pnl: number;
}

export interface PortfolioUpdatedPayload {
  portfolioValue: number;
  totalDeployed: number;
  exposurePct: number;
  openPositions: number;
  totalPnl: number;
  winRate: number;
  closedCount: number;
}

export interface WalletsUpdatedPayload {
  smartCount: number;
  totalScored: number;
}

export type BotEventMap = {
  'trade-opened': TradeOpenedPayload;
  'trade-closed': TradeClosedPayload;
  'portfolio-updated': PortfolioUpdatedPayload;
  'wallets-updated': WalletsUpdatedPayload;
};

class BotEventEmitter extends EventEmitter {
  emit<K extends keyof BotEventMap>(event: K, payload: BotEventMap[K]): boolean {
    return super.emit(event, payload);
  }
  on<K extends keyof BotEventMap>(event: K, listener: (payload: BotEventMap[K]) => void): this {
    return super.on(event, listener);
  }
}

export const botEvents = new BotEventEmitter();
