// Support / resistance zones from confluence, the way professional traders
// mark up a chart: swing highs/lows on several timeframes, volume-profile
// nodes, Fibonacci retracements of the dominant swing, key moving averages,
// classic pivot points, prior day/week/month extremes and round numbers.
// Nearby levels are merged into zones; zones with more (and more varied)
// evidence, plus more historical rejections, get a higher strength score.

import { atr, ema, pivots } from "./indicators";
import type { Candle, FloorCeiling, LevelZone, Timeframe } from "./types";

interface Candidate {
  price: number;
  weight: number;
  source: string; // human-readable
  type: string; // family, for diversity bonus
}

export type CandleSet = Partial<Record<Timeframe, Candle[]>>;

const DAY = 86_400_000;

const SWING_CFG: { tf: Timeframe; lr: number; w: number; halfLifeDays: number }[] = [
  { tf: "1h", lr: 5, w: 1, halfLifeDays: 7 },
  { tf: "4h", lr: 4, w: 2, halfLifeDays: 30 },
  { tf: "1d", lr: 3, w: 3, halfLifeDays: 120 },
  { tf: "1w", lr: 2, w: 4, halfLifeDays: 365 },
];

function swingCandidates(set: CandleSet, now: number, out: Candidate[]) {
  for (const cfg of SWING_CFG) {
    const cs = set[cfg.tf];
    if (!cs || cs.length < 20) continue;
    const a = atr(cs);
    const { highs, lows } = pivots(cs, cfg.lr, cfg.lr);
    const tfName = cfg.tf.toUpperCase();
    for (const p of lows) {
      const age = (now - p.t) / DAY;
      const rec = Math.pow(0.5, age / cfg.halfLifeDays);
      let maxAfter = p.price;
      for (let j = p.i + 1; j < Math.min(cs.length, p.i + 11); j++) maxAfter = Math.max(maxAfter, cs[j].h);
      const reaction = (maxAfter - p.price) / (a[p.i] || p.price * 0.01);
      const f = Math.min(1.5, Math.max(0.5, 0.5 + reaction / 6));
      out.push({ price: p.price, weight: cfg.w * rec * f, source: `${tfName} swing low`, type: "swing" });
    }
    for (const p of highs) {
      const age = (now - p.t) / DAY;
      const rec = Math.pow(0.5, age / cfg.halfLifeDays);
      let minAfter = p.price;
      for (let j = p.i + 1; j < Math.min(cs.length, p.i + 11); j++) minAfter = Math.min(minAfter, cs[j].l);
      const reaction = (p.price - minAfter) / (a[p.i] || p.price * 0.01);
      const f = Math.min(1.5, Math.max(0.5, 0.5 + reaction / 6));
      out.push({ price: p.price, weight: cfg.w * rec * f, source: `${tfName} swing high`, type: "swing" });
    }
  }
}

function volumeProfile(cs: Candle[] | undefined, label: string, pocWeight: number, out: Candidate[]) {
  if (!cs || cs.length < 50) return;
  const total = cs.reduce((s, c) => s + c.v, 0);
  if (!(total > 0)) return;
  const lo = Math.min(...cs.map((c) => c.l));
  const hi = Math.max(...cs.map((c) => c.h));
  if (!(hi > lo)) return;
  const bins = 60;
  const size = (hi - lo) / bins;
  const vol = new Array<number>(bins).fill(0);
  for (const c of cs) {
    const b0 = Math.max(0, Math.floor((c.l - lo) / size));
    const b1 = Math.min(bins - 1, Math.floor((c.h - lo) / size));
    const share = c.v / (b1 - b0 + 1);
    for (let b = b0; b <= b1; b++) vol[b] += share;
  }
  const max = Math.max(...vol);
  const mean = vol.reduce((a, b) => a + b, 0) / bins;
  const poc = vol.indexOf(max);
  out.push({ price: lo + (poc + 0.5) * size, weight: pocWeight, source: `${label} volume POC`, type: "volume" });
  for (let b = 1; b < bins - 1; b++) {
    if (b === poc) continue;
    if (vol[b] > vol[b - 1] && vol[b] >= vol[b + 1] && vol[b] >= mean * 1.3) {
      out.push({
        price: lo + (b + 0.5) * size,
        weight: (pocWeight * 0.6 * vol[b]) / max,
        source: `${label} high-volume node`,
        type: "volume",
      });
    }
  }
}

function fibCandidates(d: Candle[] | undefined, out: Candidate[]) {
  if (!d || d.length < 30) return;
  const win = d.slice(-120);
  let hiI = 0;
  let loI = 0;
  win.forEach((c, i) => {
    if (c.h > win[hiI].h) hiI = i;
    if (c.l < win[loI].l) loI = i;
  });
  const hi = win[hiI].h;
  const lo = win[loI].l;
  const range = hi - lo;
  if (!(range > 0)) return;
  const up = hiI > loI; // low came first -> retracing an up-move
  const levels: [number, number][] = [
    [0.236, 1],
    [0.382, 1.5],
    [0.5, 1.5],
    [0.618, 2.5],
    [0.786, 1.5],
  ];
  for (const [r, w] of levels) {
    const price = up ? hi - r * range : lo + r * range;
    out.push({ price, weight: w, source: `Fib ${r} of 120D swing`, type: "fib" });
  }
  // Extensions for targets beyond the range.
  for (const [r, w] of [
    [1.272, 1],
    [1.618, 1.3],
  ] as [number, number][]) {
    const price = up ? lo + r * range : hi - r * range;
    if (price > 0) out.push({ price, weight: w, source: `Fib ext ${r}`, type: "fib" });
  }
}

function emaCandidates(set: CandleSet, out: Candidate[]) {
  const add = (tf: Timeframe, period: number, w: number) => {
    const cs = set[tf];
    if (!cs || cs.length < period + 5) return;
    const e = ema(
      cs.map((c) => c.c),
      period,
    );
    const v = e[e.length - 1];
    if (Number.isFinite(v)) out.push({ price: v, weight: w, source: `${tf.toUpperCase()} EMA${period}`, type: "ema" });
  };
  add("1d", 50, 1.5);
  add("1d", 200, 2.5);
  add("4h", 200, 1.5);
  add("1w", 20, 1.5);
}

function pivotPointCandidates(cs: Candle[] | undefined, label: string, mult: number, out: Candidate[]) {
  if (!cs || cs.length < 3) return;
  const prev = cs[cs.length - 2];
  const P = (prev.h + prev.l + prev.c) / 3;
  const R = prev.h - prev.l;
  const pts: [string, number, number][] = [
    ["P", P, 1],
    ["R1", 2 * P - prev.l, 1],
    ["S1", 2 * P - prev.h, 1],
    ["R2", P + R, 0.8],
    ["S2", P - R, 0.8],
  ];
  for (const [n, price, w] of pts) out.push({ price, weight: w * mult, source: `${label} pivot ${n}`, type: "pivot" });
}

function rangeCandidates(set: CandleSet, out: Candidate[]) {
  const d = set["1d"];
  const w = set["1w"];
  if (d && d.length > 31) {
    const pd = d[d.length - 2];
    out.push({ price: pd.h, weight: 1.2, source: "Previous day high", type: "range" });
    out.push({ price: pd.l, weight: 1.2, source: "Previous day low", type: "range" });
    const m = d.slice(-31, -1);
    out.push({ price: Math.max(...m.map((c) => c.h)), weight: 2, source: "30-day high", type: "range" });
    out.push({ price: Math.min(...m.map((c) => c.l)), weight: 2, source: "30-day low", type: "range" });
  }
  if (w && w.length > 2) {
    const pw = w[w.length - 2];
    out.push({ price: pw.h, weight: 1.8, source: "Previous week high", type: "range" });
    out.push({ price: pw.l, weight: 1.8, source: "Previous week low", type: "range" });
  }
}

function roundCandidates(price: number, step: number, span: number, out: Candidate[]) {
  if (!(step > 0)) return;
  const lo = Math.floor((price - span) / step) * step;
  const hi = Math.ceil((price + span) / step) * step;
  const count = (hi - lo) / step;
  if (count > 400) return;
  for (let k = 0; k <= count; k++) {
    const v = +(lo + k * step).toFixed(8);
    if (v <= 0) continue;
    const units = Math.round(v / step);
    const w = units % 10 === 0 ? 1.6 : units % 5 === 0 ? 1.2 : 0.6;
    out.push({ price: v, weight: w, source: `Round number ${v}`, type: "round" });
  }
}

/** Count rejections: candles that wicked into the zone but closed back outside it. */
function countTouches(cs: Candle[] | undefined, low: number, high: number, kind: "support" | "resistance", lookback: number): number {
  if (!cs) return 0;
  let n = 0;
  const start = Math.max(0, cs.length - lookback);
  for (let i = start; i < cs.length - 1; i++) {
    const c = cs[i];
    if (kind === "support" && c.l <= high && c.l >= low - (high - low) && c.c > high) n++;
    if (kind === "resistance" && c.h >= low && c.h <= high + (high - low) && c.c < low) n++;
  }
  return n;
}

export interface LevelsResult {
  supports: LevelZone[];
  resistances: LevelZone[];
  tolerance: number;
}

export function computeLevels(set: CandleSet, price: number, roundStep: number, now = Date.now()): LevelsResult {
  const daily = set["1d"];
  const dATR = daily && daily.length > 20 ? atr(daily)[daily.length - 1] : price * 0.03;
  const span = Math.min(price * 0.35, Math.max(8 * dATR, price * 0.06));
  const tol = Math.max(0.14 * dATR, price * 0.001);

  const cands: Candidate[] = [];
  swingCandidates(set, now, cands);
  volumeProfile(set["1h"], "1H", 2, cands);
  volumeProfile(set["4h"], "4H", 3, cands);
  fibCandidates(daily, cands);
  emaCandidates(set, cands);
  pivotPointCandidates(daily, "Daily", 1, cands);
  pivotPointCandidates(set["1w"], "Weekly", 1.5, cands);
  rangeCandidates(set, cands);
  roundCandidates(price, roundStep, span, cands);

  const inRange = cands.filter((c) => Number.isFinite(c.price) && c.weight > 0.05 && Math.abs(c.price - price) <= span);
  inRange.sort((a, b) => a.price - b.price);

  // Greedy clustering into zones.
  const clusters: Candidate[][] = [];
  for (const c of inRange) {
    const cur = clusters[clusters.length - 1];
    if (cur && c.price - cur[cur.length - 1].price <= tol && c.price - cur[0].price <= 1.6 * tol) cur.push(c);
    else clusters.push([c]);
  }

  const zones: LevelZone[] = clusters.map((members) => {
    const wsum = members.reduce((s, m) => s + m.weight, 0);
    const center = members.reduce((s, m) => s + m.price * m.weight, 0) / wsum;
    const pad = 0.15 * tol;
    const low = Math.min(...members.map((m) => m.price)) - pad;
    const high = Math.max(...members.map((m) => m.price)) + pad;
    const kind: "support" | "resistance" = center <= price ? "support" : "resistance";
    const types = new Set(members.map((m) => m.type));
    const touches =
      countTouches(set["1h"], low, high, kind, 500) + countTouches(set["4h"], low, high, kind, 300) * 2;
    let score = wsum * (1 + 0.15 * (types.size - 1)) + 0.4 * Math.min(touches, 8);
    // A lone round number is not a real level.
    if (types.size === 1 && types.has("round")) score *= 0.5;
    const strength = Math.round(100 * (1 - Math.exp(-score / 12)));
    // Keep the most informative source labels first.
    const sources = [...members]
      .sort((a, b) => b.weight - a.weight)
      .map((m) => m.source)
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .slice(0, 6);
    return { low, high, center, strength, kind, sources, touches };
  });

  const strong = zones.filter((z) => z.strength >= 20);
  const supports = strong.filter((z) => z.kind === "support").sort((a, b) => b.center - a.center);
  const resistances = strong.filter((z) => z.kind === "resistance").sort((a, b) => a.center - b.center);
  return { supports, resistances, tolerance: tol };
}

// ---- Probability helpers ------------------------------------------------

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

/** Probability that price touches `level` within a horizon, for a driftless random walk with volatility `sigmaH`. */
export function touchProbability(price: number, level: number, sigmaH: number): number {
  if (!(sigmaH > 0)) return 0;
  const d = Math.abs(Math.log(level / price));
  return Math.min(1, 2 * normCdf(-d / sigmaH));
}

/**
 * Pick the "floor" (best support to buy from) and "ceiling" (best resistance
 * to sell into) for a horizon. A zone wins on strength, with a mild preference
 * for zones that price can realistically reach within the horizon.
 */
export function pickFloorCeiling(
  levels: LevelsResult,
  price: number,
  dailyVol: number,
  composite: number,
  horizonHours = 72,
  /** Minimum distance (in price) between the current price and a floor/ceiling zone edge. */
  minGap = 0,
): {
  floor: FloorCeiling | null;
  ceiling: FloorCeiling | null;
  majorFloor: FloorCeiling | null;
  majorCeiling: FloorCeiling | null;
  testing: LevelZone | null;
} {
  const sigmaH = dailyVol * Math.sqrt(horizonHours / 24);
  // A zone that already contains the price is being tested right now; the
  // floor and ceiling are the next zones outside it.
  // Zones touching the price (or within `minGap` of it) are "being tested".
  const near = (z: LevelZone) => z.low - minGap <= price && price <= z.high + minGap;
  const testing = [...levels.supports, ...levels.resistances].filter(near).sort((a, b) => b.strength - a.strength)[0] ?? null;
  const supports = levels.supports.filter((z) => z.high < price - minGap);
  const resistances = levels.resistances.filter((z) => z.low > price + minGap);
  const reach = 2.5 * sigmaH;

  const build = (zone: LevelZone, isSupport: boolean): FloorCeiling => {
    const edge = isSupport ? zone.high : zone.low;
    const align = isSupport ? composite : -composite; // supports hold better in up-trends
    const fatigue = 0.015 * Math.min(Math.max(0, zone.touches - 6), 8); // levels weaken with repeated tests
    const holdProb = Math.min(0.88, Math.max(0.15, 0.3 + (0.5 * zone.strength) / 100 + 0.12 * align - fatigue));
    return {
      zone,
      holdProb,
      touchProb: touchProbability(price, edge, sigmaH),
      horizonHours,
      distancePct: ((zone.center - price) / price) * 100,
    };
  };

  // The floor/ceiling is the first *strong* zone price is likely to meet:
  // strength discounted by distance (in units of the horizon's volatility).
  // Deeper/higher strong zones are reported separately as major levels.
  const choose = (list: LevelZone[], isSupport: boolean, maxSigma: number) => {
    const within = list.filter((z) => Math.abs(Math.log(z.center / price)) <= maxSigma * sigmaH);
    const pool = within.some((z) => z.strength >= 35) ? within.filter((z) => z.strength >= 35) : within;
    let best: LevelZone | null = null;
    let bestScore = -Infinity;
    for (const z of pool) {
      const dist = Math.abs(Math.log(z.center / price));
      const s = z.strength * Math.exp(-dist / (1.5 * sigmaH));
      if (s > bestScore) {
        best = z;
        bestScore = s;
      }
    }
    if (!best && list.length) best = list[0];
    return best ? build(best, isSupport) : null;
  };

  const floor = choose(supports, true, reach / sigmaH);
  const ceiling = choose(resistances, false, reach / sigmaH);
  const deeper = supports.filter((z) => !floor || z.center < floor.zone.low);
  const higher = resistances.filter((z) => !ceiling || z.center > ceiling.zone.high);
  const pickStrongest = (list: LevelZone[], isSupport: boolean) => {
    const within = list.filter((z) => Math.abs(Math.log(z.center / price)) <= 4.5 * sigmaH);
    if (!within.length) return null;
    const best = within.reduce((a, b) => (b.strength > a.strength ? b : a));
    return build(best, isSupport);
  };
  return {
    floor,
    ceiling,
    majorFloor: pickStrongest(deeper, true),
    majorCeiling: pickStrongest(higher, false),
    testing,
  };
}
