-- GEX node time-series for the GEX Chart tab
CREATE TABLE "gex_node_days" (
    "id" BIGSERIAL NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "trading_date" DATE NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "buckets" JSONB NOT NULL,

    CONSTRAINT "gex_node_days_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gex_node_days_ticker_trading_date_key" ON "gex_node_days"("ticker", "trading_date");
CREATE INDEX "gex_node_days_ticker_trading_date_idx" ON "gex_node_days"("ticker", "trading_date" DESC);
