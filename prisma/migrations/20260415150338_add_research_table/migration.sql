-- CreateTable
CREATE TABLE "Research" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "symbol" TEXT,
    "signalId" TEXT,
    "patternId" INTEGER,
    "patternName" TEXT,
    "action" TEXT,
    "score" DOUBLE PRECISION,
    "confidence" TEXT,
    "narrative" TEXT NOT NULL,
    "tweets" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'claude',
    "priceUsd" DOUBLE PRECISION,
    "mcapUsd" DOUBLE PRECISION,
    "reasoning" TEXT,
    "dimensions" JSONB,
    "holderCount" INTEGER,
    "telegramSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Research_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Research_mint_key" ON "Research"("mint");

-- CreateIndex
CREATE INDEX "Research_createdAt_idx" ON "Research"("createdAt");

-- AddForeignKey
ALTER TABLE "Research" ADD CONSTRAINT "Research_mint_fkey" FOREIGN KEY ("mint") REFERENCES "Token"("mint") ON DELETE CASCADE ON UPDATE CASCADE;
