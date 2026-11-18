// Shared types for the analysis engine, the server monitor and the app UI.

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export const TF_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

/** One OHLCV bar. `t` is the bar's open time in epoch milliseconds (UTC). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Direction = "up" | "down" | "neutral";

/** A single source that a candle provider can read from. */
export type SourceRef =
  | { provider: "binance"; symbol: string }
  | { provider: "okx"; instId: string }
  | { provider: "okx-index"; instId: string; volumeInstId?: string }
  | { provider: "kraken"; pair: string }
  | { provider: "coindcx"; pair: string };

export interface AssetConfig {
  /** Short id used everywhere: BTC, SOL, XRP, GOLD ... */
  id: string;
  name: string;
  kind: "crypto" | "metal";
  /** Accent colour used in the UI. */
  color: string;
  /** Candle sources, tried in order until one works. */
  sources: SourceRef[];
  /** OKX perpetual swap used for funding rate / open interest. */
  okxSwap?: string;
  /** Currency code used by OKX's long/short ratio endpoint (crypto only). */
  okxCcy?: string;
  /** Live price stream on Binance's public market-data websocket (lowercase symbol). */
  binanceStream?: string;
  /** Symbol for the embedded TradingView chart widget. */
  tradingViewSymbol: string;
  /** Words that tie a news headline to this asset. */
  newsKeywords: string[];
  /** Round-number step used for psychological levels. */
  roundStep: number;
  decimals: number;
  enabled: boolean;
  note?: string;
}

export interface IndicatorSnapshot {
  close: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  adx: number;
  plusDI: number;
  minusDI: number;
  atr: number;
  atrPct: number;
  bbUpper: number;
  bbLower: number;
  bbWidthPct: number;
  /** True when Bollinger width is in the lowest 20% of its recent history (a squeeze). */
  squeeze: boolean;
  stochK: number;
  stochD: number;
  volumeRatio: number;
}

export type Structure = "HH-HL" | "LH-LL" | "mixed";

export interface TimeframeSignal {
  tf: Timeframe;
  score: number; // -1 .. 1
  trend: Direction;
  trendStrength: "weak" | "moderate" | "strong";
  structure: Structure;
  divergence: "bullish" | "bearish" | null;
  indicators: IndicatorSnapshot;
  components: Record<string, number>;
  /** Calibrated probability that price is higher after `horizonBars` bars. */
  probUp: number;
  horizonBars: number;
  track: TrackRecord;
  notes: string[];
}

export interface TrackRecord {
  /** Signals with |score| above the action threshold in the backtest window. */
  signals: number;
  /** Fraction of those where direction after the horizon matched the signal. */
  hitRate: number;
  /** Bars covered by the backtest. */
  bars: number;
  horizonBars: number;
}

export type LevelSource =
  | "swing"
  | "volume"
  | "fib"
  | "ema"
  | "pivot"
  | "round"
  | "range";

export interface LevelZone {
  low: number;
  high: number;
  center: number;
  /** 0..100 confluence strength. */
  strength: number;
  kind: "support" | "resistance";
  sources: string[];
  touches: number;
}

export interface FloorCeiling {
  zone: LevelZone;
  /** Model estimate that price respects the zone if it gets there. */
  holdProb: number;
  /** Chance price reaches the zone within the horizon (volatility model). */
  touchProb: number;
  horizonHours: number;
  distancePct: number;
}

export interface Forecast {
  direction: Direction;
  probUp: number;
  confidence: "low" | "medium" | "high";
  horizonLabel: string;
  target1: number | null;
  target2: number | null;
  invalidation: number | null;
  eta: { minHours: number; maxHours: number; label: string } | null;
  expectedMovePct: number;
  summary: string;
  /** Contribution of each factor to the final composite (for transparency). */
  factors: { name: string; value: number; weight: number }[];
}

export interface ExpectedRange {
  label: string;
  hours: number;
  low: number;
  high: number;
  pct: number;
}

export type DriverCategory =
  | "war"
  | "geopolitics"
  | "monetary"
  | "cyber"
  | "regulation"
  | "institutional"
  | "market"
  | "macro";

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  categories: DriverCategory[];
  sentiment: number; // -1..1
  assets: string[]; // asset ids mentioned explicitly
}

export interface Driver {
  label: string;
  category: DriverCategory | "derivatives" | "sentiment";
  impact: number; // -1..1 for this asset
  detail: string;
  url?: string;
  at?: number;
}

export interface Derivatives {
  fundingRate: number | null; // per 8h
  fundingAnnualPct: number | null;
  openInterestUsd: number | null;
  longShortRatio: number | null;
}

export interface AiAssetView {
  id: string;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  horizon: string;
  expectedMovePct: number;
  target: number;
  invalidation: number;
  floor: number;
  ceiling: number;
  timeToTarget: string;
  drivers: { factor: string; effect: "bullish" | "bearish"; weight: "low" | "medium" | "high"; explanation: string }[];
  scenarios: { name: "bull" | "base" | "bear"; probability: number; priceTarget: number; description: string }[];
  reasoning: string;
}

export interface AiReport {
  generatedAt: number;
  model: string;
  /** Human-readable provider, e.g. "Google Gemini (free tier)". */
  provider?: string;
  marketSummary: string;
  riskRegime: "risk-on" | "risk-off" | "mixed";
  keyEvents: { headline: string; category: string; impact: string; assets: string[] }[];
  assets: AiAssetView[];
}

export interface AssetAnalysis {
  id: string;
  name: string;
  price: number;
  change24hPct: number;
  source: string;
  updatedAt: number;
  timeframes: TimeframeSignal[];
  composite: number;
  supports: LevelZone[];
  resistances: LevelZone[];
  floor: FloorCeiling | null;
  ceiling: FloorCeiling | null;
  majorFloor: FloorCeiling | null;
  majorCeiling: FloorCeiling | null;
  /** Zone the price is inside right now (being tested), if any. */
  testing: LevelZone | null;
  /** Primary (multi-day) forecast. */
  forecast: Forecast;
  /** Forecasts for next hours / next days / next weeks. */
  horizons: Forecast[];
  ranges: ExpectedRange[];
  drivers: Driver[];
  driverScore: number;
  derivatives: Derivatives | null;
}

export interface FiredAlert {
  id: string;
  asset: string;
  kind: "floor-hit" | "ceiling-hit" | "floor-break" | "ceiling-break" | "approach-floor" | "approach-ceiling" | "custom";
  title: string;
  message: string;
  price: number;
  at: number;
}

export interface CustomAlert {
  id: string;
  asset: string;
  type: "above" | "below";
  price: number;
  note?: string;
  repeat?: boolean;
}

/** The JSON document the 24/7 monitor publishes and the apps read. */
export interface PublishedSnapshot {
  version: 1;
  generatedAt: number;
  usdInr: number | null;
  fearGreed: { value: number; label: string } | null;
  assets: Record<string, AssetAnalysis>;
  news: NewsItem[];
  ai: AiReport | null;
  alerts: FiredAlert[];
  monitor: {
    intervalMinutes: number;
    aiIntervalMinutes: number;
    aiEnabled: boolean;
    aiKeyPresent?: boolean;
    approachAlerts?: boolean;
    /** Configured provider: auto | gemini | groq | anthropic. */
    aiProvider?: string;
    /** Providers that have a key on the server. */
    aiProvidersAvailable?: string[];
    lastAiError?: string;
  };
}
