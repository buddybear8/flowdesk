// Static overrides for tickers UW's classification can't or won't supply.
// Two purposes:
//   (a) ETFs UW returns `sector: null` for (SPY, GLD, TLT, UVXY, ...) —
//       map to one of the 4 ETF asset classes (Index/Commodities/Bonds/Volatility).
//   (b) Sector SPDRs (XLK, XLF, ...) — pin to the underlying sector exposure
//       so they group sensibly on the dashboard.
//
// Used by jobs/refresh-ticker-metadata.ts. Overrides ALWAYS win against
// UW-derived data — an entry here is a final answer.
//
// `Sector` mirrors the union in lib/types/index.ts (15 values: 11 GICS +
// 4 ETF asset classes, locked v1.2.2 / PRD §18). Duplicated here because
// the worker package is not wired to import from the repo-root lib/. If the
// union changes in lib/types/index.ts, update this list too.

export type Sector =
  | "Technology"
  | "Communication"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Energy"
  | "Financials"
  | "Health Care"
  | "Industrials"
  | "Materials"
  | "Real Estate"
  | "Utilities"
  | "Index"
  | "Commodities"
  | "Bonds"
  | "Volatility";

export interface SectorOverride {
  sector: Sector;
  isEtf: boolean;
  name?: string;
}

export const SECTOR_OVERRIDES: Record<string, SectorOverride> = {
  // ─── Broad-market index ETFs ─────────────────────────────────────────────
  SPY:  { sector: "Index", isEtf: true,  name: "SPDR S&P 500 ETF" },
  QQQ:  { sector: "Index", isEtf: true,  name: "Invesco QQQ Trust" },
  IWM:  { sector: "Index", isEtf: true,  name: "iShares Russell 2000 ETF" },
  DIA:  { sector: "Index", isEtf: true,  name: "SPDR Dow Jones Industrial Average ETF" },
  VTI:  { sector: "Index", isEtf: true,  name: "Vanguard Total Stock Market ETF" },
  VOO:  { sector: "Index", isEtf: true,  name: "Vanguard S&P 500 ETF" },
  IVV:  { sector: "Index", isEtf: true,  name: "iShares Core S&P 500 ETF" },
  SPLG: { sector: "Index", isEtf: true,  name: "SPDR Portfolio S&P 500 ETF" },
  MDY:  { sector: "Index", isEtf: true,  name: "SPDR S&P MidCap 400 ETF" },
  VTV:  { sector: "Index", isEtf: true,  name: "Vanguard Value ETF" },
  VUG:  { sector: "Index", isEtf: true,  name: "Vanguard Growth ETF" },
  EFA:  { sector: "Index", isEtf: true,  name: "iShares MSCI EAFE ETF" },
  EEM:  { sector: "Index", isEtf: true,  name: "iShares MSCI Emerging Markets ETF" },

  // ─── Cash-settled indices (NOT ETFs) ─────────────────────────────────────
  SPX:  { sector: "Index",      isEtf: false, name: "S&P 500 Index" },
  NDX:  { sector: "Index",      isEtf: false, name: "Nasdaq-100 Index" },
  RUT:  { sector: "Index",      isEtf: false, name: "Russell 2000 Index" },
  VIX:  { sector: "Volatility", isEtf: false, name: "CBOE Volatility Index" },

  // ─── Volatility ETFs / ETNs ──────────────────────────────────────────────
  UVXY: { sector: "Volatility", isEtf: true, name: "ProShares Ultra VIX Short-Term Futures ETF" },
  VXX:  { sector: "Volatility", isEtf: true, name: "iPath S&P 500 VIX Short-Term Futures ETN" },
  VIXY: { sector: "Volatility", isEtf: true, name: "ProShares VIX Short-Term Futures ETF" },
  SVXY: { sector: "Volatility", isEtf: true, name: "ProShares Short VIX Short-Term Futures ETF" },

  // ─── Bond ETFs ───────────────────────────────────────────────────────────
  TLT:  { sector: "Bonds", isEtf: true, name: "iShares 20+ Year Treasury Bond ETF" },
  IEF:  { sector: "Bonds", isEtf: true, name: "iShares 7-10 Year Treasury Bond ETF" },
  SHY:  { sector: "Bonds", isEtf: true, name: "iShares 1-3 Year Treasury Bond ETF" },
  HYG:  { sector: "Bonds", isEtf: true, name: "iShares iBoxx High Yield Corporate Bond ETF" },
  LQD:  { sector: "Bonds", isEtf: true, name: "iShares iBoxx Investment Grade Corporate Bond ETF" },
  AGG:  { sector: "Bonds", isEtf: true, name: "iShares Core U.S. Aggregate Bond ETF" },
  BND:  { sector: "Bonds", isEtf: true, name: "Vanguard Total Bond Market ETF" },
  TIP:  { sector: "Bonds", isEtf: true, name: "iShares TIPS Bond ETF" },
  MUB:  { sector: "Bonds", isEtf: true, name: "iShares National Muni Bond ETF" },
  JNK:  { sector: "Bonds", isEtf: true, name: "SPDR Bloomberg High Yield Bond ETF" },

  // ─── Commodity ETFs ──────────────────────────────────────────────────────
  GLD:  { sector: "Commodities", isEtf: true, name: "SPDR Gold Shares" },
  IAU:  { sector: "Commodities", isEtf: true, name: "iShares Gold Trust" },
  SLV:  { sector: "Commodities", isEtf: true, name: "iShares Silver Trust" },
  USO:  { sector: "Commodities", isEtf: true, name: "United States Oil Fund" },
  UNG:  { sector: "Commodities", isEtf: true, name: "United States Natural Gas Fund" },
  DBA:  { sector: "Commodities", isEtf: true, name: "Invesco DB Agriculture Fund" },
  PDBC: { sector: "Commodities", isEtf: true, name: "Invesco Optimum Yield Diversified Commodity Strategy" },
  GDX:  { sector: "Commodities", isEtf: true, name: "VanEck Gold Miners ETF" },
  GDXJ: { sector: "Commodities", isEtf: true, name: "VanEck Junior Gold Miners ETF" },

  // ─── Sector SPDRs (map to underlying sector) ─────────────────────────────
  XLK:  { sector: "Technology",             isEtf: true, name: "Technology Select Sector SPDR" },
  XLF:  { sector: "Financials",             isEtf: true, name: "Financial Select Sector SPDR" },
  XLE:  { sector: "Energy",                 isEtf: true, name: "Energy Select Sector SPDR" },
  XLV:  { sector: "Health Care",            isEtf: true, name: "Health Care Select Sector SPDR" },
  XLI:  { sector: "Industrials",            isEtf: true, name: "Industrial Select Sector SPDR" },
  XLY:  { sector: "Consumer Discretionary", isEtf: true, name: "Consumer Discretionary Select Sector SPDR" },
  XLP:  { sector: "Consumer Staples",       isEtf: true, name: "Consumer Staples Select Sector SPDR" },
  XLB:  { sector: "Materials",              isEtf: true, name: "Materials Select Sector SPDR" },
  XLRE: { sector: "Real Estate",            isEtf: true, name: "Real Estate Select Sector SPDR" },
  XLU:  { sector: "Utilities",              isEtf: true, name: "Utilities Select Sector SPDR" },
  XLC:  { sector: "Communication",          isEtf: true, name: "Communication Services Select Sector SPDR" },

  // ─── Themed / single-ticker leveraged ETFs ───────────────────────────────
  HACK: { sector: "Technology",             isEtf: true, name: "ETFMG Prime Cyber Security ETF" },
  IGV:  { sector: "Technology",             isEtf: true, name: "iShares Expanded Tech-Software ETF" },
  SMH:  { sector: "Technology",             isEtf: true, name: "VanEck Semiconductor ETF" },
  SOXX: { sector: "Technology",             isEtf: true, name: "iShares Semiconductor ETF" },
  SOXL: { sector: "Technology",             isEtf: true, name: "Direxion Daily Semiconductor Bull 3X" },
  SOXS: { sector: "Technology",             isEtf: true, name: "Direxion Daily Semiconductor Bear 3X" },
  TAN:  { sector: "Technology",             isEtf: true, name: "Invesco Solar ETF" },
  NVDL: { sector: "Technology",             isEtf: true, name: "GraniteShares 2x Long NVDA Daily ETF" },
  NVDS: { sector: "Technology",             isEtf: true, name: "Tradr 2X Short NVDA Daily ETF" },
  TSLL: { sector: "Consumer Discretionary", isEtf: true, name: "Direxion Daily TSLA Bull 2X" },
  KWEB: { sector: "Communication",          isEtf: true, name: "KraneShares CSI China Internet ETF" },
  XBI:  { sector: "Health Care",            isEtf: true, name: "SPDR S&P Biotech ETF" },
  MSOS: { sector: "Health Care",            isEtf: true, name: "AdvisorShares Pure US Cannabis ETF" },
  YOLO: { sector: "Health Care",            isEtf: true, name: "AdvisorShares Pure Cannabis ETF" },
  EWY:  { sector: "Index",                  isEtf: true, name: "iShares MSCI South Korea ETF" },
  FXI:  { sector: "Index",                  isEtf: true, name: "iShares China Large-Cap ETF" },
  EPV:  { sector: "Index",                  isEtf: true, name: "ProShares UltraShort FTSE Europe" },
  SPXS: { sector: "Index",                  isEtf: true, name: "Direxion Daily S&P 500 Bear 3X" },
  SQQQ: { sector: "Index",                  isEtf: true, name: "ProShares UltraPro Short QQQ" },
  TMF:  { sector: "Bonds",                  isEtf: true, name: "Direxion Daily 20+ Year Treasury Bull 3X" },
  IBIT: { sector: "Commodities",            isEtf: true, name: "iShares Bitcoin Trust ETF" },

  // ─── Individual equities (covers the 229 tracked-ticker universe) ────────
  // Technology
  AAPL: { sector: "Technology", isEtf: false, name: "Apple" },
  ADBE: { sector: "Technology", isEtf: false, name: "Adobe" },
  AI:   { sector: "Technology", isEtf: false, name: "C3.ai" },
  AMAT: { sector: "Technology", isEtf: false, name: "Applied Materials" },
  AMD:  { sector: "Technology", isEtf: false, name: "AMD" },
  APP:  { sector: "Technology", isEtf: false, name: "AppLovin" },
  ARM:  { sector: "Technology", isEtf: false, name: "Arm Holdings" },
  ASML: { sector: "Technology", isEtf: false, name: "ASML" },
  AVGO: { sector: "Technology", isEtf: false, name: "Broadcom" },
  CRM:  { sector: "Technology", isEtf: false, name: "Salesforce" },
  CRWD: { sector: "Technology", isEtf: false, name: "CrowdStrike" },
  CRWV: { sector: "Technology", isEtf: false, name: "CoreWeave" },
  CSCO: { sector: "Technology", isEtf: false, name: "Cisco" },
  DDOG: { sector: "Technology", isEtf: false, name: "Datadog" },
  DELL: { sector: "Technology", isEtf: false, name: "Dell" },
  DUOL: { sector: "Technology", isEtf: false, name: "Duolingo" },
  ENPH: { sector: "Technology", isEtf: false, name: "Enphase Energy" },
  FSLR: { sector: "Technology", isEtf: false, name: "First Solar" },
  HPE:  { sector: "Technology", isEtf: false, name: "Hewlett Packard Enterprise" },
  HPQ:  { sector: "Technology", isEtf: false, name: "HP" },
  INTC: { sector: "Technology", isEtf: false, name: "Intel" },
  IONQ: { sector: "Technology", isEtf: false, name: "IonQ" },
  LITE: { sector: "Technology", isEtf: false, name: "Lumentum" },
  LRCX: { sector: "Technology", isEtf: false, name: "Lam Research" },
  MDB:  { sector: "Technology", isEtf: false, name: "MongoDB" },
  MNDY: { sector: "Technology", isEtf: false, name: "Monday.com" },
  MRVL: { sector: "Technology", isEtf: false, name: "Marvell" },
  MSFT: { sector: "Technology", isEtf: false, name: "Microsoft" },
  MU:   { sector: "Technology", isEtf: false, name: "Micron" },
  NBIS: { sector: "Technology", isEtf: false, name: "Nebius Group" },
  NOW:  { sector: "Technology", isEtf: false, name: "ServiceNow" },
  NVDA: { sector: "Technology", isEtf: false, name: "NVIDIA" },
  NVTS: { sector: "Technology", isEtf: false, name: "Navitas Semiconductor" },
  OKTA: { sector: "Technology", isEtf: false, name: "Okta" },
  ORCL: { sector: "Technology", isEtf: false, name: "Oracle" },
  PANW: { sector: "Technology", isEtf: false, name: "Palo Alto Networks" },
  PATH: { sector: "Technology", isEtf: false, name: "UiPath" },
  PLTR: { sector: "Technology", isEtf: false, name: "Palantir" },
  QCOM: { sector: "Technology", isEtf: false, name: "Qualcomm" },
  RGTI: { sector: "Technology", isEtf: false, name: "Rigetti Computing" },
  SEDG: { sector: "Technology", isEtf: false, name: "SolarEdge" },
  SHOP: { sector: "Technology", isEtf: false, name: "Shopify" },
  SMCI: { sector: "Technology", isEtf: false, name: "Super Micro Computer" },
  SNDK: { sector: "Technology", isEtf: false, name: "SanDisk" },
  SNOW: { sector: "Technology", isEtf: false, name: "Snowflake" },
  TSM:  { sector: "Technology", isEtf: false, name: "TSMC" },
  TTD:  { sector: "Technology", isEtf: false, name: "The Trade Desk" },
  U:    { sector: "Technology", isEtf: false, name: "Unity Software" },
  ZETA: { sector: "Technology", isEtf: false, name: "Zeta Global" },
  ZM:   { sector: "Technology", isEtf: false, name: "Zoom" },

  // Communication
  AMC:  { sector: "Communication", isEtf: false, name: "AMC Entertainment" },
  ASTS: { sector: "Communication", isEtf: false, name: "AST SpaceMobile" },
  BIDU: { sector: "Communication", isEtf: false, name: "Baidu" },
  CMCSA:{ sector: "Communication", isEtf: false, name: "Comcast" },
  DIS:  { sector: "Communication", isEtf: false, name: "Disney" },
  DJT:  { sector: "Communication", isEtf: false, name: "Trump Media & Technology" },
  FUBO: { sector: "Communication", isEtf: false, name: "FuboTV" },
  GOOGL:{ sector: "Communication", isEtf: false, name: "Alphabet" },
  META: { sector: "Communication", isEtf: false, name: "Meta Platforms" },
  NFLX: { sector: "Communication", isEtf: false, name: "Netflix" },
  NMAX: { sector: "Communication", isEtf: false, name: "Newsmax" },
  PINS: { sector: "Communication", isEtf: false, name: "Pinterest" },
  RBLX: { sector: "Communication", isEtf: false, name: "Roblox" },
  RDDT: { sector: "Communication", isEtf: false, name: "Reddit" },
  ROKU: { sector: "Communication", isEtf: false, name: "Roku" },
  SE:   { sector: "Communication", isEtf: false, name: "Sea Limited" },
  SNAP: { sector: "Communication", isEtf: false, name: "Snap" },
  SPOT: { sector: "Communication", isEtf: false, name: "Spotify" },
  T:    { sector: "Communication", isEtf: false, name: "AT&T" },
  VZ:   { sector: "Communication", isEtf: false, name: "Verizon" },
  WBD:  { sector: "Communication", isEtf: false, name: "Warner Bros. Discovery" },

  // Consumer Discretionary
  ABNB: { sector: "Consumer Discretionary", isEtf: false, name: "Airbnb" },
  AEO:  { sector: "Consumer Discretionary", isEtf: false, name: "American Eagle Outfitters" },
  AMZN: { sector: "Consumer Discretionary", isEtf: false, name: "Amazon" },
  BABA: { sector: "Consumer Discretionary", isEtf: false, name: "Alibaba" },
  CAVA: { sector: "Consumer Discretionary", isEtf: false, name: "Cava Group" },
  CCL:  { sector: "Consumer Discretionary", isEtf: false, name: "Carnival" },
  CHWY: { sector: "Consumer Discretionary", isEtf: false, name: "Chewy" },
  CMG:  { sector: "Consumer Discretionary", isEtf: false, name: "Chipotle" },
  CVNA: { sector: "Consumer Discretionary", isEtf: false, name: "Carvana" },
  DKNG: { sector: "Consumer Discretionary", isEtf: false, name: "DraftKings" },
  EBAY: { sector: "Consumer Discretionary", isEtf: false, name: "eBay" },
  ETSY: { sector: "Consumer Discretionary", isEtf: false, name: "Etsy" },
  F:    { sector: "Consumer Discretionary", isEtf: false, name: "Ford" },
  GM:   { sector: "Consumer Discretionary", isEtf: false, name: "General Motors" },
  GME:  { sector: "Consumer Discretionary", isEtf: false, name: "GameStop" },
  JD:   { sector: "Consumer Discretionary", isEtf: false, name: "JD.com" },
  LCID: { sector: "Consumer Discretionary", isEtf: false, name: "Lucid Group" },
  LI:   { sector: "Consumer Discretionary", isEtf: false, name: "Li Auto" },
  LULU: { sector: "Consumer Discretionary", isEtf: false, name: "lululemon" },
  LYFT: { sector: "Consumer Discretionary", isEtf: false, name: "Lyft" },
  NIO:  { sector: "Consumer Discretionary", isEtf: false, name: "NIO" },
  NKE:  { sector: "Consumer Discretionary", isEtf: false, name: "Nike" },
  PDD:  { sector: "Consumer Discretionary", isEtf: false, name: "PDD Holdings" },
  RIVN: { sector: "Consumer Discretionary", isEtf: false, name: "Rivian" },
  SBUX: { sector: "Consumer Discretionary", isEtf: false, name: "Starbucks" },
  TGT:  { sector: "Consumer Discretionary", isEtf: false, name: "Target" },
  TSLA: { sector: "Consumer Discretionary", isEtf: false, name: "Tesla" },
  XPEV: { sector: "Consumer Discretionary", isEtf: false, name: "XPeng" },

  // Consumer Staples
  BYND: { sector: "Consumer Staples", isEtf: false, name: "Beyond Meat" },
  CELH: { sector: "Consumer Staples", isEtf: false, name: "Celsius Holdings" },
  COST: { sector: "Consumer Staples", isEtf: false, name: "Costco" },
  ELF:  { sector: "Consumer Staples", isEtf: false, name: "e.l.f. Beauty" },
  KO:   { sector: "Consumer Staples", isEtf: false, name: "Coca-Cola" },
  KVUE: { sector: "Consumer Staples", isEtf: false, name: "Kenvue" },
  WBA:  { sector: "Consumer Staples", isEtf: false, name: "Walgreens Boots Alliance" },
  WMT:  { sector: "Consumer Staples", isEtf: false, name: "Walmart" },

  // Financials
  AFRM: { sector: "Financials", isEtf: false, name: "Affirm" },
  AXP:  { sector: "Financials", isEtf: false, name: "American Express" },
  BAC:  { sector: "Financials", isEtf: false, name: "Bank of America" },
  BBD:  { sector: "Financials", isEtf: false, name: "Banco Bradesco" },
  BMNR: { sector: "Financials", isEtf: false, name: "Bitmine Immersion Technologies" },
  C:    { sector: "Financials", isEtf: false, name: "Citigroup" },
  CIFR: { sector: "Financials", isEtf: false, name: "Cipher Mining" },
  COIN: { sector: "Financials", isEtf: false, name: "Coinbase" },
  CRCL: { sector: "Financials", isEtf: false, name: "Circle Internet Group" },
  GS:   { sector: "Financials", isEtf: false, name: "Goldman Sachs" },
  HOOD: { sector: "Financials", isEtf: false, name: "Robinhood" },
  IREN: { sector: "Financials", isEtf: false, name: "IREN" },
  ITUB: { sector: "Financials", isEtf: false, name: "Itaú Unibanco" },
  JPM:  { sector: "Financials", isEtf: false, name: "JPMorgan Chase" },
  KLAR: { sector: "Financials", isEtf: false, name: "Klarna Group" },
  LMND: { sector: "Financials", isEtf: false, name: "Lemonade" },
  MARA: { sector: "Financials", isEtf: false, name: "MARA Holdings" },
  MS:   { sector: "Financials", isEtf: false, name: "Morgan Stanley" },
  MSTR: { sector: "Financials", isEtf: false, name: "MicroStrategy" },
  NU:   { sector: "Financials", isEtf: false, name: "Nu Holdings" },
  PYPL: { sector: "Financials", isEtf: false, name: "PayPal" },
  RIOT: { sector: "Financials", isEtf: false, name: "Riot Platforms" },
  RKT:  { sector: "Financials", isEtf: false, name: "Rocket Companies" },
  SCHW: { sector: "Financials", isEtf: false, name: "Charles Schwab" },
  SOFI: { sector: "Financials", isEtf: false, name: "SoFi Technologies" },
  UPST: { sector: "Financials", isEtf: false, name: "Upstart Holdings" },
  WFC:  { sector: "Financials", isEtf: false, name: "Wells Fargo" },
  XYZ:  { sector: "Financials", isEtf: false, name: "Block" },

  // Health Care
  ABBV: { sector: "Health Care", isEtf: false, name: "AbbVie" },
  BMY:  { sector: "Health Care", isEtf: false, name: "Bristol-Myers Squibb" },
  CVS:  { sector: "Health Care", isEtf: false, name: "CVS Health" },
  HIMS: { sector: "Health Care", isEtf: false, name: "Hims & Hers Health" },
  LLY:  { sector: "Health Care", isEtf: false, name: "Eli Lilly" },
  MRK:  { sector: "Health Care", isEtf: false, name: "Merck" },
  MRNA: { sector: "Health Care", isEtf: false, name: "Moderna" },
  NVAX: { sector: "Health Care", isEtf: false, name: "Novavax" },
  NVO:  { sector: "Health Care", isEtf: false, name: "Novo Nordisk" },
  OSCR: { sector: "Health Care", isEtf: false, name: "Oscar Health" },
  PFE:  { sector: "Health Care", isEtf: false, name: "Pfizer" },
  TDOC: { sector: "Health Care", isEtf: false, name: "Teladoc Health" },
  TEM:  { sector: "Health Care", isEtf: false, name: "Tempus AI" },
  TMDX: { sector: "Health Care", isEtf: false, name: "TransMedics Group" },
  UNH:  { sector: "Health Care", isEtf: false, name: "UnitedHealth Group" },
  VKTX: { sector: "Health Care", isEtf: false, name: "Viking Therapeutics" },

  // Industrials
  AAL:  { sector: "Industrials", isEtf: false, name: "American Airlines" },
  BA:   { sector: "Industrials", isEtf: false, name: "Boeing" },
  BLNK: { sector: "Industrials", isEtf: false, name: "Blink Charging" },
  CAR:  { sector: "Industrials", isEtf: false, name: "Avis Budget Group" },
  DAL:  { sector: "Industrials", isEtf: false, name: "Delta Air Lines" },
  EOSE: { sector: "Industrials", isEtf: false, name: "Eos Energy Enterprises" },
  GE:   { sector: "Industrials", isEtf: false, name: "GE Aerospace" },
  LMT:  { sector: "Industrials", isEtf: false, name: "Lockheed Martin" },
  PLUG: { sector: "Industrials", isEtf: false, name: "Plug Power" },
  RTX:  { sector: "Industrials", isEtf: false, name: "RTX" },
  RUN:  { sector: "Industrials", isEtf: false, name: "Sunrun" },
  UAL:  { sector: "Industrials", isEtf: false, name: "United Airlines" },
  UBER: { sector: "Industrials", isEtf: false, name: "Uber" },
  UPS:  { sector: "Industrials", isEtf: false, name: "United Parcel Service" },
  VRT:  { sector: "Industrials", isEtf: false, name: "Vertiv" },

  // Materials
  AA:   { sector: "Materials", isEtf: false, name: "Alcoa" },
  CLF:  { sector: "Materials", isEtf: false, name: "Cleveland-Cliffs" },
  FCX:  { sector: "Materials", isEtf: false, name: "Freeport-McMoRan" },
  GOLD: { sector: "Materials", isEtf: false, name: "Barrick Mining" },
  LAC:  { sector: "Materials", isEtf: false, name: "Lithium Americas" },
  NEM:  { sector: "Materials", isEtf: false, name: "Newmont" },
  USAR: { sector: "Materials", isEtf: false, name: "USA Rare Earth" },
  VALE: { sector: "Materials", isEtf: false, name: "Vale" },
  X:    { sector: "Materials", isEtf: false, name: "United States Steel" },

  // Energy
  CCJ:  { sector: "Energy", isEtf: false, name: "Cameco" },
  CVX:  { sector: "Energy", isEtf: false, name: "Chevron" },
  OKLO: { sector: "Energy", isEtf: false, name: "Oklo" },
  OXY:  { sector: "Energy", isEtf: false, name: "Occidental Petroleum" },
  PBR:  { sector: "Energy", isEtf: false, name: "Petrobras" },
  XOM:  { sector: "Energy", isEtf: false, name: "Exxon Mobil" },

  // Utilities
  NEE:  { sector: "Utilities", isEtf: false, name: "NextEra Energy" },
  VST:  { sector: "Utilities", isEtf: false, name: "Vistra" },

  // Real Estate
  OPEN: { sector: "Real Estate", isEtf: false, name: "Opendoor Technologies" },
};

// Normalize UW / Yahoo-style sector strings to our Sector union.
// Lower-cased keys cover the common cases. Returns null when unknown so the
// caller can fall through to a default.
const SECTOR_NORMALIZE: Record<string, Sector> = {
  // Canonical (direct matches)
  "technology": "Technology",
  "communication": "Communication",
  "consumer discretionary": "Consumer Discretionary",
  "consumer staples": "Consumer Staples",
  "energy": "Energy",
  "financials": "Financials",
  "health care": "Health Care",
  "industrials": "Industrials",
  "materials": "Materials",
  "real estate": "Real Estate",
  "utilities": "Utilities",
  "index": "Index",
  "commodities": "Commodities",
  "bonds": "Bonds",
  "volatility": "Volatility",
  // Aliases observed in UW / Yahoo data
  "financial services": "Financials",
  "financial": "Financials",
  "healthcare": "Health Care",
  "consumer cyclical": "Consumer Discretionary",
  "consumer defensive": "Consumer Staples",
  "basic materials": "Materials",
  "communication services": "Communication",
};

export function normalizeSector(raw: string | null | undefined): Sector | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return SECTOR_NORMALIZE[trimmed.toLowerCase()] ?? null;
}

// Single source of truth for resolving a ticker's sector. Used by both the
// daily `refresh-ticker-metadata` cron and the on-the-fly tagging in
// pollFlowAlerts so all rows agree on classification.
//   1. SECTOR_OVERRIDES wins (final answer for the 256+ tracked tickers)
//   2. Normalized UW raw sector (Yahoo-style names → our union)
//   3. Default "Technology" with `unresolved: true` so callers can count
//      blind spots for the next overrides update.
export interface ResolvedTickerMeta {
  sector: Sector;
  isEtf: boolean;
  name?: string;
  unresolved: boolean;
}

export function resolveTickerSector(
  ticker: string,
  rawSector?: string | null,
): ResolvedTickerMeta {
  const override = SECTOR_OVERRIDES[ticker.toUpperCase()];
  if (override) {
    return {
      sector: override.sector,
      isEtf: override.isEtf,
      name: override.name,
      unresolved: false,
    };
  }
  const normalized = normalizeSector(rawSector);
  if (normalized) return { sector: normalized, isEtf: false, unresolved: false };
  return { sector: "Technology", isEtf: false, unresolved: true };
}
