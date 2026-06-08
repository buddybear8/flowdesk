-- CreateTable
CREATE TABLE "flow_sentiment_days" (
    "id" BIGSERIAL NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "trading_date" DATE NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "spot" DECIMAL(12,4) NOT NULL,
    "minutes" JSONB NOT NULL,

    CONSTRAINT "flow_sentiment_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flow_sentiment_days_ticker_trading_date_key" ON "flow_sentiment_days"("ticker", "trading_date");

-- CreateIndex
CREATE INDEX "flow_sentiment_days_ticker_trading_date_idx" ON "flow_sentiment_days"("ticker", "trading_date" DESC);
