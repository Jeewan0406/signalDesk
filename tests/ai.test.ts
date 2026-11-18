import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBriefing, runAiAnalyst } from "../server/ai";
import { analyzeFromCandles } from "../src/core/analyze";
import { getAsset } from "../src/core/assets";
import type { AssetAnalysis, Candle, NewsItem } from "../src/core/types";

// ---- fixtures -------------------------------------------------------------
const now = Date.UTC(2026, 10, 18, 7, 0);
function series(n: number, step: number, base: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = base * Math.exp(0.0003 * i + 0.02 * Math.sin(i / 9));
    return { t: now - (n - i) * step, o: c, h: c * 1.003, l: c * 0.997, c, v: 100 + (i % 5) * 20 };
  });
}
function analysis(id: string, base: number): AssetAnalysis {
  const set = { "15m": series(400, 900_000, base), "1h": series(500, 3_600_000, base), "4h": series(500, 14_400_000, base), "1d": series(400, 86_400_000, base) };
  return analyzeFromCandles(getAsset(id)!, set, "test", { now });
}
const assets = [analysis("BTC", 64000), analysis("SOL", 75), analysis("XRP", 0.99), analysis("GOLD", 3770)];
const news: NewsItem[] = Array.from({ length: 40 }, (_, i) => ({
  title: `Headline number ${i} about missiles, the Fed and bitcoin ETF flows in a long sentence for size testing`,
  url: "",
  source: "Test",
  publishedAt: now - i * 600_000,
  categories: ["war", "monetary"],
  sentiment: -0.3,
  assets: ["BTC"],
}));

const view = (id: string, loose = false) => ({
  id: loose ? id.toLowerCase() : id,
  bias: loose ? "Bullish" : "bullish",
  confidence: loose ? "61" : 61,
  horizon: "next 1-3 days",
  expectedMovePct: 2.1,
  target: 100,
  invalidation: 90,
  floor: 92,
  ceiling: 104,
  timeToTarget: "6-18 hours",
  drivers: [{ factor: "ETF inflows", effect: "bullish", weight: "medium", explanation: "x" }],
  scenarios: [
    { name: "bull", probability: 30, priceTarget: 106, description: "a" },
    { name: "base", probability: 50, priceTarget: 100, description: "b" },
    { name: "bear", probability: 20, priceTarget: 90, description: "c" },
  ],
  reasoning: "Because.",
});
const report = (loose = false) => ({
  marketSummary: "Risk-off on Gulf escalation.",
  riskRegime: loose ? "Risk-Off" : "risk-off",
  keyEvents: [{ headline: "h", category: "war", impact: "gold up", assets: ["GOLD"] }],
  assets: ["BTC", "SOL", "XRP", "GOLD"].map((id) => view(id, loose)),
});

// ---- mock OpenAI-compatible server ------------------------------------------
type Handler = (path: string, body: Record<string, unknown>) => { status: number; json: unknown };
let handler: Handler = () => ({ status: 500, json: {} });
const calls: { path: string; model: string; format: string | undefined }[] = [];
let base = "";
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    calls.push({ path: req.url ?? "", model: body.model, format: (body.response_format as { type?: string } | undefined)?.type });
    const out = handler(req.url ?? "", body);
    res.writeHead(out.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out.json));
  });
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const ok = (content: unknown) => ({ status: 200, json: { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }] } });
const env = () => ({ GEMINI_API_KEY: "g", GEMINI_BASE_URL: `${base}/gemini`, GROQ_API_KEY: "q", GROQ_BASE_URL: `${base}/groq` }) as NodeJS.ProcessEnv;
const ctx = { fearGreed: { value: 11, label: "Extreme Fear" }, usdInr: 103.2 };

describe("AI analyst providers", () => {
  it("keeps the briefing small enough for free-tier request limits", () => {
    const b = buildBriefing(assets, news, ctx);
    // ~4 characters per token: stay well under Groq's 8k tokens/minute incl. the answer.
    expect(b.length).toBeLessThan(16000);
    expect(b).toContain("== BTC");
    expect(b).toContain("HEADLINES");
  });

  it("falls back from Gemini Flash (quota used) to Flash-Lite", async () => {
    calls.length = 0;
    handler = (_p, body) => (body.model === "gemini-flash-latest" ? { status: 429, json: { error: "quota" } } : ok(report()));
    const r = await runAiAnalyst(assets, news, ctx, { env: env() });
    expect(r.model).toBe("gemini-flash-lite-latest");
    expect(r.provider).toContain("Gemini");
    expect(r.assets).toHaveLength(4);
    expect(calls[0].format).toBe("json_schema");
  });

  it("drops to JSON mode when strict schema is not supported, and accepts loose formatting", async () => {
    calls.length = 0;
    handler = (_p, body) => ((body.response_format as { type: string } | undefined)?.type === "json_schema" ? { status: 400, json: { error: "unsupported" } } : ok("Here you go:\n" + JSON.stringify(report(true))));
    const r = await runAiAnalyst(assets, news, ctx, { env: env() });
    expect(calls.map((c) => c.format)).toEqual(["json_schema", "json_object"]);
    expect(r.riskRegime).toBe("risk-off");
    expect(r.assets[0].bias).toBe("bullish");
    expect(r.assets[0].confidence).toBe(61);
    expect(r.assets.map((a) => a.id)).toContain("BTC");
  });

  it("moves to Groq when the Gemini key is rejected", async () => {
    calls.length = 0;
    handler = (path) => (path.startsWith("/gemini") ? { status: 401, json: { error: "bad key" } } : ok(report()));
    const r = await runAiAnalyst(assets, news, ctx, { env: env() });
    expect(r.provider).toContain("Groq");
    expect(r.model).toBe("openai/gpt-oss-120b");
    // A rejected key is not retried with the second Gemini model.
    expect(calls.filter((c) => c.path.startsWith("/gemini"))).toHaveLength(1);
  });

  it("reports a clear error when every provider fails", async () => {
    handler = () => ({ status: 429, json: { error: "quota" } });
    await expect(runAiAnalyst(assets, news, ctx, { env: env() })).rejects.toThrow(/all AI providers failed/);
  });

  it("needs at least one key", async () => {
    await expect(runAiAnalyst(assets, news, ctx, { env: {} as NodeJS.ProcessEnv })).rejects.toThrow(/no AI provider key/);
  });
});
