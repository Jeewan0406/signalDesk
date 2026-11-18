import { useEffect, useState } from "react";
import { ASSETS } from "../../core/assets";
import { timeAgo } from "../../core/format";
import { Card } from "../components/common";
import { isIos, isStandalonePwa, platform } from "../platform";
import { aiCostPerDay, saveServerSettings } from "../settings";
import { store, useMarket } from "../store";

const PROVIDERS = [
  { v: "auto", label: "Auto — free providers first" },
  { v: "gemini", label: "Google Gemini (free)" },
  { v: "groq", label: "Groq gpt-oss (free)" },
  { v: "anthropic", label: "Claude (paid)" },
];

const AI_OPTIONS = [
  { v: 0, label: "Off" },
  { v: 15, label: "Every 15 minutes" },
  { v: 30, label: "Every 30 minutes" },
  { v: 60, label: "Every hour" },
  { v: 120, label: "Every 2 hours" },
  { v: 240, label: "Every 4 hours" },
  { v: 480, label: "Every 8 hours" },
  { v: 1440, label: "Once a day" },
];

export function SettingsPage() {
  const m = useMarket();
  const s = m.settings;
  const [dataUrl, setDataUrl] = useState(s.dataUrl);
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const srv = m.snapshot?.monitor;
  const [aiInterval, setAiInterval] = useState<number>(srv?.aiIntervalMinutes ?? 30);
  const [approach, setApproach] = useState<boolean>(srv?.approachAlerts ?? false);
  const [provider, setProvider] = useState<string>(srv?.aiProvider ?? "auto");
  const [srvMsg, setSrvMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Show the server's current values once its snapshot arrives.
  useEffect(() => {
    if (srv) {
      setAiInterval(srv.aiIntervalMinutes);
      setApproach(!!srv.approachAlerts);
      setProvider(srv.aiProvider ?? "auto");
    }
  }, [srv?.aiIntervalMinutes, srv?.approachAlerts, srv?.aiProvider]);
  const keys = srv?.aiProvidersAvailable ?? [];
  // Which provider will actually answer (first one with a key, in order).
  const effective = provider !== "auto" && keys.includes(provider) ? provider : (["gemini", "groq", "anthropic"].find((k) => keys.includes(k)) ?? (provider === "auto" ? "gemini" : provider));
  const runsPerDay = aiInterval ? Math.round(1440 / aiInterval) : 0;
  const [lo, hi] = aiCostPerDay(aiInterval);
  const saveServer = async () => {
    setSaving(true);
    try {
      await saveServerSettings(s, { aiProvider: provider, aiIntervalMinutes: aiInterval, approachAlerts: approach });
      setSrvMsg("Saved. The 24/7 server uses the new settings from its next run (within about 5 minutes).");
    } catch (e) {
      setSrvMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const p = platform();
  useEffect(() => {
    if (p === "electron") void window.signaldeskNative!.getAutoLaunch().then(setAutoLaunch);
  }, [p]);

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Running as: {p === "web" ? (isStandalonePwa() ? "installed web app" : "website") : p === "electron" ? "desktop app" : "Android app"}</p>

      <div className="grid g-2">
        <Card title="Display">
          <div className="toggle">
            <span className="small bold">Currency</span>
            <span className="seg">
              {(["usd", "inr", "both"] as const).map((c) => (
                <button key={c} className={s.currency === c ? "on" : ""} onClick={() => store.updateSettings({ currency: c })}>
                  {c === "both" ? "USD + INR" : c.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
          <div className="toggle">
            <span className="small bold">Theme</span>
            <span className="seg">
              {(["dark", "light"] as const).map((t) => (
                <button key={t} className={s.theme === t ? "on" : ""} onClick={() => store.updateSettings({ theme: t })}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </span>
          </div>
          {p === "electron" && autoLaunch !== null && (
            <div className="toggle">
              <div>
                <div className="small bold">Start with my computer</div>
                <div className="tiny muted">Keeps SignalDesk running in the tray so in-app alarms are always on.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={autoLaunch}
                  onChange={(e) => {
                    const on = e.target.checked;
                    void window.signaldeskNative!.setAutoLaunch(on).then(() => setAutoLaunch(on));
                  }}
                />
                <span />
              </label>
            </div>
          )}
        </Card>

        <Card title="Data source (24/7 server)">
          <p className="small muted" style={{ marginTop: 0 }}>
            The address of <code className="inline">latest.json</code> published by your GitHub server. It provides news, AI analysis, the INR rate and the 24/7 alarm history.
            Prices and technical analysis always come live from the exchanges.
          </p>
          <div className="row">
            <input className="grow" value={dataUrl} placeholder="https://raw.githubusercontent.com/<you>/<repo>/data/latest.json" onChange={(e) => setDataUrl(e.target.value.trim())} />
            <button className="btn sm primary" onClick={() => store.updateSettings({ dataUrl })}>
              Save
            </button>
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            {m.snapshot ? `Connected · server updated ${timeAgo(m.snapshot.generatedAt)}` : m.snapshotError ?? "Not connected"}
          </div>
        </Card>

        <Card title="24/7 server settings">
          <div className="stack" style={{ gap: 10 }}>
            <label className="field">
              AI provider
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {PROVIDERS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              AI analyst runs
              <select value={aiInterval} onChange={(e) => setAiInterval(Number(e.target.value))}>
                {AI_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="small muted">
              {!aiInterval
                ? "The AI analyst is off. Technical analysis, news drivers and alarms keep working."
                : effective === "anthropic"
                  ? `About ${runsPerDay} runs a day ≈ $${lo.toFixed(2)}–$${hi.toFixed(2)} per day on your Anthropic API key, plus an extra run right after a floor/ceiling alarm.`
                  : effective === "groq"
                    ? `Free. About ${runsPerDay} runs a day.${runsPerDay > 24 ? " Groq's free daily token allowance fits about 25 runs, so choose every hour or slower (or keep Gemini as the main provider)." : ""}`
                    : `Free (Google Gemini free tier). About ${runsPerDay} runs a day: the stronger Flash model is used while its small daily quota lasts (about 20), then Flash-Lite (about 500 a day).`}
            </div>
            <div className="toggle" style={{ paddingTop: 0 }}>
              <div>
                <div className="small bold">“Approaching” heads-up alarms</div>
                <div className="tiny muted">Push alarm when price gets close to a floor or ceiling, before it arrives.</div>
              </div>
              <label className="switch">
                <input type="checkbox" checked={approach} onChange={(e) => setApproach(e.target.checked)} />
                <span />
              </label>
            </div>
            <div className="row wrap">
              <button className="btn sm primary" disabled={saving || !s.githubToken || !s.githubRepo} onClick={() => void saveServer()}>
                {saving ? "Saving…" : "Save to 24/7 server"}
              </button>
              {(!s.githubToken || !s.githubRepo) && <span className="tiny muted">Needs the GitHub sync token below.</span>}
            </div>
            {srvMsg && <div className="notice info small">{srvMsg}</div>}
            {srv?.lastAiError && <div className="notice warn small">Last AI problem: {srv.lastAiError.slice(0, 300)}</div>}
            <div className="tiny faint">
              {srv
                ? `Server now: AI ${srv.aiIntervalMinutes ? `every ${srv.aiIntervalMinutes} min` : "off"} · provider ${srv.aiProvider ?? "auto"} · keys: ${keys.length ? keys.join(", ") : "none yet (add GEMINI_API_KEY)"} · heads-up alarms ${srv.approachAlerts ? "on" : "off"}.`
                : "Server not connected yet."}{" "}
              You can also edit config/settings.json on GitHub.
            </div>
          </div>
        </Card>

        <Card title="GitHub sync (optional)">
          <p className="small muted" style={{ marginTop: 0 }}>
            Lets the app save your price alerts and server settings to the 24/7 server. Use a fine-grained token with <b>Contents: read and write</b> on this one repository only. It is stored only
            on this device.
          </p>
          <div className="stack" style={{ gap: 8 }}>
            <label className="field">
              Repository (owner/name)
              <input value={s.githubRepo} onChange={(e) => store.updateSettings({ githubRepo: e.target.value.trim() })} placeholder="yourname/signaldesk" />
            </label>
            <label className="field">
              Token
              <input type="password" value={s.githubToken} onChange={(e) => store.updateSettings({ githubToken: e.target.value.trim() })} placeholder="github_pat_…" />
            </label>
          </div>
        </Card>

        <Card title="Setup guide">
          <p className="small muted" style={{ marginTop: 0 }}>
            One-time setup (about 15 minutes): web app, 24/7 alarms with ntfy, the AI analyst, and the Windows / Mac / Android installers.
          </p>
          {s.githubRepo ? (
            <a className="btn sm" href={`https://github.com/${s.githubRepo}/blob/main/docs/SETUP.md`} target="_blank" rel="noreferrer">
              Open the setup guide
            </a>
          ) : (
            <span className="small">
              See <code className="inline">docs/SETUP.md</code> in the SignalDesk repository.
            </span>
          )}
        </Card>

        <Card title="Install on your devices">
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>
              <b>iPhone:</b> open this site in Safari → Share → <i>Add to Home Screen</i>. {isIos() && !isStandalonePwa() ? "(You are on iPhone now.)" : ""}
            </li>
            <li>
              <b>Android:</b> install the APK from the GitHub release, or in Chrome use menu → <i>Install app</i>.
            </li>
            <li>
              <b>Windows / Mac:</b> download the installer from the GitHub release (<i>SignalDesk-Setup.exe</i> / <i>.dmg</i>).
            </li>
          </ul>
        </Card>

        <Card title="Assets">
          <p className="small muted" style={{ marginTop: 0 }}>
            Enabled now: {ASSETS.filter((a) => a.enabled).map((a) => a.name).join(", ")}. More coins can be switched on in <code className="inline">src/core/assets.ts</code>{" "}
            (one line each). {ASSETS.filter((a) => !a.enabled).map((a) => a.name).join(", ")} is already prepared.
          </p>
        </Card>

        <Card title="About the forecasts">
          <p className="small muted" style={{ margin: 0 }}>
            SignalDesk combines what professional traders use: multi-timeframe trend, momentum and market structure, confluence support/resistance (swings, volume profile,
            Fibonacci, key moving averages, pivots), volatility, futures positioning, sentiment and world events, plus an AI analyst. Probabilities are calibrated against each
            market's own history and shown with their track record. No method can guarantee that a price will not go lower or higher; floors and ceilings are the most likely
            turning zones, not certainties.
          </p>
        </Card>
      </div>
      <p className="disclaimer">SignalDesk is an analysis tool, not financial advice. Trading involves risk of loss. Always use your own judgement and a stop-loss.</p>
    </>
  );
}
