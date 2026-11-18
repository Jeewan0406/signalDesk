import { useMemo, useState } from "react";
import { ENABLED_ASSETS } from "../../core/assets";
import { categoryLabel, itemImpact } from "../../core/drivers";
import { timeAgo } from "../../core/format";
import type { DriverCategory } from "../../core/types";
import { Card } from "../components/common";
import { useMarket } from "../store";

const CATS: DriverCategory[] = ["war", "geopolitics", "monetary", "cyber", "regulation", "institutional", "market", "macro"];

export function NewsPage() {
  const m = useMarket();
  const [cat, setCat] = useState<DriverCategory | "all">("all");
  const news = m.snapshot?.news ?? [];
  const items = useMemo(
    () =>
      news
        .filter((n) => cat === "all" || n.categories.includes(cat))
        .map((n) => ({
          n,
          impacts: ENABLED_ASSETS.map((a) => {
            const [imp, rel] = itemImpact(n, a, n.title);
            return { id: a.id, v: imp * rel };
          }).filter((x) => Math.abs(x.v) >= 0.15),
        })),
    [news, cat],
  );
  return (
    <>
      <h1 className="page-title">News & world events</h1>
      <p className="page-sub">
        Wars, geopolitics, central banks, cyber attacks, regulation and money flows, with the likely effect on each market. Gold usually rises on conflict (safe haven); crypto
        usually trades as a risk asset.
      </p>
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={cat === "all" ? "on" : ""} onClick={() => setCat("all")}>
          All ({news.length})
        </button>
        {CATS.map((c) => (
          <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>
            {categoryLabel(c)}
          </button>
        ))}
      </div>
      <Card>
        {!m.snapshot && <p className="muted small">News comes from the 24/7 server. {m.settings.dataUrl ? "Loading…" : "Connect it in Settings → Data source."}</p>}
        {items.map(({ n, impacts }) => (
          <div key={n.url + n.title} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
            <div className="row wrap" style={{ gap: 6, marginBottom: 4 }}>
              {n.categories.slice(0, 3).map((c) => (
                <span key={c} className="chip">
                  {categoryLabel(c)}
                </span>
              ))}
              <span className="tiny faint">
                {n.source} · {timeAgo(n.publishedAt)}
              </span>
            </div>
            <a href={n.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)", fontWeight: 600 }}>
              {n.title}
            </a>
            {impacts.length > 0 && (
              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                {impacts.map((x) => (
                  <span key={x.id} className={`badge ${x.v > 0 ? "up" : "down"}`}>
                    {x.id} {x.v > 0 ? "▲" : "▼"}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {m.snapshot && !items.length && <p className="muted small">No headlines in this category right now.</p>}
      </Card>
    </>
  );
}
