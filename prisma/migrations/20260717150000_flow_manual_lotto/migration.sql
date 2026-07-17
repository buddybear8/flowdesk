-- One-off Lotto appends: rows tagged with an ET date surface in the Lottos view that day
ALTER TABLE "flow_alerts" ADD COLUMN "manual_lotto_date" DATE;
