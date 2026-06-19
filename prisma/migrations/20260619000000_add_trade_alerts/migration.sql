-- CreateTable
CREATE TABLE "trade_alerts" (
    "id" BIGSERIAL NOT NULL,
    "open_message_id" TEXT NOT NULL,
    "asset_type" VARCHAR(8) NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "side" VARCHAR(4) NOT NULL,
    "strike" DECIMAL(12,4),
    "expiry" DATE,
    "expiry_label" TEXT,
    "occ" TEXT,
    "moderator" VARCHAR(32) NOT NULL,
    "size_label" VARCHAR(8) NOT NULL,
    "entry_price" DECIMAL(12,4) NOT NULL,
    "entry_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "remaining_frac" DECIMAL(6,4) NOT NULL,
    "realized_pct" DECIMAL(12,4) NOT NULL,
    "events" JSONB NOT NULL,
    "last_mark" DECIMAL(12,4),
    "marked_at" TIMESTAMP(3),
    "live_pct" DECIMAL(12,4),
    "book_delta" DECIMAL(12,6) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_alerts_open_message_id_key" ON "trade_alerts"("open_message_id");

-- CreateIndex
CREATE INDEX "trade_alerts_asset_type_status_entry_at_idx" ON "trade_alerts"("asset_type", "status", "entry_at" DESC);
