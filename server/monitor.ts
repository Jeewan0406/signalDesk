// SignalDesk 24/7 monitor. GitHub Actions runs this every 5 minutes:
//   1. fetch prices, derivatives, sentiment, USD/INR and news
//   2. run the full analysis for every enabled asset
//   3. ask the AI analyst for an updated view (every few hours, or on big moves)
//   4. fire floor/ceiling/custom alarms through ntfy push notifications
//   5. publish latest.json for the apps and save state for the next run
//
// Usage: tsx server/monitor.ts [--dry-run] [--out data] [--alerts config/alerts.json] [--settings config/settings.json] [--no-news] [--no-ai]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyzeFromCandles, fetchCandleSet } from "../src/core/analyze";
import { ENABLED_ASSETS } from "../src/core/assets";
import { fetchCandles, fetchDerivatives, fetchFearGreed, fetchUsdInr } from "../src/core/providers";
import type { AssetAnalysis, CustomAlert, FiredAlert, NewsItem, PublishedSnapshot } from "../src/core/types";
import { availableProviders, runAiAnalyst } from "./ai";
import { emptyState, evaluateAlerts, memoFromAnalysis, type MonitorState } from "./alerts";
import { collectNews } from "./news";
import { sendNtfy } from "./notify";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const DRY = flag("dry-run");
const OUT = opt("out", "data");
const STATE_FILE = join(OUT, "state.json");
const ALERTS_FILE = opt("alerts", "config/alerts.json");
const SETTINGS_FILE = opt("settings", "config/settings.json");
const env = process.env;
const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

/**
 * Server settings. Change them from the app (Settings → 24/7 server settings),
 * by editing config/settings.json on GitHub, or with repository variables
 * (AI_INTERVAL_MINUTES, ALERT_APPROACH), which take priority when set.
 */
interface ServerSettings {
  /** Minutes between AI analyst runs. 0 = AI off. */
  aiIntervalMinutes?: number;
  /** Also send "approaching floor/ceiling" heads-up alarms. */
  approachAlerts?: boolean;
  /** auto (free providers first) | gemini | groq | anthropic */
  aiProvider?: string;
  /** Optional model name for the chosen provider. */
  aiModel?: string;
}
const fileSettings = readJson<ServerSettings>(SETTINGS_FILE, {});
const envInterval = env.AI_INTERVAL_MINUTES?.trim();
const AI_INTERVAL_MIN = Math.max(0, envInterval ? Number(envInterval) : Number(fileSettings.aiIntervalMinutes ?? 30)) || 0;
const MONITOR_INTERVAL_MIN = Number(env.MONITOR_INTERVAL_MINUTES || 5);
const AI_PROVIDERS = availableProviders(env);
const AI_KEY_PRESENT = AI_PROVIDERS.length > 0;
const AI_PROVIDER = (env.AI_PROVIDER?.trim() || fileSettings.aiProvider || "auto").toLowerCase();
const AI_MODEL_OVERRIDE = env.AI_MODEL?.trim() || fileSettings.aiModel || undefined;
const AI_ENABLED = !flag("no-ai") && AI_KEY_PRESENT && AI_INTERVAL_MIN > 0;
const envApproach = env.ALERT_APPROACH?.trim();
const APPROACH = envApproach ? envApproach === "true" : !!fileSettings.approachAlerts;

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
  } catch (err) {
    log(`Could not read ${file}: ${(err as Error).message}`);
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}

async function main() {
  const started = Date.now();
  const now = started;
  const state = { ...emptyState(), ...readJson<MonitorState>(STATE_FILE, emptyState()) };
  const custom = readJson<CustomAlert[]>(ALERTS_FILE, []).filter((c) => c && c.id && c.asset && Number.isFinite(c.price));
  log(`Settings: AI every ${AI_INTERVAL_MIN || "off"} min, provider ${AI_PROVIDER} (keys: ${AI_PROVIDERS.join(", ") || "none"}), approach alarms ${APPROACH ? "on" : "off"}`);
  log(`Monitor start. dry-run=${DRY} ai=${AI_ENABLED} assets=${ENABLED_ASSETS.map((a) => a.id).join(",")} custom-alerts=${custom.length}`);

  // --- Context: sentiment, FX, news ------------------------------------
  const gdeltDue = !state.gdelt || now - state.gdelt.at > 30 * 60_000;
  const [fearGreed, usdInr, news] = await Promise.all([
    fetchFearGreed(),
    fetchUsdInr(),
    flag("no-news") ? Promise.resolve([] as NewsItem[]) : collectNews({ gdelt: gdeltDue, log }),
  ]);
  let allNews = news;
  if (gdeltDue) {
    state.gdelt = { at: now, items: news.filter((n) => n.source.startsWith("GDELT")) };
  } else if (state.gdelt) {
    const seen = new Set(news.map((n) => n.title));
    allNews = [...news, ...state.gdelt.items.filter((n) => !seen.has(n.title))].sort((a, b) => b.publishedAt - a.publishedAt);
  }
  log(`Context: F&G=${fearGreed?.value ?? "n/a"} USDINR=${usdInr ?? "n/a"} news=${allNews.length}`);

  // --- Analysis ----------------------------------------------------------
  const aiAgeHours = state.ai ? (now - state.ai.generatedAt) / 3_600_000 : undefined;
  const aiFor = (id: string) => state.ai?.assets.find((v) => v.id === id) ?? null;
  const results = await Promise.allSettled(
    ENABLED_ASSETS.map(async (asset) => {
      const [{ set, source }, derivatives, minute] = await Promise.all([
        fetchCandleSet(asset),
        fetchDerivatives(asset).catch(() => null),
        fetchCandles(asset, "1m", 40).catch(() => null),
      ]);
      const extras = { news: allNews, derivatives, fearGreed, now };
      const analysis = analyzeFromCandles(asset, set, source, { ...extras, ai: aiFor(asset.id), aiAgeHours });
      return { asset, set, source, extras, analysis, minute: minute?.candles ?? [] };
    }),
  );
  const ok = results.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    log(`!! ${ENABLED_ASSETS[i].id} failed: ${(r.reason as Error).message}`);
    return [];
  });
  for (const r of ok) {
    const a = r.analysis;
    log(
      `${a.id.padEnd(4)} ${a.price} (${a.change24hPct.toFixed(2)}%) via ${a.source} | swing ${a.forecast.direction} ${(a.forecast.probUp * 100).toFixed(0)}% | ` +
        `floor ${a.floor ? `${a.floor.zone.low.toPrecision(6)}-${a.floor.zone.high.toPrecision(6)}` : "-"} ceiling ${a.ceiling ? `${a.ceiling.zone.low.toPrecision(6)}-${a.ceiling.zone.high.toPrecision(6)}` : "-"}`,
    );
  }

  // --- Alarms --------------------------------------------------------------
  const fired: FiredAlert[] = [];
  for (const r of ok) {
    const alerts = evaluateAlerts({
      asset: r.asset,
      analysis: r.analysis,
      prev: state.assets[r.asset.id],
      recent: r.minute,
      custom,
      state,
      now,
      approach: APPROACH,
    });
    fired.push(...alerts);
  }

  // --- AI analyst ------------------------------------------------------------
  const bigEvent = fired.some((f) => f.kind !== "approach-floor" && f.kind !== "approach-ceiling");
  const sinceAiMin = (now - state.lastAiAt) / 60_000;
  const aiDue = AI_ENABLED && ok.length > 0 && (sinceAiMin >= AI_INTERVAL_MIN || (bigEvent && sinceAiMin >= Math.min(45, AI_INTERVAL_MIN)));
  let finalAnalyses: AssetAnalysis[] = ok.map((r) => r.analysis);
  if (aiDue) {
    state.lastAiAt = now; // also on failure, to avoid retrying (and paying) every 5 minutes
    try {
      log(`Running AI analyst (${AI_PROVIDER})${bigEvent ? " — triggered by an alarm" : ""}...`);
      const report = await runAiAnalyst(finalAnalyses, allNews, { fearGreed, usdInr }, { provider: AI_PROVIDER, model: AI_MODEL_OVERRIDE, log });
      state.ai = report;
      state.lastAiError = undefined;
      log(`AI done via ${report.provider} / ${report.model}: ${report.riskRegime}; ${report.assets.map((v) => `${v.id} ${v.bias} ${v.confidence}`).join(", ")}`);
      // Re-run the (cheap) forecast so the new AI view is blended in.
      finalAnalyses = ok.map((r) =>
        analyzeFromCandles(r.asset, r.set, r.source, { ...r.extras, ai: report.assets.find((v) => v.id === r.asset.id) ?? null, aiAgeHours: 0 }),
      );
    } catch (err) {
      state.lastAiError = `${new Date(now).toISOString()}: ${(err as Error).message}`;
      log(`AI analyst failed: ${(err as Error).message}`);
    }
  } else if (AI_ENABLED) {
    log(`AI analyst next run in ${Math.max(0, AI_INTERVAL_MIN - sinceAiMin).toFixed(0)} min`);
  }

  for (const a of finalAnalyses) state.assets[a.id] = memoFromAnalysis(a, now);

  // --- Notifications -----------------------------------------------------
  const topic = env.NTFY_TOPIC?.trim();
  for (const f of fired) {
    log(`ALARM ${f.title}`);
    if (DRY) continue;
    if (!topic) {
      log("   (NTFY_TOPIC not set: not sent)");
      continue;
    }
    try {
      await sendNtfy({ server: env.NTFY_SERVER || "https://ntfy.sh", topic, token: env.NTFY_TOKEN || undefined, clickUrl: env.APP_URL || undefined }, f);
    } catch (err) {
      log(`   ntfy failed: ${(err as Error).message}`);
    }
  }
  state.recent = [...fired, ...state.recent].slice(0, 60);
  // Forget cooldown keys older than 2 days.
  for (const [k, t] of Object.entries(state.fired)) if (now - t > 48 * 3_600_000) delete state.fired[k];
  state.lastRunAt = now;

  // --- Publish -------------------------------------------------------------
  const snapshot: PublishedSnapshot = {
    version: 1,
    generatedAt: now,
    usdInr,
    fearGreed,
    assets: Object.fromEntries(finalAnalyses.map((a) => [a.id, a])),
    news: allNews.slice(0, 80),
    ai: state.ai,
    alerts: state.recent,
    monitor: {
      intervalMinutes: MONITOR_INTERVAL_MIN,
      aiIntervalMinutes: AI_INTERVAL_MIN,
      aiEnabled: AI_ENABLED,
      aiKeyPresent: AI_KEY_PRESENT,
      approachAlerts: APPROACH,
      aiProvider: AI_PROVIDER,
      aiProvidersAvailable: AI_PROVIDERS,
      lastAiError: state.lastAiError,
    },
  };
  writeJson(join(OUT, "latest.json"), snapshot);
  writeJson(STATE_FILE, state);
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s. ${fired.length} alarm(s). Wrote ${join(OUT, "latest.json")}`);
  if (!ok.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
