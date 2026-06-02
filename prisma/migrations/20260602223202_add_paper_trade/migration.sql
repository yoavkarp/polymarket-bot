-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conditionId" TEXT NOT NULL,
    "trackedWallet" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "entryPrice" REAL NOT NULL,
    "sizeUsd" REAL NOT NULL,
    "kellyFrac" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "exitPrice" REAL,
    "pnl" REAL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "PaperTrade_status_idx" ON "PaperTrade"("status");

-- CreateIndex
CREATE INDEX "PaperTrade_trackedWallet_idx" ON "PaperTrade"("trackedWallet");
