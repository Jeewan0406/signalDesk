// Push notifications through ntfy (https://ntfy.sh): free apps for iPhone,
// Android, Windows/Mac (web). Messages arrive even when SignalDesk is closed.

import type { FiredAlert } from "../src/core/types";

export interface NotifyConfig {
  server: string;
  topic: string;
  token?: string;
  clickUrl?: string;
}

const TAGS: Record<FiredAlert["kind"], string> = {
  "floor-hit": "green_circle,chart_with_upwards_trend",
  "ceiling-hit": "red_circle,chart_with_downwards_trend",
  "floor-break": "warning,chart_with_downwards_trend",
  "ceiling-break": "rocket,chart_with_upwards_trend",
  "approach-floor": "eyes",
  "approach-ceiling": "eyes",
  custom: "bell",
};

const PRIORITY: Record<FiredAlert["kind"], number> = {
  "floor-hit": 5,
  "ceiling-hit": 5,
  "floor-break": 5,
  "ceiling-break": 5,
  "approach-floor": 3,
  "approach-ceiling": 3,
  custom: 4,
};

/** HTTP headers must be ASCII; ntfy accepts RFC 2047 encoded-words for anything else. */
function headerSafe(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

export async function sendNtfy(cfg: NotifyConfig, alert: FiredAlert): Promise<void> {
  const headers: Record<string, string> = {
    Title: headerSafe(alert.title),
    Priority: String(PRIORITY[alert.kind]),
    Tags: TAGS[alert.kind],
  };
  if (cfg.clickUrl) headers.Click = `${cfg.clickUrl}#/asset/${alert.asset}`;
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetch(`${cfg.server.replace(/\/$/, "")}/${encodeURIComponent(cfg.topic)}`, {
    method: "POST",
    headers,
    body: alert.message,
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}: ${await res.text()}`);
}
