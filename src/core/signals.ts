// Per-timeframe technical scoring, the way a discretionary trader reads a chart:
// trend (EMA stack + slope, filtered by ADX), momentum (RSI, MACD, Stoch RSI),
// market structure (higher highs/lows), volume confirmation (OBV, spikes) and
// RSI divergences. The same causal scorer is replayed over history to measure
// how often it was right, and that hit rate becomes the probability we show.

import {
  adx,
  atr,
  bollinger,
  ema,
  linregSlope,
  macd,
  obv,
  pivots,
  rsi,
  sma,
  stochRsi,
  type Pivot,
} from "./indicators";
import type { Candle, Direction, IndicatorSnapshot, Structure, Timeframe, TimeframeSignal, TrackRecord } from "./types";

export const HORIZON_BARS: Record<Timeframe, number> = {
  "1m": 30,
  "5m": 24,
  "15m": 16, // 4 hours
  "1h": 12, // 12 hours
  "4h": 6, // 24 hours
  "1d": 5, // 5 days
  "1w": 4, // 4 weeks
};

const PIVOT_LR: Record<Timeframe, number> = { "1m": 5, "5m": 5, "15m": 5, "1h": 4, "4h": 3, "1d": 3, "1w": 2 };

const WEIGHTS = { trend: 0.3, momentum: 0.25, structure: 0.2, volume: 0.1, divergence: 0.15 };

/** Signals weaker than this are treated as "no signal" in the track record. */
export const ACTION_THRESHOLD = 0.12;

const clip = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const sgn = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const fin = (x: number, d = 0) => (Number.isFinite(x) ? x : d);

export interface Precomputed {
  tf: Timeframe;
  candles: Candle[];
  closes: number[];
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi: number[];
  macd: number[];
  macdSignal: number[];
  macdHist: number[];
  atr: number[];
  adx: number[];
  plusDI: number[];
  minusDI: number[];
  bbUpper: number[];
  bbLower: number[];
  bbWidth: number[];
  stochK: number[];
  stochD: number[];
  obv: number[];
  volSma: number[];
  highs: Pivot[];
  lows: Pivot[];
}

export function precompute(tf: Timeframe, candles: Candle[]): Precomputed {
  const closes = candles.map((c) => c.c);
  const m = macd(closes);
  const a = adx(candles);
  const bb = bollinger(closes);
  const st = stochRsi(closes);
  const lr = PIVOT_LR[tf];
  const pv = pivots(candles, lr, lr);
  return {
    tf,
    candles,
    closes,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi: rsi(closes),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    atr: atr(candles),
    adx: a.adx,
    plusDI: a.plusDI,
    minusDI: a.minusDI,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    bbWidth: bb.width,
    stochK: st.k,
    stochD: st.d,
    obv: obv(candles),
    volSma: sma(candles.map((c) => c.v), 20),
    highs: pv.highs,
    lows: pv.lows,
  };
}

/** Last two pivots that were already confirmed at bar i (no look-ahead). */
function lastTwo(list: Pivot[], i: number): [Pivot, Pivot] | null {
  let b: Pivot | null = null;
  let a: Pivot | null = null;
  for (let k = list.length - 1; k >= 0; k--) {
    if (list[k].confirmedAt > i) continue;
    if (!b) b = list[k];
    else {
      a = list[k];
      break;
    }
  }
  return a && b ? [a, b] : null;
}

export interface ScoreDetail {
  score: number;
  components: Record<string, number>;
  trend: Direction;
  trendStrength: "weak" | "moderate" | "strong";
  structure: Structure;
  divergence: "bullish" | "bearish" | null;
  notes: string[];
}

export function scoreAt(p: Precomputed, i: number): ScoreDetail {
  const c = p.closes[i];
  const A = fin(p.atr[i], c * 0.01) || c * 0.01;
  const notes: string[] = [];

  // --- Trend -----------------------------------------------------------
  const e20 = p.ema20[i];
  const e50 = p.ema50[i];
  const e200 = p.ema200[i];
  let align = 0;
  if (Number.isFinite(e20) && Number.isFinite(e50)) align += 0.35 * sgn(e20 - e50);
  if (Number.isFinite(e50) && Number.isFinite(e200)) align += 0.35 * sgn(e50 - e200);
  if (Number.isFinite(e50)) align += 0.3 * sgn(c - e50);
  const slope = linregSlope(p.ema50, 10, i);
  const slopeTerm = Number.isFinite(slope) ? Math.tanh(slope / A / 0.08) : 0;
  const adxV = fin(p.adx[i], 20);
  const adxFactor = adxV < 15 ? 0.5 : adxV < 20 ? 0.7 : adxV < 25 ? 0.85 : 1;
  const trendRaw = 0.6 * align + 0.4 * slopeTerm;
  const trendComp = clip(trendRaw * adxFactor);
  const trend: Direction = trendRaw > 0.25 ? "up" : trendRaw < -0.25 ? "down" : "neutral";
  const trendStrength = adxV >= 30 ? "strong" : adxV >= 20 ? "moderate" : "weak";

  // --- Momentum --------------------------------------------------------
  const r = fin(p.rsi[i], 50);
  let rsiTerm: number;
  if (r > 75 && adxV < 25) {
    rsiTerm = -0.3;
    notes.push(`RSI ${r.toFixed(0)} overbought in a weak trend: pullback risk`);
  } else if (r < 25 && adxV < 25) {
    rsiTerm = 0.3;
    notes.push(`RSI ${r.toFixed(0)} oversold in a weak trend: bounce potential`);
  } else rsiTerm = clip((r - 50) / 20);
  const h = fin(p.macdHist[i]);
  const hPrev = fin(p.macdHist[i - 1]);
  const macdTerm = 0.5 * sgn(h) + 0.25 * sgn(h - hPrev) + 0.25 * sgn(fin(p.macd[i]));
  const k = fin(p.stochK[i], 50);
  const d = fin(p.stochD[i], 50);
  let stochTerm = clip((k - d) / 50) * 0.6;
  if (k > d && k < 25) stochTerm = 0.6;
  if (k < d && k > 75) stochTerm = -0.6;
  const momentum = clip(0.45 * rsiTerm + 0.4 * macdTerm + 0.15 * stochTerm);

  // --- Market structure ------------------------------------------------
  const hs = lastTwo(p.highs, i);
  const ls = lastTwo(p.lows, i);
  let structure: Structure = "mixed";
  let structComp = 0;
  if (hs && ls) {
    const hh = hs[1].price > hs[0].price;
    const hl = ls[1].price > ls[0].price;
    if (hh && hl) {
      structure = "HH-HL";
      structComp = 0.7;
    } else if (!hh && !hl) {
      structure = "LH-LL";
      structComp = -0.7;
    }
    if (c > hs[1].price) structComp += 0.4; // break of structure up
    if (c < ls[1].price) structComp -= 0.4; // break of structure down
  }
  structComp = clip(structComp);

  // --- Volume confirmation ---------------------------------------------
  const vAvg = fin(p.volSma[i]);
  let volComp = 0;
  if (vAvg > 0) {
    const obvSlope = linregSlope(p.obv, 20, i);
    volComp = Number.isFinite(obvSlope) ? Math.tanh((obvSlope / vAvg) * 2) * 0.7 : 0;
    const ratio = p.candles[i].v / vAvg;
    if (ratio > 1.8) volComp += 0.3 * sgn(p.candles[i].c - p.candles[i].o);
  }
  volComp = clip(volComp);

  // --- RSI divergence --------------------------------------------------
  let divergence: "bullish" | "bearish" | null = null;
  let divComp = 0;
  if (ls && i - ls[1].i <= 20) {
    const [a, b] = ls;
    if (b.price < a.price && fin(p.rsi[b.i], 50) > fin(p.rsi[a.i], 50) + 2) {
      divergence = "bullish";
      divComp = 1;
    }
  }
  if (!divergence && hs && i - hs[1].i <= 20) {
    const [a, b] = hs;
    if (b.price > a.price && fin(p.rsi[b.i], 50) < fin(p.rsi[a.i], 50) - 2) {
      divergence = "bearish";
      divComp = -1;
    }
  }

  const score = clip(
    WEIGHTS.trend * trendComp +
      WEIGHTS.momentum * momentum +
      WEIGHTS.structure * structComp +
      WEIGHTS.volume * volComp +
      WEIGHTS.divergence * divComp,
  );

  return {
    score,
    components: { trend: trendComp, momentum, structure: structComp, volume: volComp, divergence: divComp },
    trend,
    trendStrength,
    structure,
    divergence,
    notes,
  };
}

interface Bucket {
  n: number;
  hits: number;
}

/**
 * Walk-forward test of the scorer on this timeframe's own history. Returns a
 * function that turns a raw score into a calibrated probability of price being
 * higher after `horizon` bars, plus the overall track record.
 */
export function calibrate(p: Precomputed, horizon: number) {
  const edges = [ACTION_THRESHOLD, 0.25, 0.45, 2];
  const buckets: Bucket[] = edges.slice(0, -1).map(() => ({ n: 0, hits: 0 }));
  let ups = 0;
  let total = 0;
  let signals = 0;
  let hits = 0;
  const warmup = 60;
  const end = p.closes.length - 1 - horizon;
  for (let i = warmup; i <= end; i++) {
    const s = scoreAt(p, i).score;
    const fwd = p.closes[i + horizon] / p.closes[i] - 1;
    total++;
    if (fwd > 0) ups++;
    const mag = Math.abs(s);
    if (mag < ACTION_THRESHOLD || fwd === 0) continue;
    const correct = sgn(fwd) === sgn(s);
    signals++;
    if (correct) hits++;
    for (let b = 0; b < buckets.length; b++) {
      if (mag >= edges[b] && mag < edges[b + 1]) {
        buckets[b].n++;
        if (correct) buckets[b].hits++;
      }
    }
  }
  const baseUp = total > 0 ? ups / total : 0.5;
  const track: TrackRecord = {
    signals,
    hitRate: signals > 0 ? hits / signals : 0.5,
    bars: total,
    horizonBars: horizon,
  };

  function probUp(score: number): number {
    const mag = Math.abs(score);
    if (mag < ACTION_THRESHOLD) {
      // No real signal: lean slightly on how often this market rose over the horizon.
      return 0.5 + (baseUp - 0.5) * 0.5;
    }
    let b = buckets.findIndex((_, k) => mag >= edges[k] && mag < edges[k + 1]);
    if (b < 0) b = buckets.length - 1;
    const { n, hits: h } = buckets[b];
    const raw = (h + 1) / (n + 2); // Laplace smoothing
    const w = n / (n + 30); // shrink small samples toward 50/50
    const pHit = 0.5 + (raw - 0.5) * w;
    return score > 0 ? pHit : 1 - pHit;
  }

  return { probUp, track };
}

function snapshot(p: Precomputed, i: number): IndicatorSnapshot {
  const c = p.closes[i];
  const widths = p.bbWidth.slice(Math.max(0, i - 120), i + 1).filter(Number.isFinite).sort((a, b) => a - b);
  const w = p.bbWidth[i];
  const pct20 = widths.length ? widths[Math.floor(widths.length * 0.2)] : NaN;
  const vAvg = fin(p.volSma[i]);
  return {
    close: c,
    ema20: p.ema20[i],
    ema50: p.ema50[i],
    ema200: p.ema200[i],
    rsi: p.rsi[i],
    macd: p.macd[i],
    macdSignal: p.macdSignal[i],
    macdHist: p.macdHist[i],
    adx: p.adx[i],
    plusDI: p.plusDI[i],
    minusDI: p.minusDI[i],
    atr: p.atr[i],
    atrPct: (p.atr[i] / c) * 100,
    bbUpper: p.bbUpper[i],
    bbLower: p.bbLower[i],
    bbWidthPct: w,
    squeeze: Number.isFinite(w) && Number.isFinite(pct20) && w <= pct20,
    stochK: p.stochK[i],
    stochD: p.stochD[i],
    volumeRatio: vAvg > 0 ? p.candles[i].v / vAvg : 1,
  };
}

export function analyzeTimeframe(tf: Timeframe, candles: Candle[]): TimeframeSignal & { pre: Precomputed } {
  const p = precompute(tf, candles);
  const i = candles.length - 1;
  const detail = scoreAt(p, i);
  const horizon = HORIZON_BARS[tf];
  const cal = calibrate(p, horizon);
  const ind = snapshot(p, i);
  const notes = [...detail.notes];
  if (ind.squeeze) notes.push("Bollinger squeeze: volatility is compressed, a sharp breakout is likely");
  if (ind.close > ind.bbUpper) notes.push("Price is stretched above the upper Bollinger band");
  if (ind.close < ind.bbLower) notes.push("Price is stretched below the lower Bollinger band");
  if (detail.divergence) notes.push(`${detail.divergence === "bullish" ? "Bullish" : "Bearish"} RSI divergence on the latest swing`);
  if (ind.volumeRatio > 2) notes.push(`Volume is ${ind.volumeRatio.toFixed(1)}x its 20-bar average`);
  return {
    tf,
    score: detail.score,
    trend: detail.trend,
    trendStrength: detail.trendStrength,
    structure: detail.structure,
    divergence: detail.divergence,
    indicators: ind,
    components: detail.components,
    probUp: cal.probUp(detail.score),
    horizonBars: horizon,
    track: cal.track,
    notes,
    pre: p,
  };
}
