import { assetDrivers } from "./drivers";
import { realizedVol } from "./indicators";
import { computeLevels, pickFloorCeiling, type CandleSet } from "./levels";
import { buildForecast, expectedRanges, HORIZONS, type ExternalFactors } from "./predict";
import { fetchCandles, type FetchOptions } from "./providers";
import { analyzeTimeframe } from "./signals";
import type { AiAssetView, AssetAnalysis, AssetConfig, Derivatives, NewsItem, Timeframe } from "./types";

export const ANALYSIS_TFS: Timeframe[] = ["15m", "1h", "4h", "1d", "1w"];
const LIMITS: Record<Timeframe, number> = { "1m": 300, "5m": 300, "15m": 400, "1h": 500, "4h": 500, "1d": 500, "1w": 200 };

export async function fetchCandleSet(asset: AssetConfig, opts: FetchOptions = {}): Promise<{ set: CandleSet; source: string }> {
  const preferred = opts.preferred ?? new Map<string, number>();
  // Fetch the 1h series first so every other timeframe sticks to the same source.
  const first = await fetchCandles(asset, "1h", LIMITS["1h"], { ...opts, preferred });
  const set: CandleSet = { "1h": first.candles };
  const rest = await Promise.allSettled(
    ANALYSIS_TFS.filter((tf) => tf !== "1h").map(async (tf) => [tf, await fetchCandles(asset, tf, LIMITS[tf], { ...opts, preferred })] as const),
  );
  for (const r of rest) if (r.status === "fulfilled") set[r.value[0]] = r.value[1].candles;
  return { set, source: first.source };
}

export interface AnalyzeExtras {
  news?: NewsItem[];
  derivatives?: Derivatives | null;
  fearGreed?: { value: number; label: string } | null;
  ai?: AiAssetView | null;
  aiAgeHours?: number;
  now?: number;
}

export type FullAnalysis = AssetAnalysis;

export function analyzeFromCandles(asset: AssetConfig, set: CandleSet, source: string, extras: AnalyzeExtras = {}): FullAnalysis {
  const now = extras.now ?? Date.now();
  const h1 = set["1h"];
  if (!h1 || h1.length < 50) throw new Error(`${asset.id}: not enough 1h data`);
  const latest = set["15m"]?.length ? set["15m"][set["15m"].length - 1] : h1[h1.length - 1];
  const price = latest.c;
  const dayAgo = h1.length > 24 ? h1[h1.length - 25].c : h1[0].c;
  const change24hPct = (price / dayAgo - 1) * 100;

  const timeframes = ANALYSIS_TFS.filter((tf) => (set[tf]?.length ?? 0) >= 60).map((tf) => {
    const { pre: _pre, ...sig } = analyzeTimeframe(tf, set[tf]!);
    return sig;
  });

  // Daily volatility from the last week of hourly returns (fallback: daily bars).
  let dailyVol = realizedVol(h1, 168) * Math.sqrt(24);
  if (!Number.isFinite(dailyVol) || dailyVol <= 0) dailyVol = set["1d"] ? realizedVol(set["1d"], 30) : 0.03;

  const levels = computeLevels(set, price, asset.roundStep, now);
  const { drivers, score: driverScore } = assetDrivers(asset, extras.news ?? [], extras.derivatives ?? null, extras.fearGreed ?? null, now);
  const ext: ExternalFactors = {
    kind: asset.kind,
    driverScore,
    derivatives: extras.derivatives ?? null,
    fearGreed: extras.fearGreed ?? null,
    ai: extras.ai ?? null,
    aiAgeHours: extras.aiAgeHours,
  };
  const horizons = HORIZONS.map((h) => buildForecast(h, timeframes, price, levels, dailyVol, ext, asset.decimals));
  const forecast = horizons[1];
  const composite = (forecast.probUp - 0.5) * 2;
  const atr1h = timeframes.find((t) => t.tf === "1h")?.indicators.atr ?? price * 0.005;
  const fc = pickFloorCeiling(levels, price, dailyVol, composite, 72, 0.5 * atr1h);

  return {
    id: asset.id,
    name: asset.name,
    price,
    change24hPct,
    source,
    updatedAt: now,
    timeframes,
    composite,
    supports: levels.supports.slice(0, 8),
    resistances: levels.resistances.slice(0, 8),
    ...fc,
    forecast,
    horizons,
    ranges: expectedRanges(price, dailyVol),
    drivers,
    driverScore,
    derivatives: extras.derivatives ?? null,
  };
}

export async function analyzeAsset(asset: AssetConfig, extras: AnalyzeExtras = {}, opts: FetchOptions = {}): Promise<{ analysis: FullAnalysis; set: CandleSet }> {
  const { set, source } = await fetchCandleSet(asset, opts);
  return { analysis: analyzeFromCandles(asset, set, source, extras), set };
}
