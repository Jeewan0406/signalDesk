import { useEffect, useState } from "react";
import { timeAgo } from "../core/format";
import { Icon } from "./components/common";
import { AlertsPage } from "./pages/AlertsPage";
import { AssetPage } from "./pages/AssetPage";
import { Dashboard } from "./pages/Dashboard";
import { NewsPage } from "./pages/NewsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { store, useMarket } from "./store";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash || "#/");
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

const NAV = [
  { href: "#/", path: "/", label: "Markets", icon: Icon.home },
  { href: "#/alerts", path: "/alerts", label: "Alarms", icon: Icon.bell },
  { href: "#/news", path: "/news", label: "News", icon: Icon.news },
  { href: "#/settings", path: "/settings", label: "Settings", icon: Icon.gear },
];

export function App() {
  const route = useHashRoute();
  const m = useMarket();
  useEffect(() => store.start(), []);
  useEffect(() => {
    document.documentElement.dataset.theme = m.settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", m.settings.theme === "dark" ? "#0b0e14" : "#f3f4f7");
  }, [m.settings.theme]);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  let page;
  const assetMatch = route.match(/^\/asset\/([A-Z0-9]+)/);
  if (assetMatch) page = <AssetPage key={assetMatch[1]} id={assetMatch[1]} />;
  else if (route.startsWith("/alerts")) page = <AlertsPage />;
  else if (route.startsWith("/news")) page = <NewsPage />;
  else if (route.startsWith("/settings")) page = <SettingsPage />;
  else page = <Dashboard />;

  const active = (p: string) => (p === "/" ? route === "/" || route.startsWith("/asset") : route.startsWith(p));
  const serverOk = m.snapshot && Date.now() - m.snapshot.generatedAt < 30 * 60_000;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <span className="brand-mark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1b1300" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l6-6 4 4 8-8" />
              </svg>
            </span>
            SignalDesk
          </a>
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={active(n.path) ? "active" : ""}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="status">
            <span className="row hide-sm" title="Live price stream">
              <span className={`dot ${m.live ? "on" : ""}`} /> {m.live ? "Live" : "Polling"}
            </span>
            <span className="row hide-sm" title="24/7 server">
              <span className={`dot ${serverOk ? "on" : m.snapshot ? "warn" : ""}`} />
              {m.snapshot ? `Server ${timeAgo(m.snapshot.generatedAt)}` : "Server offline"}
            </span>
            <span className="seg">
              {(["usd", "inr", "both"] as const).map((c) => (
                <button key={c} className={m.settings.currency === c ? "on" : ""} onClick={() => store.updateSettings({ currency: c })}>
                  {c === "both" ? "$+₹" : c === "usd" ? "$" : "₹"}
                </button>
              ))}
            </span>
          </div>
        </div>
      </header>
      <main className="content">
        {page}
        <p className="disclaimer">
          Analysis and probabilities, not certainties or financial advice. Prices from Binance, OKX, Kraken and CoinDCX · charts by TradingView.
        </p>
      </main>
      <nav className="bottomnav">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className={active(n.path) ? "active" : ""}>
            {n.icon}
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
