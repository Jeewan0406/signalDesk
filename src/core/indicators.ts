// Standard technical indicators, written to match the definitions used by
// TradingView / most charting platforms (Wilder smoothing for RSI, ATR, ADX).
// Every function returns an array aligned with its input; values that cannot
// be computed yet are NaN. All are causal: value[i] uses only data up to i.

import type { Candle } from "./types";

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > period) {
      sum -= values[i - period];
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average seeded with the SMA of the first `period` valid values. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let start = values.findIndex((v) => Number.isFinite(v));
  if (start < 0 || values.length - start < period) return out;
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += values[i];
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's moving average (RMA), used by RSI, ATR and ADX. */
export function rma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const start = values.findIndex((v) => Number.isFinite(v));
  if (start < 0 || values.length - start < period) return out;
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += values[i];
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const gains = new Array<number>(closes.length).fill(NaN);
  const losses = new Array<number>(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains[i] = Math.max(d, 0);
    losses[i] = Math.max(-d, 0);
  }
  const ag = rma(gains, period);
  const al = rma(losses, period);
  return ag.map((g, i) => {
    const l = al[i];
    if (!Number.isFinite(g) || !Number.isFinite(l)) return NaN;
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  });
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = ef.map((v, i) => v - es[i]);
  const sig = ema(line, signal);
  const hist = line.map((v, i) => v - sig[i]);
  return { macd: line, signal: sig, hist };
}

export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const pc = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  });
}

export function atr(candles: Candle[], period = 14): number[] {
  return rma(trueRange(candles), period);
}

export function adx(candles: Candle[], period = 14) {
  const n = candles.length;
  const plusDM = new Array<number>(n).fill(NaN);
  const minusDM = new Array<number>(n).fill(NaN);
  const tr = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    const pc = candles[i - 1].c;
    tr[i] = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - pc), Math.abs(candles[i].l - pc));
  }
  const atrS = rma(tr, period);
  const pS = rma(plusDM, period);
  const mS = rma(minusDM, period);
  const plusDI = pS.map((v, i) => (100 * v) / atrS[i]);
  const minusDI = mS.map((v, i) => (100 * v) / atrS[i]);
  const dx = plusDI.map((p, i) => {
    const m = minusDI[i];
    const s = p + m;
    return Number.isFinite(s) && s > 0 ? (100 * Math.abs(p - m)) / s : NaN;
  });
  return { adx: rma(dx, period), plusDI, minusDI };
}

export function stdev(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j];
      sq += values[j] * values[j];
    }
    const mean = sum / period;
    out[i] = Math.sqrt(Math.max(sq / period - mean * mean, 0));
  }
  return out;
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const sd = stdev(closes, period);
  const upper = mid.map((m, i) => m + mult * sd[i]);
  const lower = mid.map((m, i) => m - mult * sd[i]);
  const width = mid.map((m, i) => ((upper[i] - lower[i]) / m) * 100);
  return { mid, upper, lower, width };
}

export function stochRsi(closes: number[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const r = rsi(closes, rsiPeriod);
  const raw = r.map((v, i) => {
    if (i < stochPeriod - 1) return NaN;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (!Number.isFinite(r[j])) return NaN;
      lo = Math.min(lo, r[j]);
      hi = Math.max(hi, r[j]);
    }
    return hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100;
  });
  const k = sma(raw, kSmooth);
  const d = sma(k, dSmooth);
  return { k, d };
}

export function obv(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].c - candles[i - 1].c;
    out[i] = out[i - 1] + (d > 0 ? candles[i].v : d < 0 ? -candles[i].v : 0);
  }
  return out;
}

/** Least-squares slope of the last `period` values, per bar. */
export function linregSlope(values: number[], period: number, end = values.length - 1): number {
  const start = end - period + 1;
  if (start < 0) return NaN;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < period; i++) {
    const y = values[start + i];
    if (!Number.isFinite(y)) return NaN;
    sx += i;
    sy += y;
    sxy += i * y;
    sxx += i * i;
  }
  const den = period * sxx - sx * sx;
  return den === 0 ? 0 : (period * sxy - sx * sy) / den;
}

export interface Pivot {
  i: number;
  t: number;
  price: number;
  /** Index at which this pivot became known (i + right). */
  confirmedAt: number;
}

/** Fractal swing highs/lows: a bar whose high (low) is the extreme of `left` bars before and `right` bars after. */
export function pivots(candles: Candle[], left = 3, right = 3): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      // Left side must be strictly lower/higher; right side may tie, so the
      // first of two equal extremes still counts as the pivot.
      if (j < i ? candles[j].h >= candles[i].h : candles[j].h > candles[i].h) isHigh = false;
      if (j < i ? candles[j].l <= candles[i].l : candles[j].l < candles[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ i, t: candles[i].t, price: candles[i].h, confirmedAt: i + right });
    if (isLow) lows.push({ i, t: candles[i].t, price: candles[i].l, confirmedAt: i + right });
  }
  return { highs, lows };
}

/** Standard deviation of log returns over the last `period` bars. */
export function realizedVol(candles: Candle[], period: number, end = candles.length - 1): number {
  const start = Math.max(1, end - period + 1);
  const rets: number[] = [];
  for (let i = start; i <= end; i++) rets.push(Math.log(candles[i].c / candles[i - 1].c));
  if (rets.length < 2) return NaN;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v);
}

export function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}
