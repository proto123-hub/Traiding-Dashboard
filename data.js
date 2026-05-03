/* ===== Trading Command Center v3.6 — Mock Data Layer =====
   Replace tick() with real API calls (Polygon/Finnhub/Yahoo) when wiring live.
   All numbers are illustrative. */

const MarketData = (() => {
  // 24-ticker watchlist from CLAUDE.md
  const TICKERS = [
    // AI/Semi core
    { sym: "PLTR",   name: "Palantir",       sector: "AI",   price: 78.42,  chg: 1.82,  vol: "42M",   mcap: "182B",  pe: 218 },
    { sym: "NVDA",   name: "NVIDIA",         sector: "AI",   price: 178.50, chg: 2.34,  vol: "189M",  mcap: "4.4T",  pe: 48  },
    { sym: "GOOGL",  name: "Alphabet",       sector: "AI",   price: 218.75, chg: 0.92,  vol: "28M",   mcap: "2.7T",  pe: 27  },
    { sym: "TSLA",   name: "Tesla",          sector: "AI",   price: 342.18, chg: -1.45, vol: "92M",   mcap: "1.1T",  pe: 78  },
    { sym: "META",   name: "Meta",           sector: "AI",   price: 612.30, chg: 0.55,  vol: "14M",   mcap: "1.5T",  pe: 28  },
    { sym: "MRVL",   name: "Marvell",        sector: "AI",   price: 92.45,  chg: 1.12,  vol: "18M",   mcap: "80B",   pe: 42  },
    { sym: "CLS",    name: "Celestica",      sector: "AI",   price: 165.20, chg: 2.85,  vol: "5M",    mcap: "19B",   pe: 38  },
    // Semi supply + HBM
    { sym: "AMD",    name: "AMD",            sector: "Semi", price: 168.90, chg: 1.45,  vol: "52M",   mcap: "273B",  pe: 88  },
    { sym: "MSFT",   name: "Microsoft",      sector: "Semi", price: 478.25, chg: 0.42,  vol: "21M",   mcap: "3.6T",  pe: 36  },
    { sym: "TSM",    name: "TSMC",           sector: "Semi", price: 245.80, chg: 1.78,  vol: "18M",   mcap: "1.3T",  pe: 32  },
    { sym: "INTC",   name: "Intel",          sector: "Semi", price: 28.45,  chg: -2.15, vol: "68M",   mcap: "120B",  pe: null },
    { sym: "ORCL",   name: "Oracle",         sector: "Semi", price: 285.40, chg: 0.65,  vol: "9M",    mcap: "800B",  pe: 42  },
    { sym: "MU",     name: "Micron",         sector: "Semi", price: 142.30, chg: 1.92,  vol: "22M",   mcap: "158B",  pe: 18  },
    { sym: "AVGO",   name: "Broadcom",       sector: "Semi", price: 268.50, chg: 0.88,  vol: "15M",   mcap: "1.25T", pe: 92  },
    // Equip + IP
    { sym: "AMAT",   name: "Applied Mat'ls", sector: "Equip",price: 218.40, chg: 1.25,  vol: "8M",    mcap: "182B",  pe: 24  },
    { sym: "LRCX",   name: "Lam Research",   sector: "Equip",price: 92.85,  chg: 0.95,  vol: "12M",   mcap: "118B",  pe: 27  },
    { sym: "KLAC",   name: "KLA Corp",       sector: "Equip",price: 845.20, chg: 1.42,  vol: "1.2M",  mcap: "112B",  pe: 32  },
    { sym: "ARM",    name: "ARM Holdings",   sector: "Equip",price: 158.90, chg: 2.18,  vol: "9M",    mcap: "168B",  pe: 165 },
    // Growth/Defense/Space
    { sym: "CRWD",   name: "CrowdStrike",    sector: "Growth",price:412.60, chg: 1.05,  vol: "4M",    mcap: "100B",  pe: 92  },
    { sym: "SNOW",   name: "Snowflake",      sector: "Growth",price:218.45, chg: -0.85, vol: "6M",    mcap: "73B",   pe: null },
    { sym: "RKLB",   name: "Rocket Lab",     sector: "Growth",price: 28.75, chg: 3.42,  vol: "28M",   mcap: "14B",   pe: null },
    // Benchmarks
    { sym: "SPY",    name: "S&P 500 ETF",    sector: "Bench",price: 612.45, chg: 0.68,  vol: "62M",   mcap: "—",     pe: 24  },
    { sym: "QQQ",    name: "Nasdaq 100 ETF", sector: "Bench",price: 528.92, chg: 0.92,  vol: "38M",   mcap: "—",     pe: 28  },
    // 2026 additions
    { sym: "QCOM",   name: "Qualcomm",       sector: "Semi", price: 192.40, chg: 1.65,  vol: "11M",   mcap: "215B",  pe: 22  },
  ];

  // Today Glance
  let glance = {
    spx: { price: 6124.50, chg: 0.68, chgPts: 41.45 },
    ndx: { price: 22845.20, chg: 0.92, chgPts: 208.45 },
    dji: { price: 44582.10, chg: 0.45, chgPts: 199.85 },
    rut: { price: 2418.65, chg: -0.32, chgPts: -7.74 },
    vix: { price: 14.85, chg: -3.42, chgPts: -0.53 },
    dxy: { price: 102.45, chg: 0.18, chgPts: 0.18 },
    tnx: { price: 4.285, chg: 0.85, chgPts: 0.036 },
    oil: { price: 78.92, chg: 1.42, chgPts: 1.10 },
    gold:{ price: 2842.50, chg: 0.62, chgPts: 17.55 },
    btc: { price: 98245, chg: 2.18, chgPts: 2095 },
  };

  // Market Regime composite
  let regime = {
    score: 7.5,        // -100 .. +100
    label: "Neutral",
    quality: "Trending Maintained",
    components: {
      breadth:    5,
      flow:      -8,
      vix_term:  12,
      sector_diff: 6,
      korea_lead:  4,
    },
    playbook: {
      h5:  { p25: -0.8, median: 0.4, p75: 1.6, win: 0.60 },
      h20: { p25: -1.2, median: 1.8, p75: 3.4, win: 0.80 },
    },
    history: [-22, -18, -8, -3, 4, 12, 18, 14, 9, 7.5], // last 10 sessions
  };

  // Sector heatmap (PROJECT_GUIDELINES §18.4)
  const SECTORS = [
    { name: "AI/Cloud Infra",    k: "AI",     chg:  1.42, breadth: 0.78 },
    { name: "Semiconductor",     k: "Semi",   chg:  0.95, breadth: 0.65 },
    { name: "Semi Equipment",    k: "Equip",  chg:  1.18, breadth: 0.72 },
    { name: "Growth/Cloud SW",   k: "Growth", chg:  0.45, breadth: 0.55 },
    { name: "Defense/Space",     k: "Def",    chg:  2.15, breadth: 0.85 },
    { name: "Korea Semi (HBM)",  k: "KR",     chg:  1.85, breadth: 0.80 },
    { name: "Benchmark/Macro",   k: "Bench",  chg:  0.55, breadth: 0.60 },
  ];

  // Whale Insight strip — Q3 2025 13F snapshot
  const WHALES = [
    { fund: "NPS (Korea $1T)",      flag: "AI/Semi 비중 ↑", concord: 0.72, sig: "🟢" },
    { fund: "Berkshire (Buffett)",  flag: "+$4B GOOGL Q3",  concord: 0.65, sig: "🟢" },
    { fund: "Pershing Sq (Ackman)", flag: "39% GOOGL+AMZN+META", concord: 0.81, sig: "🟢🟢" },
    { fund: "Duquesne (Druckenm.)", flag: "Exit NVDA → GOOGL/TSM", concord: 0.58, sig: "🟡" },
    { fund: "Scion (Burry)",        flag: "PUT NVDA + PLTR", concord: -0.42, sig: "🔴" },
  ];

  // Trump Truth trigger feed (mock)
  const TRUMP_TRIGGERS = [
    { ts: "09:42 ET", kw: ["Powell","rate"],  text: "Powell must cut rates NOW. The economy is BOOMING but he refuses...", impact: "USD↓ Bond↑" },
    { ts: "08:15 ET", kw: ["China","tariff"], text: "China deal looking VERY strong. Tariffs working perfectly.", impact: "Risk-On" },
    { ts: "07:02 ET", kw: ["chip","TSMC"],    text: "TSMC bringing more production to America. HUGE win.", impact: "TSM↑ INTC↓" },
    { ts: "Yesterday",kw: ["Iran"],           text: "Iran will NEVER have a nuclear weapon. Period.", impact: "Oil↑ VIX↑" },
  ];

  // Cowork session status (from STATUS.md)
  let cowork = {
    A: { status: "Idle", task: "—",                        since: "—" },
    B: { status: "Active", task: "v3.6 dashboard refresh", since: "14:32 KST" },
  };

  // Subscribers
  const subs = new Set();
  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
  function publish() { subs.forEach(fn => fn()); }

  // Random walk tick
  function jitter(v, pct = 0.002) {
    return v * (1 + (Math.random() - 0.5) * 2 * pct);
  }
  function jitterPct(v, span = 0.4) {
    return Math.max(-15, Math.min(15, v + (Math.random() - 0.5) * span));
  }

  function tick() {
    // Tickers
    TICKERS.forEach(t => {
      t.price = +jitter(t.price, 0.0015).toFixed(2);
      t.chg = +jitterPct(t.chg).toFixed(2);
    });
    // Glance
    Object.values(glance).forEach(g => {
      g.price = +jitter(g.price, 0.0012).toFixed(g.price > 1000 ? 2 : 3);
      g.chg = +jitterPct(g.chg, 0.2).toFixed(2);
    });
    // Regime drift
    regime.score = Math.max(-100, Math.min(100, regime.score + (Math.random() - 0.5) * 3));
    regime.label = regime.score >= 33 ? "Risk On" : regime.score <= -33 ? "Risk Off" : "Neutral";
    regime.history.push(+regime.score.toFixed(1));
    if (regime.history.length > 30) regime.history.shift();
    // Sectors
    SECTORS.forEach(s => { s.chg = +jitterPct(s.chg, 0.15).toFixed(2); });
    publish();
  }

  return {
    TICKERS, SECTORS, WHALES, TRUMP_TRIGGERS,
    get glance() { return glance; },
    get regime() { return regime; },
    get cowork() { return cowork; },
    subscribe, tick,
  };
})();

window.MarketData = MarketData;
