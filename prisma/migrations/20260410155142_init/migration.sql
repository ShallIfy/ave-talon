-- CreateTable
CREATE TABLE "Token" (
    "mint" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 9,
    "logoUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScannedAt" TIMESTAMP(3) NOT NULL,
    "devAddress" TEXT,
    "riskScore" INTEGER,
    "totalSupply" TEXT,
    "graduated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("mint")
);

-- CreateTable
CREATE TABLE "TokenSnapshot" (
    "id" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "mcapUsd" DOUBLE PRECISION NOT NULL,
    "volume1h" DOUBLE PRECISION,
    "volume24h" DOUBLE PRECISION,
    "liquidityUsd" DOUBLE PRECISION,
    "holderCount" INTEGER,
    "top10Ratio" DOUBLE PRECISION,
    "holdersGt10" INTEGER,
    "raw" JSONB NOT NULL,

    CONSTRAINT "TokenSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "patternId" INTEGER NOT NULL,
    "patternName" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB NOT NULL,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanResult" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB NOT NULL,

    CONSTRAINT "ScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "amountIn" DOUBLE PRECISION NOT NULL,
    "amountOut" DOUBLE PRECISION NOT NULL,
    "tokenInMint" TEXT NOT NULL,
    "tokenOutMint" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "txSignature" TEXT,
    "status" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "jupiterQuote" JSONB NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLog" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT,
    "phase" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Token_lastScannedAt_idx" ON "Token"("lastScannedAt");

-- CreateIndex
CREATE INDEX "Token_graduated_idx" ON "Token"("graduated");

-- CreateIndex
CREATE INDEX "TokenSnapshot_tokenMint_capturedAt_idx" ON "TokenSnapshot"("tokenMint", "capturedAt");

-- CreateIndex
CREATE INDEX "TokenSnapshot_capturedAt_idx" ON "TokenSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "Signal_tokenMint_detectedAt_idx" ON "Signal"("tokenMint", "detectedAt");

-- CreateIndex
CREATE INDEX "Signal_confidence_detectedAt_idx" ON "Signal"("confidence", "detectedAt");

-- CreateIndex
CREATE INDEX "Signal_patternId_detectedAt_idx" ON "Signal"("patternId", "detectedAt");

-- CreateIndex
CREATE INDEX "ScanResult_source_scannedAt_idx" ON "ScanResult"("source", "scannedAt");

-- CreateIndex
CREATE INDEX "ScanResult_tokenMint_idx" ON "ScanResult"("tokenMint");

-- CreateIndex
CREATE INDEX "Watchlist_owner_idx" ON "Watchlist"("owner");

-- CreateIndex
CREATE INDEX "WatchlistItem_tokenMint_idx" ON "WatchlistItem"("tokenMint");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_tokenMint_key" ON "WatchlistItem"("watchlistId", "tokenMint");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_txSignature_key" ON "Trade"("txSignature");

-- CreateIndex
CREATE INDEX "Trade_owner_proposedAt_idx" ON "Trade"("owner", "proposedAt");

-- CreateIndex
CREATE INDEX "Trade_tokenMint_idx" ON "Trade"("tokenMint");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- CreateIndex
CREATE INDEX "AgentLog_createdAt_idx" ON "AgentLog"("createdAt");

-- CreateIndex
CREATE INDEX "AgentLog_cycleId_idx" ON "AgentLog"("cycleId");

-- AddForeignKey
ALTER TABLE "TokenSnapshot" ADD CONSTRAINT "TokenSnapshot_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mint") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mint") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanResult" ADD CONSTRAINT "ScanResult_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mint") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mint") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_tokenMint_fkey" FOREIGN KEY ("tokenMint") REFERENCES "Token"("mint") ON DELETE CASCADE ON UPDATE CASCADE;
