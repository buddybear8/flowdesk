-- Suggested-contract pricing on daily watches: static entry price + 15-min live mark
ALTER TABLE "hit_list_daily"
  ADD COLUMN "contract_occ" VARCHAR(24),
  ADD COLUMN "contract_entry_price" DECIMAL(12,4),
  ADD COLUMN "contract_last_price" DECIMAL(12,4),
  ADD COLUMN "contract_marked_at" TIMESTAMP(3);
