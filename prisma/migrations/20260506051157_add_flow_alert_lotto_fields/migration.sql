-- v1.3: capture additional UW flow-alert fields needed by the Lottos /
-- Opening Sweepers preset views. All columns are nullable so existing rows
-- backfill as NULL and the migration is non-destructive.

-- AlterTable
ALTER TABLE "flow_alerts" ADD COLUMN     "ask_prem"       DECIMAL(16,2);
ALTER TABLE "flow_alerts" ADD COLUMN     "bid_prem"       DECIMAL(16,2);
ALTER TABLE "flow_alerts" ADD COLUMN     "all_opening"    BOOLEAN;
ALTER TABLE "flow_alerts" ADD COLUMN     "issue_type"     VARCHAR(32);
ALTER TABLE "flow_alerts" ADD COLUMN     "has_floor"      BOOLEAN;
ALTER TABLE "flow_alerts" ADD COLUMN     "has_single_leg" BOOLEAN;
