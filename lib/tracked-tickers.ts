// Auto-generated from worker/src/lib/ticker-thresholds.json.
// The 229 tickers we maintain a historical-block-trade corpus for.
// Source of truth for the dark-pool ticker filter — only these tickers
// have data in dark_pool_prints since the 2026-05-13 Polygon cutover.

export const TRACKED_TICKERS: readonly string[] = [
  "AA", "AAL", "AAPL", "ABBV", "ABNB", "ADBE", "AEO", "AFRM",
  "AI", "AMAT", "AMC", "AMD", "AMZN", "APP", "ARM", "ASML",
  "ASTS", "AVGO", "AXP", "BA", "BABA", "BAC", "BBD", "BIDU",
  "BLNK", "BMNR", "BMY", "BND", "BYND", "C", "CAR", "CAVA",
  "CCJ", "CCL", "CELH", "CHWY", "CIFR", "CLF", "CMCSA", "CMG",
  "COIN", "COST", "CRCL", "CRM", "CRWD", "CRWV", "CSCO", "CVNA",
  "CVS", "CVX", "DAL", "DDOG", "DELL", "DIA", "DIS", "DJT",
  "DKNG", "DUOL", "EBAY", "EEM", "ELF", "ENPH", "EOSE", "EPV",
  "ETSY", "EWY", "F", "FCX", "FSLR", "FUBO", "FXI", "GE",
  "GLD", "GM", "GME", "GOLD", "GOOGL", "GS", "HACK", "HIMS",
  "HOOD", "HPE", "HPQ", "IBIT", "IGV", "INTC", "IONQ", "IREN",
  "ITUB", "IVV", "IWM", "JD", "JPM", "KLAR", "KO", "KVUE",
  "KWEB", "LAC", "LCID", "LI", "LITE", "LLY", "LMND", "LMT",
  "LRCX", "LULU", "LYFT", "MARA", "MDB", "META", "MNDY", "MRK",
  "MRNA", "MRVL", "MS", "MSFT", "MSOS", "MSTR", "MU", "NBIS",
  "NEE", "NEM", "NFLX", "NIO", "NKE", "NMAX", "NOW", "NU",
  "NVAX", "NVDA", "NVDL", "NVDS", "NVO", "NVTS", "OKLO", "OKTA",
  "OPEN", "ORCL", "OSCR", "OXY", "PANW", "PATH", "PBR", "PDD",
  "PFE", "PINS", "PLTR", "PLUG", "PYPL", "QCOM", "QQQ", "RBLX",
  "RDDT", "RGTI", "RIOT", "RIVN", "RKT", "ROKU", "RTX", "RUN",
  "SBUX", "SCHW", "SE", "SEDG", "SHOP", "SLV", "SMCI", "SMH",
  "SNAP", "SNDK", "SNOW", "SOFI", "SOXL", "SOXS", "SOXX", "SPOT",
  "SPXS", "SPY", "SQQQ", "T", "TAN", "TDOC", "TEM", "TGT",
  "TLT", "TMDX", "TMF", "TSLA", "TSLL", "TSM", "TTD", "U",
  "UAL", "UBER", "UNH", "UPS", "UPST", "USAR", "UVXY", "VALE",
  "VKTX", "VOO", "VRT", "VST", "VXX", "VZ", "WBA", "WBD",
  "WFC", "WMT", "X", "XBI", "XLB", "XLC", "XLE", "XLF",
  "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY", "XOM",
  "XPEV", "XYZ", "YOLO", "ZETA", "ZM",
] as const;

export const TRACKED_TICKER_SET: Set<string> = new Set(TRACKED_TICKERS);
