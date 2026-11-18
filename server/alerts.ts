// Alarm rules. Runs every few minutes on the server.
//  - FLOOR HIT     price reached the predicted floor zone (best buy zone)
//  - CEILING HIT   price reached the predicted ceiling zone (best sell zone)
//  - FLOOR BROKEN  price closed clearly below the floor: the prediction failed
//  - CEILING BROKEN price broke out above the ceiling
//  - APPROACHING   price is within ~0.75 x hourly ATR of a zone (heads-up)
//  - CUSTOM        your own price alerts from config/alerts.json
// Zones from the PREVIOUS run are used, so the zone a price is falling into
// does not shift under it. Highs/lows of the bars since the last run are
// checked, so a quick wick between runs is not missed.

import { formatPct, formatUsd } from "../src/core/format";
import type { AiReport, AssetAnalysis, AssetConfig, Candle, CustomAlert, FiredAlert, NewsItem } from "../src/core/types";

export interface ZoneMemo {
  low: number;
  high: number;
  center: number;
  strength: number;
  sources: string[];
  holdProb: number;
}

export interface AssetMemo {
  at: number;
  price: number;
  atr1h: number;
  floor?: ZoneMemo;
  ceiling?: ZoneMemo;
  majorFloor?: ZoneMemo;
  majorCeiling?: ZoneMemo;
}

export interface MonitorState {
  version: 1;
  lastRunAt: number;
  assets: Record<string, AssetMemo>;
  fired: Record<string, number>;
  customFired: Record<string, number>;
  recent: FiredAlert[];
  ai: AiReport | null;
  lastAiAt: number;
  lastAiError?: string;
  gdelt: { at: number; items: NewsItem[] } | null;
}

export function emptyState(): MonitorState {
  return { version: 1, lastRunAt: 0, assets: {}, fired: {}, customFired: {}, recent: [], ai: null, lastAiAt: 0, gdelt: null };
}

const HOUR = 3_600_000;
const COOLDOWN: Record<FiredAlert["kind"], number> = {
  "floor-hit": 8 * HOUR,
  "ceiling-hit": 8 * HOUR,
  "floor-break": 12 * HOUR,
  "ceiling-break": 12 * HOUR,
  "approach-floor": 4 * HOUR,
  "approach-ceiling": 4 * HOUR,
  custom: 6 * HOUR,
};

export function memoFromAnalysis(a: AssetAnalysis, now: number): AssetMemo {
  const z = (fc: AssetAnalysis["floor"]): ZoneMemo | undefined =>
    fc ? { low: fc.zone.low, high: fc.zone.high, center: fc.zone.center, strength: fc.zone.strength, sources: fc.zone.sources.slice(0, 3), holdProb: fc.holdProb } : undefined;
  const h1 = a.timeframes.find((t) => t.tf === "1h");
  return {
    at: now,
    price: a.price,
    atr1h: h1?.indicators.atr ?? a.price * 0.005,
    floor: z(a.floor),
    ceiling: z(a.ceiling),
    majorFloor: z(a.majorFloor),
    majorCeiling: z(a.majorCeiling),
  };
}

function zoneKey(asset: string, kind: string, z: ZoneMemo): string {
  return `${asset}:${kind}:${Math.round(z.center / (z.center * 0.004))}`;
}

export interface EvalInput {
  asset: AssetConfig;
  analysis: AssetAnalysis;
  prev: AssetMemo | undefined;
  /** Recent 1-minute candles used for highs/lows since the last run. */
  recent: Candle[];
  custom: CustomAlert[];
  state: MonitorState;
  now: number;
  approach: boolean;
}

export function evaluateAlerts(inp: EvalInput): FiredAlert[] {
  const { asset, analysis: a, prev, state, now } = inp;
  const out: FiredAlert[] = [];
  const d = asset.decimals;
  const price = a.price;
  const fmtZone = (z: ZoneMemo) => `${formatUsd(z.low, d)}-${formatUsd(z.high, d)}`;
  const swing = a.forecast;
  const outlook = `Outlook ${a.horizons[0]?.horizonLabel.toLowerCase() ?? "next hours"}: ${dirWord(a.horizons[0]?.direction)} ${pctOf(a.horizons[0]?.probUp, a.horizons[0]?.direction)}; ${swing.horizonLabel.toLowerCase()}: ${dirWord(swing.direction)} ${pctOf(swing.probUp, swing.direction)}`;

  const fire = (kind: FiredAlert["kind"], key: string, title: string, message: string) => {
    const last = state.fired[key];
    if (last !== undefined && now - last < COOLDOWN[kind]) return;
    state.fired[key] = now;
    out.push({ id: `${key}:${now}`, asset: asset.id, kind, title, message: `${message}\n\nNot financial advice.`, price, at: now });
  };

  if (prev) {
    // Only bars that opened after the previous check (1-minute bars), so moves
    // that happened before the last run are not counted twice.
    const since = inp.recent.filter((c) => c.t >= prev.at - 60_000);
    const lowSince = Math.min(price, ...since.map((c) => c.l));
    const highSince = Math.max(price, ...since.map((c) => c.h));
    const buffer = 0.3 * prev.atr1h;
    const nextRes = a.resistances.find((z) => z.low > price);
    const nextSup = a.supports.find((z) => z.high < price);

    const floors: [string, ZoneMemo | undefined][] = [
      ["floor", prev.floor],
      ["major floor", prev.majorFloor],
    ];
    for (const [label, z] of floors) {
      if (!z) continue;
      const LABEL = label.toUpperCase();
      if (prev.price > z.high && lowSince <= z.high) {
        fire(
          "floor-hit",
          zoneKey(asset.id, label, z),
          `${asset.id} hit predicted ${LABEL} ${fmtZone(z)}`,
          `${asset.name} at ${formatUsd(price, d)} reached the ${label} zone (strength ${z.strength}/100: ${z.sources.join(", ")}). ` +
            `Model estimate: ${Math.round(z.holdProb * 100)}% chance it holds. ` +
            `Bounce target ${nextRes ? formatUsd(nextRes.center, d) : "n/a"}, invalidation below ${formatUsd(z.low - buffer, d)}.\n${outlook}`,
        );
      }
      if (price < z.low - buffer && prev.price >= z.low - buffer) {
        fire(
          "floor-break",
          zoneKey(asset.id, `${label}-break`, z),
          `${asset.id} BROKE BELOW ${label} ${formatUsd(z.low, d)}`,
          `${asset.name} at ${formatUsd(price, d)} broke through the ${label} zone ${fmtZone(z)}. The floor did not hold. ` +
            `Next support ${nextSup ? `${formatUsd(nextSup.center, d)} (strength ${nextSup.strength})` : "not mapped"}.\n${outlook}`,
        );
      }
      if (inp.approach && label === "floor" && price > z.high && price - z.high <= 0.75 * prev.atr1h && prev.price - z.high > 0.75 * prev.atr1h) {
        fire(
          "approach-floor",
          zoneKey(asset.id, "approach-floor", z),
          `${asset.id} approaching floor ${fmtZone(z)}`,
          `${asset.name} at ${formatUsd(price, d)} is ${formatPct(((price - z.high) / price) * 100, 2, false)} above the predicted floor (strength ${z.strength}).`,
        );
      }
    }

    const ceilings: [string, ZoneMemo | undefined][] = [
      ["ceiling", prev.ceiling],
      ["major ceiling", prev.majorCeiling],
    ];
    for (const [label, z] of ceilings) {
      if (!z) continue;
      const LABEL = label.toUpperCase();
      if (prev.price < z.low && highSince >= z.low) {
        fire(
          "ceiling-hit",
          zoneKey(asset.id, label, z),
          `${asset.id} hit predicted ${LABEL} ${fmtZone(z)}`,
          `${asset.name} at ${formatUsd(price, d)} reached the ${label} zone (strength ${z.strength}/100: ${z.sources.join(", ")}). ` +
            `Model estimate: ${Math.round(z.holdProb * 100)}% chance it caps the move. ` +
            `Pullback target ${nextSup ? formatUsd(nextSup.center, d) : "n/a"}, breakout above ${formatUsd(z.high + buffer, d)}.\n${outlook}`,
        );
      }
      if (price > z.high + buffer && prev.price <= z.high + buffer) {
        fire(
          "ceiling-break",
          zoneKey(asset.id, `${label}-break`, z),
          `${asset.id} BROKE ABOVE ${label} ${formatUsd(z.high, d)}`,
          `${asset.name} at ${formatUsd(price, d)} broke out above the ${label} zone ${fmtZone(z)}. ` +
            `Next resistance ${nextRes ? `${formatUsd(nextRes.center, d)} (strength ${nextRes.strength})` : "not mapped"}.\n${outlook}`,
        );
      }
      if (inp.approach && label === "ceiling" && price < z.low && z.low - price <= 0.75 * prev.atr1h && z.low - prev.price > 0.75 * prev.atr1h) {
        fire(
          "approach-ceiling",
          zoneKey(asset.id, "approach-ceiling", z),
          `${asset.id} approaching ceiling ${fmtZone(z)}`,
          `${asset.name} at ${formatUsd(price, d)} is ${formatPct(((z.low - price) / price) * 100, 2, false)} below the predicted ceiling (strength ${z.strength}).`,
        );
      }
    }

    for (const c of inp.custom.filter((x) => x.asset === asset.id)) {
      const crossed = c.type === "above" ? prev.price < c.price && highSince >= c.price : prev.price > c.price && lowSince <= c.price;
      if (!crossed) continue;
      if (!c.repeat && state.customFired[c.id]) continue;
      const key = `custom:${c.id}`;
      const before = out.length;
      fire(
        "custom",
        key,
        `${asset.id} ${c.type === "above" ? "rose above" : "fell below"} ${formatUsd(c.price, d)}`,
        `${asset.name} is at ${formatUsd(price, d)}.${c.note ? ` Note: ${c.note}` : ""}\n${outlook}`,
      );
      if (out.length > before) state.customFired[c.id] = now;
    }
  }
  return out;
}

function dirWord(d: string | undefined) {
  return d === "up" ? "Bullish" : d === "down" ? "Bearish" : "Neutral";
}
function pctOf(p: number | undefined, d: string | undefined) {
  if (p === undefined) return "";
  return `${Math.round((d === "down" ? 1 - p : p) * 100)}%`;
}
