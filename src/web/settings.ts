import type { CustomAlert } from "../core/types";

export type CurrencyMode = "usd" | "inr" | "both";

export interface Settings {
  dataUrl: string;
  currency: CurrencyMode;
  theme: "dark" | "light";
  inAppAlarms: boolean;
  alarmSound: boolean;
  approachAlarms: boolean;
  ntfyServer: string;
  ntfyTopic: string;
  githubRepo: string; // owner/repo
  githubToken: string;
  customAlerts: CustomAlert[];
}

const KEY = "signaldesk.settings.v1";

/** Set at build time by the GitHub Actions workflow; can be overridden in Settings. */
const BUILD_DATA_URL = (import.meta.env.VITE_DATA_URL as string | undefined) ?? "";
const BUILD_REPO = (import.meta.env.VITE_GITHUB_REPO as string | undefined) ?? "";

export const DEFAULT_SETTINGS: Settings = {
  dataUrl: BUILD_DATA_URL,
  currency: "both",
  theme: "dark",
  inAppAlarms: true,
  alarmSound: true,
  approachAlarms: false,
  ntfyServer: "https://ntfy.sh",
  ntfyTopic: "",
  githubRepo: BUILD_REPO,
  githubToken: "",
  customAlerts: [],
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    if (!s.dataUrl) s.dataUrl = BUILD_DATA_URL;
    if (!s.githubRepo) s.githubRepo = BUILD_REPO;
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function randomTopic(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `signaldesk-${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 18)}`;
}

/** Send a test push straight from the app to the ntfy channel. */
export async function sendTestPush(s: Settings): Promise<void> {
  if (!s.ntfyTopic) throw new Error("Set an alarm channel first");
  const res = await fetch(`${s.ntfyServer.replace(/\/$/, "")}/${encodeURIComponent(s.ntfyTopic)}`, {
    method: "POST",
    headers: { Title: "SignalDesk test alarm", Priority: "5", Tags: "bell" },
    body: "If you can read this on your phone, SignalDesk alarms will reach you even when the app is closed.",
  });
  if (!res.ok) throw new Error(`ntfy answered HTTP ${res.status}`);
}

/** Create or update a file in the user's GitHub repository (the 24/7 server reads it on its next run). */
async function putRepoFile(s: Settings, path: string, data: unknown, message: string): Promise<void> {
  if (!s.githubRepo || !s.githubToken) throw new Error("Add your GitHub repository and token in Settings → GitHub sync first");
  const api = `https://api.github.com/repos/${s.githubRepo}/contents/${path}`;
  const headers = { Authorization: `Bearer ${s.githubToken}`, Accept: "application/vnd.github+json" };
  let sha: string | undefined;
  const cur = await fetch(api, { headers });
  if (cur.ok) sha = ((await cur.json()) as { sha: string }).sha;
  else if (cur.status !== 404) throw new Error(`GitHub answered HTTP ${cur.status}`);
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + "\n")));
  const res = await fetch(api, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message, content, sha }),
  });
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Save custom alerts to config/alerts.json so the 24/7 server checks them too. */
export function syncAlertsToGithub(s: Settings): Promise<void> {
  return putRepoFile(s, "config/alerts.json", s.customAlerts, "Update price alerts from SignalDesk app");
}

export interface ServerSettings {
  /** auto (free providers first) | gemini | groq | anthropic */
  aiProvider: string;
  aiIntervalMinutes: number;
  approachAlerts: boolean;
}

/** Save the 24/7 server settings (AI analyst frequency, heads-up alarms) to config/settings.json. */
export function saveServerSettings(s: Settings, cfg: ServerSettings): Promise<void> {
  return putRepoFile(s, "config/settings.json", cfg, "Update 24/7 server settings from SignalDesk app");
}

/** Rough AI cost per day for a given interval (about $0.15-0.25 per run). */
export function aiCostPerDay(intervalMinutes: number): [number, number] {
  if (!intervalMinutes) return [0, 0];
  const runs = 1440 / intervalMinutes;
  return [runs * 0.15, runs * 0.25];
}
