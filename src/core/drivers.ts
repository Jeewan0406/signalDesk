// Event-driver engine: classifies headlines into the forces that move markets
// (war, geopolitics, central banks, cyber attacks, regulation, institutional
// flows, market structure, macro) and maps each to a per-asset impact.
// Gold and crypto react differently to the same event: escalation of a war is
// typically risk-off (crypto down) and safe-haven (gold up).

import type { AssetConfig, Derivatives, Driver, DriverCategory, NewsItem } from "./types";

const RULES: { cat: DriverCategory; re: RegExp }[] = [
  {
    cat: "war",
    re: /\b(war|wars|missiles?|air ?strikes?|invasion|invade[sd]?|troops|military|drone strikes?|bombing|shelling|ceasefire|cease-fire|truce|armed conflict|conflict|hostilities|nuclear|hamas|hezbollah|houthis?|retaliat\w*)\b/i,
  },
  {
    cat: "geopolitics",
    re: /\b(sanctions?|tariffs?|trade war|trade deal|embargo|geopolitic\w*|tensions?|diplomat\w*|summit|presidential election|coup|nato|kremlin|taiwan|iran|russia|ukraine|israel|north korea|opec|crude|oil prices?)\b/i,
  },
  {
    cat: "monetary",
    re: /\b(fed|fomc|federal reserve|powell|rate cuts?|rate hikes?|interest rates?|inflation|cpi|pce|ecb|boj|rbi|central banks?|bond yields?|yields|treasur(y|ies)|dovish|hawkish|quantitative|liquidity|dollar|dxy)\b/i,
  },
  {
    cat: "cyber",
    re: /\b(hack|hacked|hackers?|exploit(ed)?|breach(ed)?|cyber ?-?attacks?|ransomware|phishing|stolen|drained|vulnerabilit(y|ies)|malware|ddos|outage)\b/i,
  },
  {
    cat: "regulation",
    re: /\b(sec|cftc|regulat\w*|lawsuits?|sued|sues|court|judge|bans?|banned|legislation|senate|congress|licen[cs]e[sd]?|compliance|crackdown|mica|tax(es)?|approv(al|e|es|ed))\b/i,
  },
  {
    cat: "institutional",
    re: /\b(etfs?|inflows?|outflows?|blackrock|fidelity|grayscale|institution\w*|treasury compan(y|ies)|strategic (bitcoin |crypto )?reserve|microstrategy|accumulat\w*|whales?|gold purchases|gold buying|central bank buying)\b/i,
  },
  {
    cat: "market",
    re: /\b(liquidat\w*|short squeeze|open interest|funding rates?|leverage[d]?|stablecoins?|depeg\w*|on-chain|miners?|halving|all-time high|record high|breakout|sell-?off|rall(y|ies|ied))\b/i,
  },
  {
    cat: "macro",
    re: /\b(gdp|recession|jobs report|payrolls|unemployment|economy|economic|stocks|equities|nasdaq|s&p|wall street|risk assets?|bond market)\b/i,
  },
];

const POSITIVE =
  /\b(surge[sd]?|soar(s|ed)?|rall(y|ies|ied)|jump(s|ed)?|gain(s|ed)?|rise[sn]?|rising|record|bullish|approv(al|e|es|ed)|inflows?|adopt(s|ed|ion)?|rebound(s|ed)?|recover(s|y|ed)?|boost(s|ed)?|upgrade[sd]?|breakthrough|beat(s)?|buy(s|ing)?|accumulat\w*|partnership|launch(es|ed)?|ceasefire|cease-fire|peace|truce|de-?escalat\w*|optimis\w*|win(s)?|eas(e|es|ing)|relief|stimulus|cuts? rates?|rate cuts?)\b/gi;
const NEGATIVE =
  /\b(crash(es|ed)?|plunge[sd]?|plummet(s|ed)?|tumble[sd]?|slump(s|ed)?|drops?|dropped|fall(s|en)?|fell|dump(s|ed)?|sell-?off|bearish|bans?|banned|lawsuits?|sue[sd]?|charged|fraud|hack(s|ed)?|exploit(s|ed)?|breach(es|ed)?|stolen|drained|outflows?|liquidat\w*|fears?|panic|war|attacks?|strikes?|missiles?|invasion|sanctions?|tariffs?|recession|hikes?|hawkish|default(s|ed)?|bankrupt\w*|insolven\w*|collapse[sd]?|warn(s|ing)?|threat(s|ens)?|tensions?|escalat\w*|crisis|delay(s|ed)?|reject(s|ed)?|probe|investigation|crackdown|turmoil|losses?|slowdown|fail(s|ed|ure)?|violence|killed|deaths?|clashes|unrest|protests?|seiz(e|es|ed)|shut(s|down)?)\b/gi;

const DOVISH = /\b(rate cuts?|cuts? (interest )?rates?|dovish|easing|pause[sd]? (rate )?hikes?|stimulus|quantitative easing|lower rates|inflation (cools|eases|slows|falls)|weak(er)? dollar|dollar (falls|slides|weakens|drops))\b/i;
const HAWKISH = /\b(rate hikes?|hikes? (interest )?rates?|hawkish|tightening|higher for longer|hot inflation|inflation (rises|jumps|accelerates|surges|hotter)|strong(er)? dollar|dollar (rallies|surges|jumps|strengthens|rises)|yields (rise|surge|jump|climb))\b/i;
// Conflicts and politics move global markets when they involve major economies or energy supply.
const MAJOR = /\b(u\.?s\.?|united states|america|american|washington|white house|trump|china|chinese|beijing|xi|russia|russian|putin|kremlin|iran|iranian|israel|israeli|ukraine|taiwan|north korea|gulf|middle east|strait of hormuz|red sea|nato|europe|european|eu|oil|crude|opec|saudi|india|japan|g7|g20)\b/i;
const DEESCALATE = /\b(ceasefire|cease-fire|truce|peace (deal|agreement|accord|talks)|de-?escalat\w*|withdraw(s|al)?|hostages? (freed|released))\b/i;
const DEESCALATE_FAILS = /\b(fail(s|ed)?|collapse[sd]?|violat\w*|breach(es|ed)?|stall(s|ed)?|rejects?)\b/i;
const CRYPTO_GENERIC = /\b(crypto\w*|digital assets?|altcoins?|blockchain|defi|web3|tokens?|exchange)\b/i;

function countMatches(re: RegExp, text: string): number {
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}

function kwRegex(k: string): RegExp {
  return new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

export function classifyHeadline(title: string, assets: AssetConfig[], description = ""): Pick<NewsItem, "categories" | "sentiment" | "assets"> {
  const text = `${title}. ${description}`.slice(0, 600);
  const categories = RULES.filter((r) => r.re.test(text)).map((r) => r.cat);
  const pos = countMatches(POSITIVE, title) * 2 + countMatches(POSITIVE, description);
  const neg = countMatches(NEGATIVE, title) * 2 + countMatches(NEGATIVE, description);
  const sentiment = pos + neg === 0 ? 0 : Math.max(-1, Math.min(1, (pos - neg) / Math.max(3, pos + neg)));
  const mentioned = assets.filter((a) => a.newsKeywords.some((k) => kwRegex(k).test(text))).map((a) => a.id);
  return { categories, sentiment, assets: mentioned };
}

/** Impact of one news item on one asset, before recency weighting. Returns [impact, relevance]. */
export function itemImpact(item: NewsItem, asset: AssetConfig, title: string): [number, number] {
  const isCrypto = asset.kind === "crypto";
  const mentioned = item.assets.includes(asset.id);
  const otherSpecific = item.assets.length > 0 && !mentioned;
  const cryptoGeneric = CRYPTO_GENERIC.test(title);
  const global = item.categories.some((c) => c === "war" || c === "geopolitics" || c === "monetary" || c === "macro");

  const major = MAJOR.test(title);
  let relevance: number;
  if (mentioned) relevance = 1;
  else if (isCrypto && cryptoGeneric && !item.assets.includes("GOLD")) relevance = otherSpecific ? 0.3 : 0.7;
  else if (global) relevance = major ? 0.6 : 0.2;
  else relevance = 0.1;

  const tone = item.sentiment; // negative = risk-off
  // War headlines are escalation by default; only a real ceasefire/peace step is de-escalation.
  const warTone = DEESCALATE.test(title) && !DEESCALATE_FAILS.test(title) ? 0.7 : -Math.max(0.5, -tone);
  const policy = DOVISH.test(title) ? 1 : HAWKISH.test(title) ? -1 : 0;
  let impact = 0;
  for (const c of item.categories) {
    switch (c) {
      case "war":
        impact += isCrypto ? 0.8 * warTone : -1.0 * warTone;
        break;
      case "geopolitics":
        if (!item.categories.includes("war")) impact += isCrypto ? 0.6 * tone : -0.8 * tone;
        break;
      case "monetary":
        impact += policy !== 0 ? 0.9 * policy : (isCrypto ? 0.4 : 0.2) * tone;
        break;
      case "cyber":
        if (isCrypto) impact += mentioned || cryptoGeneric ? -0.9 : -0.2;
        else impact += mentioned ? 0 : 0.15;
        break;
      case "regulation":
        impact += isCrypto ? 0.8 * tone : 0;
        break;
      case "institutional":
        impact += isCrypto || mentioned ? 0.8 * tone : 0;
        break;
      case "market":
        impact += 0.6 * tone;
        break;
      case "macro":
        impact += isCrypto ? 0.4 * tone : -0.2 * tone;
        break;
    }
  }
  if (!item.categories.length && mentioned) impact = 0.5 * tone;
  return [Math.max(-1, Math.min(1, impact)), relevance];
}

const CAT_LABEL: Record<DriverCategory, string> = {
  war: "War / conflict",
  geopolitics: "Geopolitics",
  monetary: "Central banks & rates",
  cyber: "Cyber attack / hack",
  regulation: "Regulation",
  institutional: "Institutional flows",
  market: "Market structure",
  macro: "Macro economy",
};

export function categoryLabel(c: string): string {
  return (CAT_LABEL as Record<string, string>)[c] ?? c;
}

export function assetDrivers(
  asset: AssetConfig,
  news: NewsItem[],
  derivatives: Derivatives | null,
  fearGreed: { value: number; label: string } | null,
  now = Date.now(),
): { drivers: Driver[]; score: number } {
  const scored: { d: Driver; w: number }[] = [];
  let total = 0;
  let mass = 0;
  for (const item of news) {
    const ageH = Math.max(0, (now - item.publishedAt) / 3_600_000);
    if (ageH > 72) continue;
    const rec = Math.exp(-ageH / 12);
    const [impact, rel] = itemImpact(item, asset, item.title);
    const w = impact * rel * rec;
    mass += rel * rec;
    if (Math.abs(w) < 0.02) continue;
    total += w;
    scored.push({
      w,
      d: {
        label: categoryLabel(item.categories[0] ?? "market"),
        category: item.categories[0] ?? "market",
        impact: Math.max(-1, Math.min(1, impact * rel)),
        detail: item.title,
        url: item.url,
        at: item.publishedAt,
      },
    });
  }
  scored.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const drivers = scored.slice(0, 8).map((s) => s.d);

  if (derivatives?.fundingAnnualPct !== null && derivatives?.fundingAnnualPct !== undefined) {
    const fa = derivatives.fundingAnnualPct;
    const crowded = fa > 40 ? "longs are crowded (contrarian bearish)" : fa < -10 ? "shorts are crowded (squeeze risk, contrarian bullish)" : "positioning is balanced";
    drivers.push({
      label: "Futures funding",
      category: "derivatives",
      impact: fa > 40 ? -0.4 : fa < -10 ? 0.4 : 0,
      detail: `Funding ${(derivatives.fundingRate! * 100).toFixed(4)}% / 8h (${fa.toFixed(1)}% a year): ${crowded}.`,
    });
  }
  if (derivatives?.longShortRatio) {
    const r = derivatives.longShortRatio;
    drivers.push({
      label: "Long/short ratio",
      category: "derivatives",
      impact: r > 2.5 ? -0.3 : r < 0.8 ? 0.3 : 0,
      detail: `${r.toFixed(2)} long accounts per short on OKX${r > 2.5 ? ": retail heavily long, a flush is possible" : r < 0.8 ? ": retail heavily short" : ""}.`,
    });
  }
  if (fearGreed && asset.kind === "crypto") {
    const v = fearGreed.value;
    drivers.push({
      label: "Fear & Greed",
      category: "sentiment",
      impact: v <= 25 ? 0.3 : v >= 75 ? -0.3 : 0,
      detail: `Crypto Fear & Greed index is ${v} (${fearGreed.label}). Extremes often mark turning points.`,
    });
  }

  // Relevance-weighted average impact, shrunk toward zero when there is little news.
  return { drivers, score: Math.max(-1, Math.min(1, total / (mass + 2))) };
}
