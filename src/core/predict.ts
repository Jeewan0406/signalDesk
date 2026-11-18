// Turns per-timeframe probabilities + event drivers into a forecast:
// direction and probability, targets at the next real levels, an invalidation
// level, and an estimated time to target from a volatility/drift model.

import { formatDurationRange, formatUsd, formatPct } from "./format";
import type { LevelsResult } from "./levels";
import type { AiAssetView, Derivatives, Direction, ExpectedRange, Forecast, Timeframe, TimeframeSignal } from "./types";

export interface HorizonCfg {
  key: "short" | "swing" | "position";
  label: string;
  hours: number;
  weights: Partial<Record<Timeframe, number>>;
}

export const HORIZONS: HorizonCfg[] = [
  { key: "short", label: "Next hours", hours: 12, weights: { "15m": 0.35, "1h": 0.45, "4h": 0.2 } },
  { key: "swing", label: "Next days", hours: 72, weights: { "1h": 0.2, "4h": 0.4, "1d": 0.4 } },
  { key: "position", label: "Next weeks", hours: 336, weights: { "4h": 0.2, "1d": 0.5, "1w": 0.3 } },
];

export interface ExternalFactors {
  kind: "crypto" | "metal";
  driverScore: number;
  derivatives: Derivatives | null;
  fearGreed: { value: number; label: string } | null;
  ai?: AiAssetView | null;
  aiAgeHours?: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function technicalProbability(h: HorizonCfg, tfs: TimeframeSignal[]): { prob: number; score: number } {
  let wsum = 0;
  let p = 0;
  let s = 0;
  for (const tf of tfs) {
    const w = h.weights[tf.tf] ?? 0;
    if (!w) continue;
    wsum += w;
    p += w * tf.probUp;
    s += w * tf.score;
  }
  return wsum ? { prob: p / wsum, score: s / wsum } : { prob: 0.5, score: 0 };
}

export function buildForecast(
  h: HorizonCfg,
  tfs: TimeframeSignal[],
  price: number,
  levels: LevelsResult,
  dailyVol: number,
  ext: ExternalFactors,
  decimals: number,
): Forecast {
  const tech = technicalProbability(h, tfs);
  const factors: Forecast["factors"] = [{ name: "Multi-timeframe technicals", value: tech.prob - 0.5, weight: 1 }];
  let prob = tech.prob;

  // News & events (geopolitics, war, central banks, hacks, regulation, flows).
  const newsW = h.key === "position" ? 0.04 : 0.07;
  const newsAdj = clamp(ext.driverScore, -1, 1) * newsW;
  if (Math.abs(newsAdj) > 0.002) factors.push({ name: "News & world events", value: newsAdj, weight: newsW });
  prob += newsAdj;

  // Derivatives positioning (contrarian at extremes).
  if (ext.derivatives && h.key !== "position") {
    const fa = ext.derivatives.fundingAnnualPct;
    let adj = 0;
    if (fa !== null) {
      if (fa > 40) adj -= Math.min(0.04, (fa - 40) / 1000 + 0.015);
      else if (fa < -10) adj += Math.min(0.04, (-10 - fa) / 800 + 0.015);
    }
    const ls = ext.derivatives.longShortRatio;
    if (ls !== null) {
      if (ls > 2.5) adj -= 0.015;
      else if (ls < 0.8) adj += 0.015;
    }
    if (adj) factors.push({ name: "Futures positioning (funding, long/short)", value: adj, weight: 0.04 });
    prob += adj;
  }

  // Crowd sentiment (contrarian at extremes, crypto only, multi-day horizons).
  if (ext.kind === "crypto" && ext.fearGreed && h.key !== "short") {
    const v = ext.fearGreed.value;
    const adj = v <= 15 ? 0.025 : v <= 25 ? 0.012 : v >= 85 ? -0.025 : v >= 75 ? -0.012 : 0;
    if (adj) factors.push({ name: `Fear & Greed ${v} (${ext.fearGreed.label}, contrarian)`, value: adj, weight: 0.025 });
    prob += adj;
  }

  // AI analyst view (if recent).
  if (ext.ai && (ext.aiAgeHours ?? 99) < 8) {
    const sgn = ext.ai.bias === "bullish" ? 1 : ext.ai.bias === "bearish" ? -1 : 0;
    const adj = sgn * 0.08 * clamp(ext.ai.confidence / 100, 0, 1) * (h.key === "short" ? 0.6 : 1);
    if (adj) factors.push({ name: "AI analyst (news + context)", value: adj, weight: 0.08 });
    prob += adj;
  }

  prob = clamp(prob, 0.05, 0.95);
  const direction: Direction = prob >= 0.55 ? "up" : prob <= 0.45 ? "down" : "neutral";
  const edge = Math.abs(prob - 0.5);
  const confidence = edge >= 0.15 ? "high" : edge >= 0.08 ? "medium" : "low";

  const sigmaH = dailyVol * Math.sqrt(h.hours / 24);
  let target1: number | null = null;
  let target2: number | null = null;
  let invalidation: number | null = null;

  // Targets scale with the horizon: the first real level beyond a quarter of
  // the horizon's typical move, preferring strong zones within 1.6 sigma.
  const dist = (z: { center: number }) => Math.abs(Math.log(z.center / price));
  const near = price * Math.max(0.002, dailyVol * 0.15);
  const res = levels.resistances.filter((z) => z.low > price && z.center > price + near);
  const sup = levels.supports.filter((z) => z.high < price && z.center < price - near);
  const pick = (list: typeof res) => {
    const band = list.filter((z) => dist(z) >= 0.25 * sigmaH && dist(z) <= 1.6 * sigmaH);
    const t1 = band.find((z) => z.strength >= 50) ?? band[0] ?? list.find((z) => dist(z) >= 0.25 * sigmaH) ?? list[0] ?? null;
    const beyond = t1 ? list.filter((z) => dist(z) > dist(t1) && dist(z) <= 2.5 * sigmaH) : [];
    const t2 = beyond.length ? beyond.reduce((a, b) => (b.strength > a.strength ? b : a)) : null;
    return [t1, t2] as const;
  };

  if (direction === "up") {
    const [t1, t2] = pick(res);
    target1 = t1 ? t1.center : price * Math.exp(1.2 * sigmaH);
    target2 = t2 ? t2.center : null;
    invalidation = sup[0] ? sup[0].low : price * Math.exp(-1.2 * sigmaH);
  } else if (direction === "down") {
    const [t1, t2] = pick(sup);
    target1 = t1 ? t1.center : price * Math.exp(-1.2 * sigmaH);
    target2 = t2 ? t2.center : null;
    invalidation = res[0] ? res[0].high : price * Math.exp(1.2 * sigmaH);
  } else {
    target1 = res[0]?.center ?? null;
    target2 = sup[0]?.center ?? null;
    invalidation = null;
  }

  // Time to target: Brownian motion with drift. Drift grows with the edge.
  let eta: Forecast["eta"] = null;
  if (target1 && direction !== "neutral" && dailyVol > 0) {
    const sigmaHour = dailyVol / Math.sqrt(24);
    const d = Math.abs(Math.log(target1 / price));
    const drift = edge * 2 * 0.6 * sigmaHour; // per hour
    const tDiff = 2.2 * (d / sigmaHour) ** 2; // median first-passage time without drift
    const tDrift = drift > 0 ? d / drift : Infinity;
    const t = 1 / (1 / tDiff + 1 / tDrift);
    const minH = Math.max(1 / 6, t * 0.5);
    const maxH = Math.max(minH * 1.5, t * 1.8);
    eta = { minHours: minH, maxHours: maxH, label: formatDurationRange(minH, maxH) };
  }

  const expectedMovePct = target1 ? (target1 / price - 1) * 100 : 0;
  const pctLabel = `${Math.round((direction === "down" ? 1 - prob : prob) * 100)}%`;
  let summary: string;
  if (direction === "up") {
    summary = `Bullish (${pctLabel} probability up). Favours a move to ${formatUsd(target1, decimals)} (${formatPct(expectedMovePct, 1)})${eta ? ` in about ${eta.label}` : ""}. The view is wrong if price breaks below ${formatUsd(invalidation, decimals)}.`;
  } else if (direction === "down") {
    summary = `Bearish (${pctLabel} probability down). Favours a drop to ${formatUsd(target1, decimals)} (${formatPct(expectedMovePct, 1)})${eta ? ` in about ${eta.label}` : ""}. The view is wrong if price breaks above ${formatUsd(invalidation, decimals)}.`;
  } else {
    summary = `No clear edge (${Math.round(prob * 100)}% up). Expect a range between ${formatUsd(target2, decimals)} and ${formatUsd(target1, decimals)} until one side breaks.`;
  }

  return {
    direction,
    probUp: prob,
    confidence,
    horizonLabel: h.label,
    target1,
    target2,
    invalidation,
    eta,
    expectedMovePct,
    summary,
    factors,
  };
}

export function expectedRanges(price: number, dailyVol: number): ExpectedRange[] {
  const rows: [string, number][] = [
    ["1 hour", 1],
    ["4 hours", 4],
    ["24 hours", 24],
    ["7 days", 168],
  ];
  return rows.map(([label, hours]) => {
    const s = dailyVol * Math.sqrt(hours / 24);
    return { label, hours, low: price * Math.exp(-s), high: price * Math.exp(s), pct: s * 100 };
  });
}
