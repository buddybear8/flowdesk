-- CreateTable
CREATE TABLE "candle_bars" (
    "id" BIGSERIAL NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "timeframe" VARCHAR(4) NOT NULL,
    "bar_time" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(12,4) NOT NULL,
    "high" DECIMAL(12,4) NOT NULL,
    "low" DECIMAL(12,4) NOT NULL,
    "close" DECIMAL(12,4) NOT NULL,
    "volume" BIGINT NOT NULL,

    CONSTRAINT "candle_bars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "candle_bars_ticker_timeframe_bar_time_key" ON "candle_bars"("ticker", "timeframe", "bar_time");
