// Collects world, macro and crypto headlines for the event-driver engine.
// RSS feeds from major outlets + the GDELT global event database (optional,
// rate-limited to one query every 5 seconds).

import { classifyHeadline } from "../src/core/drivers";
import { ENABLED_ASSETS } from "../src/core/assets";
import { sleep } from "../src/core/providers";
import type { NewsItem } from "../src/core/types";

interface Feed {
  source: string;
  url: string;
}

export const FEEDS: Feed[] = [
  { source: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "CNBC World", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362" },
  { source: "CNBC Economy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258" },
  { source: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
];

const GDELT_QUERIES = [
  "(war OR missile OR airstrike OR invasion OR ceasefire OR sanctions OR tariffs)",
  "(cyberattack OR hackers OR ransomware OR \"crypto hack\" OR \"gold price\" OR \"federal reserve\")",
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeText(m[1]) : "";
}

export function parseRss(xml: string, source: string): { title: string; url: string; source: string; publishedAt: number; description: string }[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return items
    .map((it) => {
      const title = tag(it, "title");
      let url = tag(it, "link");
      if (!url) url = it.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
      const date = tag(it, "pubDate") || tag(it, "dc:date") || tag(it, "updated");
      const publishedAt = Date.parse(date);
      return { title, url, source, publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(), description: tag(it, "description").slice(0, 400) };
    })
    .filter((x) => x.title.length > 10);
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SignalDesk/1.0; market news reader)", Accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function gdeltDate(s: string): number {
  // 20261118T061500Z
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.now();
}

async function fetchGdelt(log: (m: string) => void) {
  const out: { title: string; url: string; source: string; publishedAt: number; description: string }[] = [];
  for (let i = 0; i < GDELT_QUERIES.length; i++) {
    if (i > 0) await sleep(5500);
    const q = encodeURIComponent(`${GDELT_QUERIES[i]} sourcelang:english`);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&maxrecords=60&timespan=24h&sort=hybridrel`;
    try {
      const txt = await fetchText(url, 25000);
      const data = JSON.parse(txt) as { articles?: { title: string; url: string; seendate: string; domain: string }[] };
      for (const a of data.articles ?? []) {
        out.push({ title: decodeText(a.title), url: a.url, source: `GDELT · ${a.domain}`, publishedAt: gdeltDate(a.seendate), description: "" });
      }
    } catch (err) {
      log(`GDELT query ${i + 1} skipped: ${(err as Error).message}`);
    }
  }
  return out;
}

export async function collectNews(opts: { gdelt?: boolean; log?: (m: string) => void } = {}): Promise<NewsItem[]> {
  const log = opts.log ?? (() => {});
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const xml = await fetchText(f.url);
      return parseRss(xml, f.source);
    }),
  );
  const raw: ReturnType<typeof parseRss> = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") raw.push(...r.value);
    else log(`Feed ${FEEDS[i].source} failed: ${(r.reason as Error).message}`);
  });
  if (opts.gdelt !== false) raw.push(...(await fetchGdelt(log)));

  const now = Date.now();
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const r of raw.sort((a, b) => b.publishedAt - a.publishedAt)) {
    if (now - r.publishedAt > 48 * 3_600_000 || r.publishedAt - now > 3_600_000) continue;
    const key = r.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classifyHeadline(r.title, ENABLED_ASSETS, r.description);
    if (!c.categories.length && !c.assets.length) continue; // not market-relevant
    items.push({ title: r.title, url: r.url, source: r.source, publishedAt: r.publishedAt, ...c });
  }
  return items.slice(0, 150);
}
