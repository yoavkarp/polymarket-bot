-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "userName" TEXT,
    "classification" TEXT NOT NULL,
    "smartScore" REAL NOT NULL,
    "kellyEfficiency" REAL NOT NULL,
    "winRate" REAL NOT NULL,
    "avgEdge" REAL NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdated" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "smartScore" REAL NOT NULL,
    "kellyEfficiency" REAL NOT NULL,
    "winRate" REAL NOT NULL,
    "avgEdge" REAL NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoreSnapshot_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet" ("address") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Wallet_classification_smartScore_idx" ON "Wallet"("classification", "smartScore");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_walletAddress_recordedAt_idx" ON "ScoreSnapshot"("walletAddress", "recordedAt");
