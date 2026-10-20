// Frontend/API mirror of worker/src/lib/watched-tickers.ts WATCHED_TICKERS.
// If a ticker is added or removed there, update this set and the GEX
// dropdowns (GexView / GexHeatmapView / GexChartView) together.

export const WATCHED_GEX_TICKERS = new Set([
  "SPY", "SPX", "QQQ", "TSLA", "NVDA",
  "AMD", "META", "AMZN", "GOOGL", "NFLX", "MSFT", "AAPL",
  "MU", "DRAM", "SPCX",
  "ORCL", "MRVL", "BABA", "APP", "HOOD", "ASTS", "ENPH",
  "SOXX", "SMH", "NBIS", "SNOW", "PLTR", "NOW", "SNDK", "QCOM", "COIN",
  "INTC",
  "VIX", "GLD", "GDX", "SLV",
  "DELL", "SMCI", "IREN", "AVGO", "BE", "ARM", "CVNA", "DDOG",
  "PANW", "RDDT", "PDD", "CRWD", "VALE", "IWM", "DIA", "USO",
]);
