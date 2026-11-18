import { describe, expect, it } from "vitest";
import { emptyState, evaluateAlerts, type AssetMemo } from "../server/alerts";
import { getAsset } from "../src/core/assets";
import type { AssetAnalysis, Candle, Forecast } from "../src/core/types";

const fc = (dir: Forecast["direction"]): Forecast => ({
  direction: dir,
  probUp: dir === "up" ? 0.6 : dir === "down" ? 0.4 : 0.5,
  confidence: "medium",
  horizonLabel: "Next days",
  target1: null,
  target2: null,
  invalidation: null,
  eta: null,
  expectedMovePct: 0,
  summary: "",
  factors: [],
});

function analysis(price: number): AssetAnalysis {
  return {
    id: "BTC",
    name: "Bitcoin",
    price,
    change24hPct: 0,
    source: "test",
    updatedAt: 0,
    timeframes: [],
    composite: 0,
    supports: [{ low: 58000, high: 58500, center: 58250, strength: 60, kind: "support", sources: ["x"], touches: 1 }],
    resistances: [{ low: 66000, high: 66500, center: 66250, strength: 70, kind: "resistance", sources: ["y"], touches: 1 }],
    floor: null,
    ceiling: null,
    majorFloor: null,
    majorCeiling: null,
    testing: null,
    forecast: fc("up"),
    horizons: [fc("up"), fc("up"), fc("neutral")],
    ranges: [],
    drivers: [],
    driverScore: 0,
    derivatives: null,
  };
}

const prev: AssetMemo = {
  at: 1_000_000,
  price: 63000,
  atr1h: 300,
  floor: { low: 61800, high: 62300, center: 62050, strength: 77, sources: ["1D swing low"], holdProb: 0.68 },
  ceiling: { low: 65200, high: 65800, center: 65500, strength: 86, sources: ["4H swing high"], holdProb: 0.62 },
};

const bar = (t: number, l: number, h: number): Candle => ({ t, o: l, h, l, c: h, v: 1 });

describe("alarm rules", () => {
  it("fires FLOOR HIT when a wick since the last run reaches the floor", () => {
    const state = emptyState();
    const out = evaluateAlerts({
      asset: getAsset("BTC")!,
      analysis: analysis(62800),
      prev,
      recent: [bar(prev.at, 62200, 62900)],
      custom: [],
      state,
      now: prev.at + 300_000,
      approach: false,
    });
    expect(out.map((a) => a.kind)).toEqual(["floor-hit"]);
    expect(out[0].title).toContain("FLOOR");
    // Same event a few minutes later is suppressed by the cooldown.
    const again = evaluateAlerts({ asset: getAsset("BTC")!, analysis: analysis(62700), prev, recent: [bar(prev.at, 62200, 62900)], custom: [], state, now: prev.at + 600_000, approach: false });
    expect(again).toHaveLength(0);
  });

  it("fires FLOOR BROKEN when price closes well below the zone", () => {
    const out = evaluateAlerts({ asset: getAsset("BTC")!, analysis: analysis(61500), prev, recent: [], custom: [], state: emptyState(), now: prev.at + 300_000, approach: false });
    expect(out.map((a) => a.kind)).toContain("floor-break");
  });

  it("fires CEILING HIT and custom alerts on the way up", () => {
    const state = emptyState();
    const out = evaluateAlerts({
      asset: getAsset("BTC")!,
      analysis: analysis(65300),
      prev,
      recent: [],
      custom: [{ id: "c1", asset: "BTC", type: "above", price: 64000 }],
      state,
      now: prev.at + 300_000,
      approach: false,
    });
    expect(out.map((a) => a.kind).sort()).toEqual(["ceiling-hit", "custom"]);
    // Non-repeating custom alert fires once.
    const again = evaluateAlerts({
      asset: getAsset("BTC")!,
      analysis: analysis(65300),
      prev: { ...prev, price: 63500 },
      recent: [],
      custom: [{ id: "c1", asset: "BTC", type: "above", price: 64000 }],
      state,
      now: prev.at + 30 * 3_600_000,
      approach: false,
    });
    expect(again.filter((a) => a.kind === "custom")).toHaveLength(0);
  });

  it("stays quiet when nothing happens, and on the first run", () => {
    expect(evaluateAlerts({ asset: getAsset("BTC")!, analysis: analysis(63100), prev, recent: [], custom: [], state: emptyState(), now: prev.at + 300_000, approach: true })).toHaveLength(0);
    expect(evaluateAlerts({ asset: getAsset("BTC")!, analysis: analysis(62000), prev: undefined, recent: [], custom: [], state: emptyState(), now: 1, approach: true })).toHaveLength(0);
  });
});
