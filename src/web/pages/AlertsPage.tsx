import { useEffect, useState } from "react";
import { ENABLED_ASSETS, getAsset } from "../../core/assets";
import { formatUsd, timeAgo } from "../../core/format";
import type { CustomAlert } from "../../core/types";
import { Card } from "../components/common";
import { notificationPermission, requestNotificationPermission, showNotification } from "../platform";
import { randomTopic, sendTestPush, syncAlertsToGithub } from "../settings";
import { currentPrice, store, useMarket } from "../store";
import { AlertRow } from "./Dashboard";

function Toggle({ label, hint, on, set }: { label: string; hint?: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="toggle">
      <div>
        <div className="small bold">{label}</div>
        {hint && <div className="tiny muted">{hint}</div>}
      </div>
      <label className="switch">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
        <span />
      </label>
    </div>
  );
}

export function AlertsPage() {
  const m = useMarket();
  const s = m.settings;
  const snap = m.snapshot;
  const [perm, setPerm] = useState<string>("default");
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<{ asset: string; type: "above" | "below"; price: string; note: string; repeat: boolean }>({
    asset: ENABLED_ASSETS[0].id,
    type: "below",
    price: "",
    note: "",
    repeat: false,
  });
  useEffect(() => {
    void notificationPermission().then(setPerm);
  }, []);

  const serverFresh = snap && Date.now() - snap.generatedAt < 30 * 60_000;
  const history = [...(snap?.alerts ?? []).map((a) => ({ ...a, via: "24/7 server" })), ...m.localAlerts.map((a) => ({ ...a, via: "this device" }))].sort((x, y) => y.at - x.at);

  const addAlert = () => {
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) {
      setMsg("Enter a valid price.");
      return;
    }
    const alert: CustomAlert = { id: `${form.asset}-${Date.now().toString(36)}`, asset: form.asset, type: form.type, price, note: form.note || undefined, repeat: form.repeat };
    store.updateSettings({ customAlerts: [...s.customAlerts, alert] });
    setForm({ ...form, price: "", note: "" });
    setMsg(s.githubToken ? "Alert added. Press “Sync to 24/7 server” so it also fires when the app is closed." : "Alert added on this device.");
  };

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const asset = getAsset(form.asset)!;
  const live = currentPrice(m.assets[form.asset]);

  return (
    <>
      <h1 className="page-title">Alarms</h1>
      <p className="page-sub">You get an alarm when the price reaches a predicted floor (likely bounce) or ceiling (likely stall), when a level breaks, or at your own prices.</p>
      {msg && (
        <div className="notice info small" style={{ marginBottom: 14 }} onClick={() => setMsg(null)}>
          {msg}
        </div>
      )}

      <div className="grid g-2">
        <Card title="24/7 alarms (app closed)">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className={`dot ${serverFresh ? "on" : snap ? "warn" : ""}`} />
            <span className="small bold">
              {serverFresh ? `Server running · last check ${timeAgo(snap!.generatedAt)}` : snap ? `Server data is old (${timeAgo(snap.generatedAt)})` : "Server not connected"}
            </span>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            A free GitHub server checks every market about every 5 minutes, day and night, and sends alarms to the <b>ntfy</b> app on your phone and computer, even when
            SignalDesk is closed.
          </p>
          <ol className="steps small">
            <li>
              <span>
                Install <b>ntfy</b>:{" "}
                <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noreferrer">
                  iPhone
                </a>{" "}
                ·{" "}
                <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noreferrer">
                  Android
                </a>{" "}
                ·{" "}
                <a href="https://ntfy.sh/app" target="_blank" rel="noreferrer">
                  Windows / Mac (web app)
                </a>
              </span>
            </li>
            <li>
              <div className="stack" style={{ gap: 6 }}>
                <span>Your private alarm channel (keep it secret):</span>
                <div className="row">
                  <input className="grow" value={s.ntfyTopic} placeholder="Press Generate" onChange={(e) => store.updateSettings({ ntfyTopic: e.target.value.trim() })} />
                  <button className="btn sm" onClick={() => store.updateSettings({ ntfyTopic: randomTopic() })}>
                    Generate
                  </button>
                  <button className="btn sm" disabled={!s.ntfyTopic} onClick={() => void run(() => navigator.clipboard.writeText(s.ntfyTopic), "Copied.")}>
                    Copy
                  </button>
                </div>
              </div>
            </li>
            <li>
              <span>In the ntfy app tap “+”, then subscribe to that channel name.</span>
            </li>
            <li>
              <span>
                In your GitHub repository: Settings → Secrets and variables → Actions → New secret named <code className="inline">NTFY_TOPIC</code> with the same channel
                name.
              </span>
            </li>
          </ol>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary sm" disabled={!s.ntfyTopic} onClick={() => void run(() => sendTestPush(s), "Test alarm sent. It should appear in the ntfy app within seconds.")}>
              Send test alarm
            </button>
          </div>
        </Card>

        <Card title="Alarms on this device">
          <Toggle label="In-app alarms" hint="Pop-up + sound while SignalDesk is open (desktop app keeps running in the tray)." on={s.inAppAlarms} set={(v) => store.updateSettings({ inAppAlarms: v })} />
          <Toggle label="Alarm sound" on={s.alarmSound} set={(v) => store.updateSettings({ alarmSound: v })} />
          <Toggle label="“Approaching” heads-up" hint="Extra alert when price gets close to a floor or ceiling." on={s.approachAlarms} set={(v) => store.updateSettings({ approachAlarms: v })} />
          <div className="toggle">
            <div>
              <div className="small bold">System notifications</div>
              <div className="tiny muted">Permission: {perm}</div>
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => void requestNotificationPermission().then(() => notificationPermission().then(setPerm))}>
                Allow
              </button>
              <button className="btn sm" onClick={() => void showNotification("SignalDesk", "Notifications are working.")}>
                Test
              </button>
            </div>
          </div>
        </Card>
      </div>

      <div style={{ height: 16 }} />
      <Card title="Your price alerts" right={<span className="tiny faint">{s.customAlerts.length} active</span>}>
        <div className="row wrap" style={{ alignItems: "flex-end", gap: 10 }}>
          <label className="field">
            Asset
            <select value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })}>
              {ENABLED_ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            When price goes
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "above" | "below" })}>
              <option value="below">below</option>
              <option value="above">above</option>
            </select>
          </label>
          <label className="field" style={{ width: 150 }}>
            Price (USD)
            <input inputMode="decimal" value={form.price} placeholder={live ? formatUsd(live, asset.decimals).replace("$", "") : ""} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^0-9.]/g, "") })} />
          </label>
          <label className="field grow" style={{ minWidth: 160 }}>
            Note (optional)
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <label className="row small muted" style={{ paddingBottom: 9 }}>
            <input type="checkbox" checked={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.checked })} /> repeat
          </label>
          <button className="btn primary" onClick={addAlert}>
            Add alert
          </button>
        </div>
        {s.customAlerts.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="t">
              <tbody>
                {s.customAlerts.map((c) => {
                  const ad = getAsset(c.asset);
                  return (
                    <tr key={c.id}>
                      <td className="bold">{c.asset}</td>
                      <td>
                        {c.type} {formatUsd(c.price, ad?.decimals ?? 2)}
                      </td>
                      <td className="muted small" style={{ whiteSpace: "normal" }}>
                        {c.note ?? ""} {c.repeat ? "· repeats" : "· once"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn sm danger" onClick={() => store.updateSettings({ customAlerts: s.customAlerts.filter((x) => x.id !== c.id) })}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button className="btn sm" disabled={!s.githubToken || !s.githubRepo} onClick={() => void run(() => syncAlertsToGithub(s), "Saved to GitHub. The 24/7 server checks them from its next run.")}>
            Sync to 24/7 server
          </button>
          {!s.githubToken && <span className="tiny muted">To have these fire when the app is closed, add a GitHub token in Settings.</span>}
        </div>
      </Card>

      <div style={{ height: 16 }} />
      <Card title="Alarm history" right={m.localAlerts.length ? <button className="btn sm" onClick={() => store.clearLocalAlerts()}>Clear device history</button> : null}>
        {history.length ? (
          history.slice(0, 40).map((a) => (
            <div key={a.id}>
              <AlertRow a={a} />
              <div className="tiny faint" style={{ marginTop: -8, marginBottom: 6, paddingLeft: 46 }}>
                via {a.via}
              </div>
            </div>
          ))
        ) : (
          <p className="small muted">No alarms yet.</p>
        )}
      </Card>
    </>
  );
}
