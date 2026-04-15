-- AlterTable
ALTER TABLE "Signal" ADD COLUMN     "cycleId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "SignalSnapshot" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "dimHolderGrowth" DOUBLE PRECISION NOT NULL,
    "dimTop10Delta" DOUBLE PRECISION NOT NULL,
    "dimRealMoney" DOUBLE PRECISION NOT NULL,
    "dimVolumeMultiple" DOUBLE PRECISION NOT NULL,
    "dimPriceChange" DOUBLE PRECISION NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "mcapUsd" DOUBLE PRECISION,
    "holderCount" INTEGER,
    "top10Ratio" DOUBLE PRECISION,
    "holdersGt10" INTEGER,
    "priceAt1h" DOUBLE PRECISION,
    "priceAt4h" DOUBLE PRECISION,
    "priceAt24h" DOUBLE PRECISION,
    "mcapAt1h" DOUBLE PRECISION,
    "mcapAt4h" DOUBLE PRECISION,
    "mcapAt24h" DOUBLE PRECISION,
    "outcomeScore" DOUBLE PRECISION,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignalSnapshot_signalId_key" ON "SignalSnapshot"("signalId");

-- CreateIndex
CREATE INDEX "SignalSnapshot_createdAt_idx" ON "SignalSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "Signal_source_detectedAt_idx" ON "Signal"("source", "detectedAt");

-- AddForeignKey
ALTER TABLE "SignalSnapshot" ADD CONSTRAINT "SignalSnapshot_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
