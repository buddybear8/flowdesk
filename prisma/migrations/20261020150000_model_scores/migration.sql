-- Shadow scores for the ML direction model (px-cand2-dir5, frozen 2026-10-20)
CREATE TABLE "model_scores" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "rank" INTEGER NOT NULL,
    "ticker" VARCHAR(10) NOT NULL,
    "model" VARCHAR(40) NOT NULL,
    "p_dir5" DECIMAL(8,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "model_scores_date_rank_model_key" ON "model_scores"("date", "rank", "model");
CREATE INDEX "model_scores_date_idx" ON "model_scores"("date" DESC);
