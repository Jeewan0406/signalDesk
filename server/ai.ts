// AI analyst: Claude reads the quantitative analysis plus the latest world and
// crypto headlines and writes a structured, reasoned forecast per asset, in
// the style of a senior multi-asset strategist. Runs on the server only, so
// the API key never ships inside the apps.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AiReport, AssetAnalysis, NewsItem } from "../src/core/types";

export const AI_MODEL = "claude-opus-5-5";

const Driver = z.object({
  factor: z.string(),
  effect: z.enum(["bullish", "bearish"]),
  weight: z.enum(["low", "medium", "high"]),
  explanation: z.string(),
});

const Scenario = z.object({
  name: z.enum(["bull", "base", "bear"]),
  probability: z.number().int(),
  priceTarget: z.number(),
  description: z.string(),
});

const AssetView = z.object({
  id: z.string(),
  bias: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number().int(),
  horizon: z.string(),
  expectedMovePct: z.number(),
  target: z.number(),
  invalidation: z.number(),
  floor: z.number(),
  ceiling: z.number(),
  timeToTarget: z.string(),
  drivers: z.array(Driver),
  scenarios: z.array(Scenario),
  reasoning: z.string(),
});

const Report = z.object({
  marketSummary: z.string(),
  riskRegime: z.enum(["risk-on", "risk-off", "mixed"]),
  keyEvents: z.array(
    z.object({
      headline: z.string(),
      category: z.string(),
      impact: z.string(),
      assets: z.array(z.string()),
    }),
  ),
  assets: z.array(AssetView),
});

const SYSTEM = `You are the head of research at a professional multi-asset trading desk covering Bitcoin, Solana, XRP and spot gold (XAU/USD).
You receive a quantitative briefing (multi-timeframe technicals, confluence support/resistance zones, a calibrated model forecast with its historical hit rate, derivatives positioning and sentiment) and the latest headlines on war, geopolitics, central banks, cyber attacks, regulation and institutional flows.

Produce the desk's forecast for each asset the way a senior trader would:
- Weigh what actually drives price now: risk regime (risk-on vs risk-off), the dollar and real yields, central-bank path, wars and geopolitical escalation or de-escalation (gold is a safe haven; crypto usually trades as a risk asset in shocks), hacks and exploits, regulation, ETF and institutional flows, leverage and funding, and technical structure.
- Anchor floor, ceiling, target and invalidation on the supplied zones unless the news clearly justifies a different level; say so in the reasoning when you deviate.
- "floor" is the level from which a bounce is most likely within the horizon; "ceiling" is where upside is most likely to stall.
- Be calibrated, not dramatic. Confidence is 0-100 and should rarely exceed 75. Bull/base/bear probabilities must add up to 100. If the evidence is mixed, say neutral.
- timeToTarget is a plain estimate such as "6-18 hours" or "2-5 days".
- horizon is the period your view covers, usually "next 1-3 days".
- Keep reasoning to 3-5 sentences of plain English that cite the specific headlines or data behind the view.
- Never invent headlines or data that are not in the briefing. Only the listed assets.`;

function digestAsset(a: AssetAnalysis) {
  const r = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : +x.toPrecision(6));
  return {
    id: a.id,
    name: a.name,
    price: r(a.price),
    change24hPct: r(a.change24hPct),
    timeframes: a.timeframes.map((t) => ({
      tf: t.tf,
      score: r(t.score),
      probUp: r(t.probUp),
      trend: `${t.trend} (${t.trendStrength})`,
      structure: t.structure,
      rsi: r(t.indicators.rsi),
      adx: r(t.indicators.adx),
      macdHist: r(t.indicators.macdHist),
      squeeze: t.indicators.squeeze,
      divergence: t.divergence,
      backtestHitRate: r(t.track.hitRate),
      notes: t.notes,
    })),
    testingZoneNow: a.testing ? { low: r(a.testing.low), high: r(a.testing.high), strength: a.testing.strength } : null,
    supports: a.supports.slice(0, 5).map((z) => ({ low: r(z.low), high: r(z.high), strength: z.strength, sources: z.sources.slice(0, 3) })),
    resistances: a.resistances.slice(0, 5).map((z) => ({ low: r(z.low), high: r(z.high), strength: z.strength, sources: z.sources.slice(0, 3) })),
    modelForecasts: a.horizons.map((h) => ({ horizon: h.horizonLabel, probUp: r(h.probUp), direction: h.direction, target: r(h.target1), invalidation: r(h.invalidation), eta: h.eta?.label ?? null })),
    expectedRanges: a.ranges.map((x) => ({ horizon: x.label, low: r(x.low), high: r(x.high) })),
    derivatives: a.derivatives,
    ruleBasedNewsScore: r(a.driverScore),
  };
}

export async function runAiAnalyst(
  assets: AssetAnalysis[],
  news: NewsItem[],
  context: { fearGreed: { value: number; label: string } | null; usdInr: number | null },
): Promise<AiReport> {
  const client = new Anthropic({ timeout: 300_000, maxRetries: 2 });
  const headlines = news.slice(0, 60).map((n) => ({
    time: new Date(n.publishedAt).toISOString().slice(0, 16) + "Z",
    source: n.source,
    title: n.title,
    categories: n.categories,
  }));
  const briefing = {
    asOf: new Date().toISOString(),
    fearGreed: context.fearGreed,
    usdInr: context.usdInr,
    assets: assets.map(digestAsset),
    headlines,
  };

  const msg = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(Report) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Here is the current briefing as JSON. Write the desk forecast for every asset in it.\n\n${JSON.stringify(briefing)}`,
      },
    ],
  });

  if (msg.stop_reason === "refusal") throw new Error(`AI declined: ${msg.stop_details?.explanation ?? "refusal"}`);
  if (msg.stop_reason === "max_tokens") throw new Error("AI output was cut off (max_tokens)");
  const parsed = msg.parsed_output;
  if (!parsed) throw new Error("AI returned no parseable output");
  const ids = new Set(assets.map((a) => a.id));
  return {
    generatedAt: Date.now(),
    model: msg.model,
    marketSummary: parsed.marketSummary,
    riskRegime: parsed.riskRegime,
    keyEvents: parsed.keyEvents.slice(0, 8),
    assets: parsed.assets.filter((v) => ids.has(v.id)),
  };
}
