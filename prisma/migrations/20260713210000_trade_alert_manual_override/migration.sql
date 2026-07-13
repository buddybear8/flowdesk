-- Freeze manually-corrected trade alerts against the re-derive loop
ALTER TABLE "trade_alerts" ADD COLUMN "manual_override" BOOLEAN NOT NULL DEFAULT false;
