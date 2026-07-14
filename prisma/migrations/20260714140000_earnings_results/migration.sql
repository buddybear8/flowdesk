-- Post-earnings reaction fields
ALTER TABLE "earnings_events"
  ADD COLUMN "post_earnings_close" DECIMAL(12,4),
  ADD COLUMN "reaction_pct" DECIMAL(10,6);
