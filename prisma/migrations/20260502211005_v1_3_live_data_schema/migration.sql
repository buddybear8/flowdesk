-- CreateTable
CREATE TABLE "flow_alerts" (
    "id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "type" VARCHAR(4) NOT NULL,
    "side" VARCHAR(4) NOT NULL,
    "sentiment" VARCHAR(8) NOT NULL,
    "exec" VARCHAR(8) NOT NULL,
    "multi_leg" BOOLEAN NOT NULL,
    "contract" TEXT NOT NULL,
    "strike" DECIMAL(12,4) NOT NULL,
    "expiry" DATE NOT NULL,
    "size" INTEGER NOT NULL,
    "oi" INTEGER NOT NULL,
    "premium" DECIMAL(16,2) NOT NULL,
    "spot" DECIMAL(12,4) NOT NULL,
    "rule" TEXT NOT NULL,
    "confidence" VARCHAR(4) NOT NULL,
    "sector" VARCHAR(32) NOT NULL,

    CONSTRAINT "flow_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gex_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "spot" DECIMAL(12,4) NOT NULL,
    "net_gex_oi" DECIMAL(20,2) NOT NULL,
    "net_gex_dv" DECIMAL(20,2) NOT NULL,
    "gamma_regime" VARCHAR(10) NOT NULL,
    "call_wall" DECIMAL(12,4) NOT NULL,
    "put_wall" DECIMAL(12,4) NOT NULL,
    "gamma_flip" DECIMAL(12,4) NOT NULL,
    "max_pain" DECIMAL(12,4) NOT NULL,
    "strikes" JSONB NOT NULL,

    CONSTRAINT "gex_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dark_pool_prints" (
    "id" BIGSERIAL NOT NULL,
    "uw_id" TEXT,
    "executed_at" TIMESTAMP(3) NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "price" DECIMAL(12,4) NOT NULL,
    "size" INTEGER NOT NULL,
    "premium" DECIMAL(16,2) NOT NULL,
    "volume" BIGINT,
    "exchange_id" INTEGER,
    "trf_id" INTEGER,
    "is_etf" BOOLEAN NOT NULL DEFAULT false,
    "is_extended" BOOLEAN NOT NULL DEFAULT false,
    "is_intraday" BOOLEAN NOT NULL DEFAULT true,
    "rank" INTEGER,
    "percentile" DECIMAL(5,2),

    CONSTRAINT "dark_pool_prints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_tide_bars" (
    "id" BIGSERIAL NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "spy_price" DECIMAL(12,4) NOT NULL,
    "net_call_premium" DECIMAL(20,2) NOT NULL,
    "net_put_premium" DECIMAL(20,2) NOT NULL,
    "volume" BIGINT NOT NULL,

    CONSTRAINT "market_tide_bars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "net_impact_daily" (
    "id" BIGSERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "net_premium" DECIMAL(16,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "net_impact_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticker_metadata" (
    "ticker" VARCHAR(10) NOT NULL,
    "sector" VARCHAR(32) NOT NULL,
    "name" TEXT,
    "is_etf" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticker_metadata_pkey" PRIMARY KEY ("ticker")
);

-- CreateTable
CREATE TABLE "watches_criteria" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "min_premium" INTEGER NOT NULL DEFAULT 700000,
    "conf_filter" TEXT NOT NULL DEFAULT 'HIGH_MED',
    "exec_types" TEXT[] DEFAULT ARRAY['SWEEP', 'FLOOR', 'BLOCK', 'SINGLE']::TEXT[],
    "max_alerts" INTEGER NOT NULL DEFAULT 20,
    "exclude_sectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "require_dp" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watches_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hit_list_daily" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "rank" INTEGER NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "price" DECIMAL(12,4) NOT NULL,
    "direction" VARCHAR(4) NOT NULL,
    "confidence" VARCHAR(4) NOT NULL,
    "premium" DECIMAL(16,2) NOT NULL,
    "contract" TEXT NOT NULL,
    "dp_conf" BOOLEAN NOT NULL,
    "dp_rank" INTEGER,
    "dp_age" TEXT,
    "dp_prem" DECIMAL(16,2),
    "thesis" TEXT NOT NULL,
    "sector" VARCHAR(32) NOT NULL,
    "actionability_score" DECIMAL(8,4) NOT NULL,
    "contracts" JSONB NOT NULL,
    "peers" JSONB NOT NULL,
    "theme" JSONB NOT NULL,

    CONSTRAINT "hit_list_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_summaries" (
    "id" BIGSERIAL NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "whop_membership_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "membership_checked_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "flow_alerts_captured_at_idx" ON "flow_alerts"("captured_at" DESC);

-- CreateIndex
CREATE INDEX "flow_alerts_ticker_captured_at_idx" ON "flow_alerts"("ticker", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "gex_snapshots_ticker_captured_at_idx" ON "gex_snapshots"("ticker", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "dark_pool_prints_uw_id_key" ON "dark_pool_prints"("uw_id");

-- CreateIndex
CREATE INDEX "dark_pool_prints_ticker_executed_at_idx" ON "dark_pool_prints"("ticker", "executed_at" DESC);

-- CreateIndex
CREATE INDEX "dark_pool_prints_rank_idx" ON "dark_pool_prints"("rank");

-- CreateIndex
CREATE INDEX "dark_pool_prints_is_intraday_executed_at_idx" ON "dark_pool_prints"("is_intraday", "executed_at" DESC);

-- CreateIndex
CREATE INDEX "market_tide_bars_bucket_start_idx" ON "market_tide_bars"("bucket_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "market_tide_bars_bucket_start_key" ON "market_tide_bars"("bucket_start");

-- CreateIndex
CREATE INDEX "net_impact_daily_snapshot_date_net_premium_idx" ON "net_impact_daily"("snapshot_date", "net_premium" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "net_impact_daily_snapshot_date_ticker_key" ON "net_impact_daily"("snapshot_date", "ticker");

-- CreateIndex
CREATE INDEX "hit_list_daily_date_idx" ON "hit_list_daily"("date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "hit_list_daily_date_rank_key" ON "hit_list_daily"("date", "rank");

-- CreateIndex
CREATE INDEX "ai_summaries_kind_generated_at_idx" ON "ai_summaries"("kind", "generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "users_whop_membership_id_key" ON "users"("whop_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
