// rerank-darkpool.ts — recompute per-ticker dark-pool ranks.
//
// For a given ticker, ranks every dark_pool_prints row by notional
// (price × size) descending. The top 200 get rank 1..200; everything else
// gets rank = NULL. Done in a single SQL statement so concurrent UW polls
// for the same ticker don't see a half-ranked state.
//
// Called by:
//   • s3-darkpool-import after the Polygon corpus is loaded (per ticker).
//   • pollDarkPool after each insert (per ticker that received new rows),
//     so a new UW print that breaks into the top 200 immediately promotes
//     itself and demotes the prior 200th-place row to unranked.
//
// Returns the number of rows whose rank actually changed.

import { prisma } from "./prisma.js";

const TOP_N = 200;

export async function rerankDarkPool(ticker: string): Promise<number> {
  const result = await prisma.$executeRaw`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY (price::numeric * size) DESC, executed_at DESC) AS new_rank
      FROM dark_pool_prints
      WHERE ticker = ${ticker}
    )
    UPDATE dark_pool_prints d
    SET
      rank = CASE WHEN r.new_rank <= ${TOP_N} THEN r.new_rank::int ELSE NULL END,
      percentile = CASE
        WHEN r.new_rank <= ${TOP_N}
          THEN ROUND(((${TOP_N + 1} - r.new_rank)::numeric / 2), 2)
        ELSE NULL
      END
    FROM ranked r
    WHERE d.id = r.id
      AND (
        d.rank IS DISTINCT FROM (CASE WHEN r.new_rank <= ${TOP_N} THEN r.new_rank::int ELSE NULL END)
      )
  `;
  return result;
}
