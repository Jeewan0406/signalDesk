import { useEffect, useRef } from "react";

/**
 * Official TradingView "Advanced Chart" embed (free website widget). Used for
 * real spot gold (OANDA:XAUUSD) and as an alternative full-featured chart.
 */
export function TradingViewWidget({ symbol, interval = "60", theme }: { symbol: string; interval?: string; theme: "dark" | "light" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme,
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      hide_side_toolbar: false,
      withdateranges: true,
      studies: ["STD;RSI", "STD;MACD"],
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, [symbol, interval, theme]);
  return <div className="tradingview-widget-container tv-box" ref={ref} />;
}
