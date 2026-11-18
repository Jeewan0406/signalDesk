import { describe, expect, it } from "vitest";
import { atr, bollinger, ema, macd, pivots, rsi, sma } from "../src/core/indicators";
import { computeLevels, pickFloorCeiling, touchProbability } from "../src/core/levels";
import { analyzeFromCandles } from "../src/core/analyze";
import { classifyHeadline, itemImpact } from "../src/core/drivers";
import { formatDurationRange } from "../src/core/format";
import { ASSETS, getAsset } from "../src/core/assets";
import type { Candle, NewsItem } from "../src/core/types";

function series(n: number, f: (i: number) => number, start = Date.UTC(2026, 0, 1), stepMs = 3_600_000): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    const o = i ? f(i - 1) : c;
    return { t: start + i * stepMs, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 100 + (i % 7) * 10 };
  });
}

describe("moving averages", () => {
  it("SMA matches hand calculation", () => {
    expect(sma([1, 2, 3, 4, 5], 3).slice(2)).toEqual([2, 3, 4]);
  });
  it("EMA is seeded with SMA and converges to a constant", () => {
    const e = ema([2, 4, 6, 8, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 3);
    expect(e[2]).toBeCloseTo(4);
    expect(e[3]).toBeCloseTo(6); // 8*0.5 + 4*0.5
    expect(e[19]).toBeCloseTo(10, 3);
  });
});

describe("RSI (Wilder)", () => {
  it("is 100 for a straight rally and 0 for a straight fall", () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const down = Array.from({ length: 40 }, (_, i) => 100 - i);
    expect(rsi(up)[39]).toBe(100);
    expect(rsi(down)[39]).toBeCloseTo(0);
  });
  it("matches the exact value for the classic Wilder example", () => {
    // StockCharts' 14-period example; 70.46 is the unrounded result (they show 70.53 from rounded averages).
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(closes)[14]).toBeCloseTo(70.464, 2);
  });
});

describe("MACD, ATR, Bollinger", () => {
  it("MACD is positive in an up-trend", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 * Math.exp(i * 0.01));
    const m = macd(closes);
    expect(m.macd[99]).toBeGreaterThan(0);
  });
  it("ATR equals the constant range of identical bars", () => {
    const cs: Candle[] = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 100, h: 101, l: 99, c: 100, v: 1 }));
    expect(atr(cs)[29]).toBeCloseTo(2);
  });
  it("Bollinger bands collapse on a flat series", () => {
    const b = bollinger(new Array(30).fill(50));
    expect(b.upper[29]).toBeCloseTo(50);
    expect(b.lower[29]).toBeCloseTo(50);
  });
});

describe("pivots", () => {
  it("finds the swing high and low of a sine wave", () => {
    const cs = series(100, (i) => 100 + 10 * Math.sin((i / 100) * 4 * Math.PI));
    const p = pivots(cs, 3, 3);
    expect(p.highs.length).toBeGreaterThanOrEqual(2);
    expect(p.lows.length).toBeGreaterThanOrEqual(1);
    for (const h of p.highs) expect(h.price).toBeGreaterThan(105);
    for (const l of p.lows) expect(l.price).toBeLessThan(95);
  });
});

describe("levels", () => {
  it("touch probability falls with distance", () => {
    expect(touchProbability(100, 99, 0.02)).toBeGreaterThan(touchProbability(100, 95, 0.02));
    expect(touchProbability(100, 100, 0.02)).toBeCloseTo(1);
  });
  it("finds supports below and resistances above price on an oscillating market", () => {
    const h1 = series(500, (i) => 100 + 8 * Math.sin(i / 20) + i * 0.005);
    const d1 = series(400, (i) => 100 + 10 * Math.sin(i / 15), Date.UTC(2025, 0, 1), 86_400_000);
    const price = h1[h1.length - 1].c;
    const lv = computeLevels({ "1h": h1, "1d": d1 }, price, 5, h1[h1.length - 1].t);
    expect(lv.supports.every((z) => z.center <= price)).toBe(true);
    expect(lv.resistances.every((z) => z.center > price)).toBe(true);
    const fc = pickFloorCeiling(lv, price, 0.03, 0, 72);
    if (fc.floor) expect(fc.floor.zone.high).toBeLessThan(price);
    if (fc.ceiling) expect(fc.ceiling.zone.low).toBeGreaterThan(price);
  });
});

describe("full analysis on synthetic data", () => {
  it("produces a consistent forecast object", () => {
    const now = Date.UTC(2026, 5, 1);
    const mk = (n: number, step: number) => series(n, (i) => 50000 * Math.exp(0.0004 * i + 0.02 * Math.sin(i / 9)), now - n * step, step);
    const set = { "15m": mk(400, 900_000), "1h": mk(500, 3_600_000), "4h": mk(500, 14_400_000), "1d": mk(400, 86_400_000) };
    const a = analyzeFromCandles(getAsset("BTC")!, set, "synthetic", { now });
    expect(a.horizons).toHaveLength(3);
    for (const h of a.horizons) {
      expect(h.probUp).toBeGreaterThan(0);
      expect(h.probUp).toBeLessThan(1);
      if (h.direction === "up" && h.target1) expect(h.target1).toBeGreaterThan(a.price);
      if (h.direction === "down" && h.target1) expect(h.target1).toBeLessThan(a.price);
    }
    expect(a.ranges[0].low).toBeLessThan(a.price);
  });
});

describe("event drivers", () => {
  const assets = ASSETS;
  const mk = (title: string): NewsItem => ({ title, url: "", source: "t", publishedAt: Date.now(), ...classifyHeadline(title, assets) });
  it("war escalation is bullish gold, bearish crypto", () => {
    const n = mk("Missile strikes escalate war fears across the Middle East");
    expect(n.categories).toContain("war");
    const [g] = itemImpact(n, getAsset("GOLD")!, n.title);
    const [b] = itemImpact(n, getAsset("BTC")!, n.title);
    expect(g).toBeGreaterThan(0);
    expect(b).toBeLessThan(0);
  });
  it("a crypto hack is bearish for the chain mentioned", () => {
    const n = mk("Solana DeFi protocol hacked, $40 million drained");
    expect(n.categories).toContain("cyber");
    expect(n.assets).toContain("SOL");
    expect(itemImpact(n, getAsset("SOL")!, n.title)[0]).toBeLessThan(-0.5);
  });
  it("a Fed rate cut is bullish for both", () => {
    const n = mk("Fed signals rate cuts as inflation cools");
    expect(itemImpact(n, getAsset("BTC")!, n.title)[0]).toBeGreaterThan(0);
    expect(itemImpact(n, getAsset("GOLD")!, n.title)[0]).toBeGreaterThan(0);
  });
});

describe("format", () => {
  it("chooses sensible units", () => {
    expect(formatDurationRange(0.5, 0.8)).toMatch(/minutes/);
    expect(formatDurationRange(6, 14)).toBe("6–14 hours");
    expect(formatDurationRange(48, 96)).toMatch(/days/);
    expect(formatDurationRange(24 * 14, 24 * 30)).toMatch(/weeks/);
  });
});
