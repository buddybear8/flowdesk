-- Earnings Analyst module: upcoming-events + per-quarter history tables
CREATE TABLE "earnings_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "ticker" VARCHAR(10) NOT NULL,
  "report_date" DATE NOT NULL,
  "report_time" VARCHAR(12) NOT NULL,
  "full_name" TEXT,
  "sector" VARCHAR(40),
  "marketcap" DECIMAL(20,0),
  "is_sp500" BOOLEAN NOT NULL DEFAULT false,
  "eps_estimate" DECIMAL(12,4),
  "actual_eps" DECIMAL(12,4),
  "expected_move" DECIMAL(12,4),
  "expected_move_pct" DECIMAL(10,6),
  "pre_earnings_close" DECIMAL(12,4),
  "fiscal_quarter" VARCHAR(12),
  "avg_move_pct" DECIMAL(10,6),
  "beat_count" INTEGER,
  "quarter_count" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "earnings_events_ticker_report_date_key" ON "earnings_events"("ticker", "report_date");
CREATE INDEX "earnings_events_report_date_idx" ON "earnings_events"("report_date");

CREATE TABLE "earnings_history" (
  "id" BIGSERIAL PRIMARY KEY,
  "ticker" VARCHAR(10) NOT NULL,
  "report_date" DATE NOT NULL,
  "report_time" VARCHAR(12),
  "fiscal_quarter" VARCHAR(12),
  "eps_estimate" DECIMAL(12,4),
  "actual_eps" DECIMAL(12,4),
  "expected_move_pct" DECIMAL(10,6),
  "move_1d_pct" DECIMAL(10,6),
  "move_1w_pct" DECIMAL(10,6),
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "earnings_history_ticker_report_date_key" ON "earnings_history"("ticker", "report_date");
CREATE INDEX "earnings_history_ticker_idx" ON "earnings_history"("ticker");
