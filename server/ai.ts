// AI analyst: an LLM reads the quantitative analysis plus the latest world and
// crypto headlines and writes a structured, reasoned forecast per asset, in the
// style of a senior multi-asset strategist. Runs on the server only, so API
// keys never ship inside the apps.
//
// Providers (tried in this order with aiProvider = "auto"):
//   gemini    — Google Gemini, FREE tier (GEMINI_API_KEY from aistudio.google.com).
//               Uses the stronger Flash model while its small daily quota lasts,
//               then Flash-Lite (larger free quota).
//   groq      — Groq, FREE tier (GROQ_API_KEY), OpenAI's open-weight gpt-oss-120b.
//   anthropic — Claude (ANTHROPIC_API_KEY), paid per use.
// If one provider/model is rate-limited or fails, the next one is tried.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AiReport, AssetAnalysis, NewsItem } from "../src/core/types";

export const CLAUDE_MODEL = "claude-opus-5-5";
export type AiProviderName = "gemini" | "groq" | "anthropic";
export const PROVIDER_LABEL: Record<AiProviderName, string> = {
  gemini: "Google Gemini (free tier)",
  groq: "Groq gpt-oss (free tier)",
  anthropic: "Claude (paid)",
};

// ---- Output schema -------------------------------------------------------

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
  keyEvents: z.array(z.object({ headline: z.string(), category: z.string(), impact: z.string(), assets: z.array(z.string()) })),
  assets: z.array(AssetView),
});
type ReportT = z.infer<typeof Report>;

// Lenient parser for providers without strict schema enforcement: accepts
// numbers sent as strings and enum values in any letter case.
const num = z.coerce.number();
const int = z.coerce.number().transform((v) => Math.round(v));
const lower = <T extends [string, ...string[]]>(vals: T) => z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(vals));
const LenientReport = z.object({
  marketSummary: z.string(),
  riskRegime: lower(["risk-on", "risk-off", "mixed"]),
  keyEvents: z.array(z.object({ headline: z.string(), category: z.string(), impact: z.string(), assets: z.array(z.string()).default([]) })).default([]),
  assets: z.array(
    z.object({
      id: z.string().transform((s) => s.trim().toUpperCase()),
      bias: lower(["bullish", "bearish", "neutral"]),
      confidence: int,
      horizon: z.string(),
      expectedMovePct: num,
      target: num,
      invalidation: num,
      floor: num,
      ceiling: num,
      timeToTarget: z.string(),
      drivers: z.array(z.object({ factor: z.string(), effect: lower(["bullish", "bearish"]), weight: lower(["low", "medium", "high"]), explanation: z.string() })).default([]),
      scenarios: z.array(z.object({ name: lower(["bull", "base", "bear"]), probability: int, priceTarget: num, description: z.string() })).default([]),
      reasoning: z.string(),
    }),
  ),
});

/** JSON schema for OpenAI-compatible APIs, without keywords some providers reject. */
function jsonSchema(): Record<string, unknown> {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) if (!["$schema", "minimum", "maximum"].includes(k)) out[k] = clean(v);
      return out;
    }
    return node;
  };
  return clean(z.toJSONSchema(Report)) as Record<string, unknown>;
}

// ---- Prompt --------------------------------------------------------------

const SYSTEM = `You are the head of research at a professional multi-asset trading desk covering Bitcoin, Solana, XRP and spot gold (XAU/USD).
You receive a compact quantitative briefing (multi-timeframe technicals, confluence support/resistance zones with strength 0-100, a calibrated model forecast with its historical hit rate, derivatives positioning and sentiment) and the latest headlines on war, geopolitics, central banks, cyber attacks, regulation and institutional flows.

Write the desk's forecast for each asset the way a senior trader would:
- Weigh what actually drives price now: risk regime (risk-on vs risk-off), the dollar and real yields, the central-bank path, wars and geopolitical escalation or de-escalation (gold is a safe haven; crypto usually trades as a risk asset in shocks), hacks and exploits, regulation, ETF and institutional flows, leverage and funding, and technical structure.
- Anchor floor, ceiling, target and invalidation on the supplied zones unless the news clearly justifies a different level; say so in the reasoning when you deviate.
- "floor" = level where a bounce is most likely within the horizon; "ceiling" = level where upside most likely stalls.
- Be calibrated, not dramatic. confidence is an integer 0-100 and should rarely exceed 75. Bull/base/bear probabilities are integers that add up to 100. If evidence is mixed, say neutral.
- horizon is the period your view covers, usually "next 1-3 days". timeToTarget is a plain estimate such as "6-18 hours" or "2-5 days".
- At most 3 drivers per asset, at most 5 keyEvents. reasoning: 3-4 plain-English sentences citing the specific headlines or data behind the view.
- Never invent headlines or data that are not in the briefing. Cover exactly the listed asset ids.
Answer with JSON only, matching the requested schema.`;

const r6 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : String(+x.toPrecision(6)));
const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;

/** Compact text briefing (~3k tokens) so it fits free-tier per-request limits. */
export function buildBriefing(assets: AssetAnalysis[], news: NewsItem[], ctx: { fearGreed: { value: number; label: string } | null; usdInr: number | null }, maxHeadlines = 30): string {
  const lines: string[] = [];
  lines.push(`AS OF ${new Date().toISOString().slice(0, 16)}Z | Crypto Fear&Greed ${ctx.fearGreed ? `${ctx.fearGreed.value} (${ctx.fearGreed.label})` : "n/a"} | USDINR ${ctx.usdInr ?? "n/a"}`);
  for (const a of assets) {
    lines.push("");
    lines.push(`== ${a.id} (${a.name}) price ${r6(a.price)} | 24h ${pct(a.change24hPct)}`);
    lines.push(
      "Timeframes: " +
        a.timeframes
          .map((t) => `${t.tf} score ${t.score.toFixed(2)} pUp ${t.probUp.toFixed(2)} trend ${t.trend}/${t.trendStrength} ${t.structure} RSI ${t.indicators.rsi.toFixed(0)} ADX ${Number.isFinite(t.indicators.adx) ? t.indicators.adx.toFixed(0) : "n/a"} hit ${(t.track.hitRate * 100).toFixed(0)}%`)
          .join(" | "),
    );
    const notes = a.timeframes.flatMap((t) => t.notes.slice(0, 2).map((n) => `${t.tf}: ${n}`)).slice(0, 5);
    if (notes.length) lines.push(`Notes: ${notes.join("; ")}`);
    if (a.testing) lines.push(`Testing now: ${a.testing.kind} ${r6(a.testing.low)}-${r6(a.testing.high)} (s${a.testing.strength})`);
    lines.push(`Supports: ${a.supports.slice(0, 4).map((z) => `${r6(z.low)}-${r6(z.high)}(s${z.strength})`).join(" ") || "none mapped"}`);
    lines.push(`Resistances: ${a.resistances.slice(0, 4).map((z) => `${r6(z.low)}-${r6(z.high)}(s${z.strength})`).join(" ") || "none mapped"}`);
    lines.push(
      "Model: " +
        a.horizons
          .map((h) => `${h.horizonLabel.toLowerCase()} ${h.direction} pUp ${h.probUp.toFixed(2)}${h.direction !== "neutral" ? ` target ${r6(h.target1)} invalid ${r6(h.invalidation)} eta ${h.eta?.label ?? "n/a"}` : ""}`)
          .join(" | "),
    );
    const r24 = a.ranges.find((x) => x.hours === 24);
    const r7 = a.ranges.find((x) => x.hours === 168);
    lines.push(`Expected 1-sigma range: 24h ${r6(r24?.low)}-${r6(r24?.high)}, 7d ${r6(r7?.low)}-${r6(r7?.high)}`);
    const d = a.derivatives;
    lines.push(
      `Derivatives: ${d ? `funding ${d.fundingAnnualPct !== null ? d.fundingAnnualPct.toFixed(1) + "%/yr" : "n/a"}, OI ${d.openInterestUsd ? "$" + (d.openInterestUsd / 1e6).toFixed(0) + "M" : "n/a"}, long/short ${d.longShortRatio ?? "n/a"}` : "n/a"} | rule-based news score ${a.driverScore.toFixed(2)}`,
    );
  }
  lines.push("");
  lines.push("HEADLINES (newest first):");
  for (const n of news.slice(0, maxHeadlines)) {
    lines.push(`- ${new Date(n.publishedAt).toISOString().slice(5, 16)}Z [${n.categories.join(",") || "general"}] ${n.title.slice(0, 140)} (${n.source})`);
  }
  lines.push("");
  lines.push(`Write the desk forecast JSON for asset ids: ${assets.map((a) => a.id).join(", ")}.`);
  return lines.join("\n");
}

// ---- OpenAI-compatible providers (Gemini, Groq) ---------------------------

class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

interface CompatProvider {
  name: "gemini" | "groq";
  baseUrl: string;
  apiKey: string;
  models: string[];
  maxTokensField: "max_tokens" | "max_completion_tokens";
  extra: Record<string, unknown>;
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error("response was not JSON");
  }
}

async function compatChat(p: CompatProvider, model: string, user: string, log: (m: string) => void): Promise<ReportT> {
  const schema = jsonSchema();
  // Ladder: strict JSON schema -> JSON mode -> plain text (JSON extracted). A 400
  // (feature not supported by this model) moves one rung down.
  const rungs: { format: unknown; extra: boolean; hint: boolean }[] = [
    { format: { type: "json_schema", json_schema: { name: "desk_forecast", strict: true, schema } }, extra: true, hint: false },
    { format: { type: "json_object" }, extra: false, hint: true },
    { format: undefined, extra: false, hint: true },
  ];
  let lastErr: Error | null = null;
  for (const rung of rungs) {
    const content = rung.hint ? `${user}\n\nReply with one JSON object that follows this JSON schema exactly:\n${JSON.stringify(schema)}` : user;
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      [p.maxTokensField]: 6000,
      temperature: 0.3,
      ...(rung.extra ? p.extra : {}),
    };
    if (rung.format) body.response_format = rung.format;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180_000);
    let res: Response;
    try {
      res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new ProviderError(`network error: ${(err as Error).message}`, 0);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (res.status === 400 || res.status === 422) {
      lastErr = new ProviderError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
      log(`   ${p.name}/${model}: ${rung.format ? (rung.format as { type: string }).type : "plain"} not accepted, trying a simpler request`);
      continue;
    }
    if (!res.ok) throw new ProviderError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    let data: { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    try {
      data = JSON.parse(text);
    } catch {
      throw new ProviderError("invalid JSON envelope", res.status);
    }
    const choice = data.choices?.[0];
    const out = choice?.message?.content ?? "";
    if (!out.trim()) {
      lastErr = new ProviderError(`empty answer (finish_reason ${choice?.finish_reason ?? "?"})`, 200);
      continue;
    }
    try {
      return LenientReport.parse(extractJson(out)) as ReportT;
    } catch (err) {
      lastErr = new ProviderError(`answer did not match the schema: ${(err as Error).message.slice(0, 200)}`, 200);
      log(`   ${p.name}/${model}: ${lastErr.message}`);
    }
  }
  throw lastErr ?? new ProviderError("no answer", 0);
}

function compatProviders(env: NodeJS.ProcessEnv, modelOverride?: string): Record<"gemini" | "groq", CompatProvider | null> {
  return {
    gemini: env.GEMINI_API_KEY
      ? {
          name: "gemini",
          baseUrl: env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
          apiKey: env.GEMINI_API_KEY,
          // Flash first (better, ~20 free requests/day), then Flash-Lite (~500/day).
          models: modelOverride ? [modelOverride] : ["gemini-flash-latest", "gemini-flash-lite-latest"],
          maxTokensField: "max_tokens",
          extra: { reasoning_effort: "low" },
        }
      : null,
    groq: env.GROQ_API_KEY
      ? {
          name: "groq",
          baseUrl: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
          apiKey: env.GROQ_API_KEY,
          models: modelOverride ? [modelOverride] : ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
          maxTokensField: "max_completion_tokens",
          extra: { reasoning_effort: "low" },
        }
      : null,
  };
}

// ---- Claude (paid) ----------------------------------------------------------

async function claudeChat(user: string, model: string): Promise<{ report: ReportT; model: string }> {
  const client = new Anthropic({ timeout: 300_000, maxRetries: 2 });
  const msg = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(Report) },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  if (msg.stop_reason === "refusal") throw new ProviderError(`declined: ${msg.stop_details?.explanation ?? "refusal"}`, 200);
  if (msg.stop_reason === "max_tokens") throw new ProviderError("output was cut off (max_tokens)", 200);
  if (!msg.parsed_output) throw new ProviderError("no parseable output", 200);
  return { report: msg.parsed_output, model: msg.model };
}

// ---- Entry point ------------------------------------------------------------

export function availableProviders(env: NodeJS.ProcessEnv): AiProviderName[] {
  const out: AiProviderName[] = [];
  if (env.GEMINI_API_KEY) out.push("gemini");
  if (env.GROQ_API_KEY) out.push("groq");
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) out.push("anthropic");
  return out;
}

export async function runAiAnalyst(
  assets: AssetAnalysis[],
  news: NewsItem[],
  context: { fearGreed: { value: number; label: string } | null; usdInr: number | null },
  opts: { provider?: string; model?: string; env?: NodeJS.ProcessEnv; log?: (m: string) => void } = {},
): Promise<AiReport> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const available = availableProviders(env);
  const preferred = (opts.provider ?? "auto").toLowerCase();
  // "auto": free providers first. A named provider goes first, others remain as fallback.
  const order: AiProviderName[] = preferred !== "auto" && available.includes(preferred as AiProviderName)
    ? [preferred as AiProviderName, ...available.filter((p) => p !== preferred)]
    : available;
  if (!order.length) throw new Error("no AI provider key configured (GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY)");

  const user = buildBriefing(assets, news, context);
  const compat = compatProviders(env, preferred !== "auto" ? opts.model : undefined);
  const errors: string[] = [];
  for (const name of order) {
    if (name === "anthropic") {
      try {
        log(`   trying Claude ${opts.model && preferred === "anthropic" ? opts.model : CLAUDE_MODEL}`);
        const { report, model } = await claudeChat(user, opts.model && preferred === "anthropic" ? opts.model : CLAUDE_MODEL);
        return finish(report, assets, "anthropic", model);
      } catch (err) {
        errors.push(`anthropic: ${(err as Error).message}`);
        log(`   Claude failed: ${(err as Error).message.slice(0, 200)}`);
      }
      continue;
    }
    const p = compat[name];
    if (!p) continue;
    for (const model of p.models) {
      try {
        log(`   trying ${name}/${model}`);
        const report = await compatChat(p, model, user, log);
        return finish(report, assets, name, model);
      } catch (err) {
        const e = err as ProviderError;
        errors.push(`${name}/${model}: ${e.message.slice(0, 160)}`);
        log(`   ${name}/${model} failed (${e.status === 429 ? "free quota used up / rate limited" : e.message.slice(0, 160)})`);
        if (e.status === 401 || e.status === 403) break; // bad key: other models won't work either
      }
    }
  }
  throw new Error(`all AI providers failed: ${errors.join(" | ")}`);
}

function finish(parsed: ReportT, assets: AssetAnalysis[], provider: AiProviderName, model: string): AiReport {
  const ids = new Set(assets.map((a) => a.id));
  const views = parsed.assets.filter((v) => ids.has(v.id));
  if (!views.length) throw new ProviderError("answer covered none of the assets", 200);
  return {
    generatedAt: Date.now(),
    model,
    provider: PROVIDER_LABEL[provider],
    marketSummary: parsed.marketSummary,
    riskRegime: parsed.riskRegime,
    keyEvents: parsed.keyEvents.slice(0, 8),
    assets: views.map((v) => ({
      ...v,
      confidence: Math.max(0, Math.min(100, v.confidence)),
      drivers: v.drivers.slice(0, 4),
      scenarios: v.scenarios.slice(0, 3),
    })),
  };
}
