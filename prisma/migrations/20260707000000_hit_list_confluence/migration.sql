-- Confluence engine (v2) columns on hit_list_daily
ALTER TABLE "hit_list_daily" ADD COLUMN "signals" JSONB;
ALTER TABLE "hit_list_daily" ADD COLUMN "atr_targets" JSONB;

-- Top-10 list (was 20)
ALTER TABLE "watches_criteria" ALTER COLUMN "max_alerts" SET DEFAULT 10;
UPDATE "watches_criteria" SET "max_alerts" = 10 WHERE "max_alerts" = 20;
