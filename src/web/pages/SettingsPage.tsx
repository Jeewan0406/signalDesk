import { useEffect, useState } from "react";
import { ASSETS } from "../../core/assets";
import { timeAgo } from "../../core/format";
import { Card } from "../components/common";
import { isIos, isStandalonePwa, platform } from "../platform";
import { store, useMarket } from "../store";

export function SettingsPage() {
  const m = useMarket();
  const s = m.settings;
  const [dataUrl, setDataUrl] = useState(s.dataUrl);
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
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

        <Card title="GitHub sync (optional)">
          <p className="small muted" style={{ marginTop: 0 }}>
            Lets the app save your price alerts to the 24/7 server. Use a fine-grained token with <b>Contents: read and write</b> on this one repository only. It is stored only
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
