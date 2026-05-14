-- CreateTable
CREATE TABLE "gex_heatmap_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "spot" DECIMAL(12,4) NOT NULL,
    "cells" JSONB NOT NULL,

    CONSTRAINT "gex_heatmap_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gex_heatmap_snapshots_ticker_captured_at_idx" ON "gex_heatmap_snapshots"("ticker", "captured_at" DESC);
