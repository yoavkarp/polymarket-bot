export type Classification = 'smart' | 'neutral' | 'dumb';

export interface ClosedTradeRecord {
  conditionId: string;
  tokenId: string | null;
  outcome: string | null;
  avgPrice: number;
  curPrice: number;
  totalBought: number;
  realizedPnl: number;
  timestamp: number | null;
  title: string | null;
}

export interface WalletMetrics {
  address: string;
  userName: string | null;
  tradeCount: number;
  winRate: number;
  avgEdge: number;
  kellyEfficiency: number;
  smartScore: number;
  classification: Classification;
}

export interface WalletSeed {
  address: string;
  userName: string | null;
}
