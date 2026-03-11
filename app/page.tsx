"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://gmvctjccieepzjjeofpc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtdmN0amNjaWVlcHpqamVvZnBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDU1NTEsImV4cCI6MjA4NjkyMTU1MX0.-iPj_DOhvUd9JIdbmaE-iEg0ZAusjSprQsv2K0vNw1w"
);

interface Instrument { id: string; symbol: string; name: string; market: string; memo?: string; }
interface Trade { id: string; instrument_id: string; trade_date: string; side: string; quantity: number; price: number; fee: number; note: string; }

function calculatePosition(trades: Trade[], market?: string) {
  let totalBuyQty = 0, totalBuyAmt = 0, realizedPnl = 0, firstBuyDate = "";
  const isETF = market === "ETF";
  const sellFeeRate = isETF ? 0.0003 : 0.0021;
  const sorted = [...trades].sort((a, b) => new Date(a.trade_date).getTime() - new Date(b.trade_date).getTime());
  for (const t of sorted) {
    if (t.side === "BUY") {
      totalBuyQty += t.quantity; totalBuyAmt += t.quantity * t.price;
      if (!firstBuyDate) firstBuyDate = t.trade_date;
    } else {
      const avg = totalBuyQty > 0 ? totalBuyAmt / totalBuyQty : 0;
      const sellAmount = t.price * t.quantity;
      const sellFee = Math.round(sellAmount * sellFeeRate);
      realizedPnl += (t.price - avg) * t.quantity - sellFee;
      totalBuyQty -= t.quantity;
      totalBuyAmt = totalBuyQty > 0 ? avg * totalBuyQty : 0;
      // Position closed — reset for new position
      if (totalBuyQty <= 0) {
        totalBuyQty = 0; totalBuyAmt = 0; firstBuyDate = "";
      }
    }
  }
  return { totalQty: totalBuyQty, avgPrice: totalBuyQty > 0 ? Math.round(totalBuyAmt / totalBuyQty) : 0, realizedPnl: Math.round(realizedPnl), firstBuyDate };
}

function holdingDays(d: string) { return d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0; }
function holdingWeeks(d: string) { return `${holdingDays(d)}일`; }

// Check if instrument has an active (non-zero) position
function hasActivePosition(trades: Trade[], instrumentId: string): boolean {
  const it = trades.filter(t => t.instrument_id === instrumentId);
  if (!it.length) return false;
  const sorted = [...it].sort((a, b) => new Date(a.trade_date).getTime() - new Date(b.trade_date).getTime());
  let qty = 0;
  for (const t of sorted) { qty += t.side === "BUY" ? t.quantity : -t.quantity; if (qty <= 0) qty = 0; }
  return qty > 0;
}
function getAlertLevel(r: number) { return r >= 0.05 ? "OUTPERFORM" : r >= -0.05 ? "NORMAL" : r >= -0.12 ? "WARNING" : "DANGER"; }
function fmt(n: number) { return new Intl.NumberFormat("ko-KR").format(n); }
const BENCH_RET: Record<string, number> = { KOSPI: 0.054, KOSDAQ: 0.038 };

const IconMemo = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const IconWarn = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IconCheck = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IconBack = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>;

export default function Home() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [priceLoading, setPriceLoading] = useState(false);
  const [view, setView] = useState("dashboard");
  const [prevView, setPrevView] = useState("dashboard");
  const [selInst, setSelInst] = useState<string | null>(null);
  const [editTrade, setEditTrade] = useState<any>(null);
  const [form, setForm] = useState({ instrument_id: "", trade_date: new Date().toISOString().split("T")[0], side: "BUY", quantity: "", price: "", note: "" });
  const [showNewInst, setShowNewInst] = useState(false);
  const [newInst, setNewInst] = useState({ symbol: "", name: "", market: "KOSPI" });
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [marketIndex, setMarketIndex] = useState<Record<string, { changeRate: number }>>({});
  const [dayChanges, setDayChanges] = useState<Record<string, number>>({});
  const [globalData, setGlobalData] = useState<Record<string, any>>({});
  const [globalSel, setGlobalSel] = useState<string|null>(null);
  const globalChartRef = useRef<HTMLDivElement>(null);
  const globalChartInstanceRef = useRef<any>(null);
  const [user, setUser] = useState<any>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPw, setAuthPw] = useState("");
  const [authError, setAuthError] = useState("");
  const [editingMemo, setEditingMemo] = useState<string | null>(null);
  const [memoText, setMemoText] = useState("");
  const [authPwConfirm, setAuthPwConfirm] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [isMobile, setIsMobile] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [tradesViewMode, setTradesViewMode] = useState<"date"|"stock">("date");
  const [expandedStocks, setExpandedStocks] = useState<Set<string>>(new Set());
  const [chartType, setChartType] = useState<"day"|"week"|"month">("day");
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const [chartHigh, setChartHigh] = useState<number>(0);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    const saved = localStorage.getItem("stocknote_fontScale");
    if (saved) setFontScale(parseFloat(saved));
    return () => window.removeEventListener("resize", check);
  }, []);

  // Chart loading
  useEffect(() => {
    if (!chartRef.current || !selInst || view !== "detail") return;
    const symbol = instruments.find(i => i.id === selInst)?.symbol;
    if (!symbol) return;
    let cancelled = false;

    const loadChart = async () => {
      if (!(window as any).LightweightCharts) {
        await new Promise<void>((resolve) => {
          const s = document.createElement("script");
          s.src = "https://unpkg.com/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js";
          s.onload = () => resolve();
          document.head.appendChild(s);
        });
      }
      if (cancelled) return;
      const LWC = (window as any).LightweightCharts;

      const res = await fetch(`/api/chart?symbol=${symbol}&type=${chartType}&count=${chartType === "month" ? "120" : chartType === "week" ? "150" : "250"}`);
      const data = await res.json();
      if (cancelled || !data.length) return;

      // Calculate high since first buy
      const pos = positions.find((p: any) => p.id === selInst);
      const firstBuyDate = pos?.firstBuyDate || "";
      const dataSinceBuy = firstBuyDate ? data.filter((d: any) => d.time >= firstBuyDate) : data;
      const high = dataSinceBuy.length > 0 ? Math.max(...dataSinceBuy.map((d: any) => d.close)) : 0;
      setChartHigh(high);

      if (chartInstanceRef.current) { chartInstanceRef.current.remove(); chartInstanceRef.current = null; }
      chartRef.current!.innerHTML = "";

      const chart = LWC.createChart(chartRef.current!, {
        width: chartRef.current!.clientWidth,
        height: isMobile ? 280 : 380,
        layout: { background: { type: "solid", color: "#0a0e18" }, textColor: "#94a3b8", fontSize: 11 },
        grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.03)" } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
        timeScale: { borderColor: "rgba(255,255,255,0.06)", timeVisible: false },
      });
      chartInstanceRef.current = chart;

      const candle = chart.addCandlestickSeries({
        upColor: "#ef4444", downColor: "#3b82f6",
        borderUpColor: "#ef4444", borderDownColor: "#3b82f6",
        wickUpColor: "#ef4444", wickDownColor: "#3b82f6",
      });
      candle.setData(data.map((d: any) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));

      if (pos && pos.avgPrice > 0) {
        candle.createPriceLine({
          price: pos.avgPrice,
          color: '#2dd4bf', // 튀는 민트색 계열 (원하시는 색상 코드로 변경 가능)
          lineWidth: 2,
          lineStyle: 2, // 2: 점선(Dashed) 스타일을 의미합니다. (0은 실선)
          axisLabelVisible: true,
          title: '평단가',
        });
      }
      
      const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      vol.setData(data.map((d: any) => ({ time: d.time, value: d.volume, color: d.close >= d.open ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.2)" })));

      const ma5 = chart.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      ma5.setData(data.map((d: any, i: number, arr: any[]) => i < 4 ? null : { time: d.time, value: Math.round((arr[i].close + arr[i-1].close + arr[i-2].close + arr[i-3].close + arr[i-4].close) / 5) }).filter(Boolean));

      const ma20 = chart.addLineSeries({ color: "#8b5cf6", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      ma20.setData(data.map((d: any, i: number, arr: any[]) => { if (i < 19) return null; let s = 0; for (let j = 0; j < 20; j++) s += arr[i-j].close; return { time: d.time, value: Math.round(s / 20) }; }).filter(Boolean));

      chart.timeScale().fitContent();
      const ro = new ResizeObserver(() => { if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth }); });
      ro.observe(chartRef.current!);
    };

    loadChart();
    return () => { cancelled = true; if (chartInstanceRef.current) { chartInstanceRef.current.remove(); chartInstanceRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selInst, chartType, view]);

  // Browser back/forward support
  useEffect(() => {
    const handlePop = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#stock/")) {
        const id = hash.replace("#stock/", "");
        setSelInst(id);
        setView("detail");
      } else if (hash === "#trades") {
        setView("trades");
        setSelInst(null);
      } else if (hash === "#add") {
        setView("add");
        setSelInst(null);
      } else if (hash === "#global") {
        setView("global");
        setSelInst(null);
      } else {
        setView("dashboard");
        setSelInst(null);
      }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  function navigateTo(v: string, instId?: string) {
    if (v === "detail" && instId) {
      window.history.pushState(null, "", `#stock/${instId}`);
      setSelInst(instId);
      setForm(f => ({ ...f, instrument_id: instId, quantity: "", price: "", note: "추가 매수" }));
    } else if (v === "trades") {
      window.history.pushState(null, "", "#trades");
    } else if (v === "add") {
      window.history.pushState(null, "", "#add");
      setForm(f => { const active = hasActivePosition(trades, f.instrument_id); return { ...f, note: f.side === "BUY" && active && !f.note.trim() ? "추가 매수" : f.note }; });
    } else if (v === "global") {
      window.history.pushState(null, "", "#global");
    } else {
      window.history.pushState(null, "", window.location.pathname);
    }
    setView(v);
  }

  function goBack() {
    window.history.back();
  }

  useEffect(() => {
    if (view === "global") {
      fetch("/api/global-indicators").then(r => r.json()).then(d => setGlobalData(d)).catch(() => {});
    }
  }, [view]);

  useEffect(() => {
    if (!globalChartRef.current || !globalSel || !globalData[globalSel]) return;
    let cancelled = false;
    const yahooSymbol = globalData[globalSel].yahooSymbol;
    if (!yahooSymbol) return;

    const loadGlobalChart = async () => {
      if (!(window as any).LightweightCharts) {
        await new Promise<void>((resolve) => {
          const s = document.createElement("script");
          s.src = "https://unpkg.com/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js";
          s.onload = () => resolve();
          document.head.appendChild(s);
        });
      }
      if (cancelled) return;
      const LWC = (window as any).LightweightCharts;

      const res = await fetch(`/api/global-chart?symbol=${encodeURIComponent(yahooSymbol)}&range=6mo`);
      const data = await res.json();
      if (cancelled || !data.length) return;

      if (globalChartInstanceRef.current) { globalChartInstanceRef.current.remove(); globalChartInstanceRef.current = null; }
      globalChartRef.current!.innerHTML = "";

      const chart = LWC.createChart(globalChartRef.current!, {
        width: globalChartRef.current!.clientWidth,
        height: isMobile ? 250 : 350,
        layout: { background: { type: "solid", color: "#0a0e18" }, textColor: "#94a3b8", fontSize: 11 },
        grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.03)" } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
        timeScale: { borderColor: "rgba(255,255,255,0.06)", timeVisible: false },
      });
      globalChartInstanceRef.current = chart;

      const line = chart.addLineSeries({ color: "#a78bfa", lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      line.setData(data.map((d: any) => ({ time: d.time, value: d.close })));
      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => { if (globalChartRef.current) chart.applyOptions({ width: globalChartRef.current.clientWidth }); });
      ro.observe(globalChartRef.current!);
    };

    loadGlobalChart();
    return () => { cancelled = true; if (globalChartInstanceRef.current) { globalChartInstanceRef.current.remove(); globalChartInstanceRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSel, globalData]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      if (session?.user) loadData();
      else setLoading(false);
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      if (session?.user) loadData();
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signInGoogle() {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: "https://stocknote-mu.vercel.app" } });
  }

  async function signInKakao() {
    await supabase.auth.signInWithOAuth({ provider: "kakao", options: { redirectTo: "https://stocknote-mu.vercel.app", scopes: "profile_nickname profile_image" } });
  }

  async function signInEmail() {
    setAuthError("");
    setAuthSuccess("");
    if (authMode === "signup") {
      if (authPw !== authPwConfirm) { setAuthError("비밀번호가 일치하지 않습니다"); return; }
      if (authPw.length < 6) { setAuthError("비밀번호는 6자 이상이어야 합니다"); return; }
      const { error } = await supabase.auth.signUp({ email: authEmail, password: authPw });
      if (error) setAuthError(error.message);
      else setAuthSuccess("인증 메일을 확인해주세요! 메일함을 확인 후 인증 링크를 클릭하세요.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPw });
      if (error) setAuthError(error.message);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null); setInstruments([]); setTrades([]); setCurrentPrices({});
  }

  async function saveInstMemo(instId: string) {
    await supabase.from("instruments").update({ memo: memoText }).eq("id", instId);
    setInstruments(p => p.map(i => i.id === instId ? { ...i, memo: memoText } : i));
    setEditingMemo(null);
  }

  async function saveTradeNote(tradeId: string) {
    await supabase.from("trades").update({ note: noteText }).eq("id", tradeId);
    setTrades(p => p.map(t => t.id === tradeId ? { ...t, note: noteText } : t));
    setEditingNote(null);
  }

  async function loadData() {
    try {
      const mRes = await fetch("/api/market-index");
      const mData = await mRes.json();
      setMarketIndex(mData);
    } catch (e) {}
    setLoading(true);
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) { setLoading(false); return; }
    const { data: i } = await supabase.from("instruments").select("*").eq("user_id", currentUser.id);
    const { data: t } = await supabase.from("trades").select("*").eq("user_id", currentUser.id);
    setInstruments(i || []); setTrades(t || []);
    if (i && i.length > 0) setForm(f => ({ ...f, instrument_id: f.instrument_id || i[0].id }));
    setLoading(false);

    if (i && i.length > 0) {
      const prices: Record<string, number> = {};
      const changes: Record<string, number> = {};
      await Promise.all(i.map(async (inst) => {
        try {
          const res = await fetch(`/api/stock-price?symbol=${inst.symbol}`);
          const data = await res.json();
          if (data.price) prices[inst.id] = data.price;
          if (data.changeRate !== undefined) changes[inst.id] = data.changeRate;
        } catch (e) {}
      }));
      setCurrentPrices(prices);
      setDayChanges(changes);
    }
  }

  async function refreshPrices() {
    if (instruments.length === 0) return;
    setPriceLoading(true);
    // Refresh market index
    try { const mRes = await fetch("/api/market-index"); const mData = await mRes.json(); setMarketIndex(mData); } catch (e) {}
    const prices: Record<string, number> = {};
    const changes: Record<string, number> = {};
    await Promise.all(instruments.map(async (inst) => {
      try {
        const res = await fetch(`/api/stock-price?symbol=${inst.symbol}`);
        const data = await res.json();
        if (data.price) prices[inst.id] = data.price;
        if (data.changeRate !== undefined) changes[inst.id] = data.changeRate;
      } catch (e) {}
    }));
    setCurrentPrices(prices);
    setDayChanges(changes);
    setPriceLoading(false);
  }

  async function searchStock(q: string) {
    setSearchQuery(q);
    if (q.length < 1) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/stock-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (e) { setSearchResults([]); }
    setSearching(false);
  }

  async function selectStock(item: any) {
    const existing = instruments.find(i => i.symbol === item.symbol);
    if (existing) {
      setForm(f => ({ ...f, instrument_id: existing.id }));
      setShowNewInst(false); setSearchQuery(""); setSearchResults([]);
      return;
    }
    const { data } = await supabase.from("instruments").insert({
      symbol: item.symbol, name: item.name, market: item.market, user_id: user.id,
    }).select().single();
    if (data) {
      setInstruments(p => [...p, data]);
      setForm(f => ({ ...f, instrument_id: data.id }));
      setShowNewInst(false); setSearchQuery(""); setSearchResults([]);
    }
  }

  async function addInstrument() {
    if (!newInst.name || !newInst.symbol) return;
    const { data } = await supabase.from("instruments").insert({ symbol: newInst.symbol, name: newInst.name, market: newInst.market, user_id: user.id }).select().single();
    if (data) { setInstruments(p => [...p, data]); setForm(f => ({ ...f, instrument_id: data.id })); setNewInst({ symbol: "", name: "", market: "KOSPI" }); setShowNewInst(false); }
  }

  async function addTrade() {
    if (!form.quantity || !form.price || !form.instrument_id) return;
    const { data } = await supabase.from("trades").insert({ instrument_id: form.instrument_id, trade_date: form.trade_date, side: form.side, quantity: parseInt(form.quantity), price: parseInt(form.price), note: form.note.trim(), user_id: user.id }).select().single();
    if (data) { setTrades(p => [...p, data]); setForm(f => ({ ...f, quantity: "", price: "", note: "" })); navigateTo("dashboard"); loadData(); }
  }

  async function saveEdit() {
    if (!editTrade) return;
    const { error } = await supabase.from("trades").update({ instrument_id: editTrade.instrument_id, trade_date: editTrade.trade_date, side: editTrade.side, quantity: parseInt(editTrade.quantity), price: parseInt(editTrade.price), note: editTrade.note?.trim() || "" }).eq("id", editTrade.id);
    if (!error) { setTrades(p => p.map(t => t.id === editTrade.id ? { ...t, instrument_id: editTrade.instrument_id, trade_date: editTrade.trade_date, side: editTrade.side, quantity: parseInt(editTrade.quantity), price: parseInt(editTrade.price), note: editTrade.note?.trim() || "" } : t)); setEditTrade(null); }
  }

  async function delTrade(id: string) {
    const { error } = await supabase.from("trades").delete().eq("id", id);
    if (!error) { setTrades(p => p.filter(t => t.id !== id)); setEditTrade(null); }
  }

  const positions = useMemo(() => instruments.map(inst => {
    const it = trades.filter(t => t.instrument_id === inst.id); if (!it.length) return null;
    const isETF = inst.name.startsWith("KODEX") || inst.name.startsWith("TIGER") || inst.name.startsWith("ARIRANG") || inst.name.startsWith("KBSTAR") || inst.name.startsWith("SOL") || inst.name.startsWith("ACE") || inst.name.startsWith("HANARO");
    const pos = calculatePosition(it, isETF ? "ETF" : inst.market); if (pos.totalQty <= 0) return null;
    const cp = currentPrices[inst.id] || 0;
    const stockRet = cp > 0 && pos.avgPrice > 0 ? (cp / pos.avgPrice) - 1 : 0;
    const br = BENCH_RET[inst.market] || 0; const rr = stockRet - br;
    const noMemo = it.filter(t => !t.note?.trim()).length;
    // Find first buy memo in CURRENT position (after firstBuyDate from calculatePosition)
    const currentTrades = pos.firstBuyDate ? [...it].filter(t => t.trade_date >= pos.firstBuyDate).sort((a, b) => new Date(a.trade_date).getTime() - new Date(b.trade_date).getTime()) : [];
    const fm = currentTrades.find(t => t.side === "BUY" && t.note?.trim() && t.note.trim() !== "추가 매수");
    return { ...inst, ...pos, currentPrice: cp, stockReturn: stockRet, benchReturn: br, relativeReturn: rr, alertLevel: getAlertLevel(rr), evalAmount: cp * pos.totalQty, unrealizedPnl: (cp - pos.avgPrice) * pos.totalQty, tradeCount: it.length, noMemoCount: noMemo, firstMemo: fm?.note || "" };
  }).filter(Boolean) as any[], [instruments, trades, currentPrices]);

  const allRealizedPnl = useMemo(() => instruments.reduce((sum: number, inst: any) => {
    const it = trades.filter((t: any) => t.instrument_id === inst.id); if (!it.length) return sum;
    const isETF = inst.name.startsWith("KODEX") || inst.name.startsWith("TIGER") || inst.name.startsWith("ARIRANG") || inst.name.startsWith("KBSTAR") || inst.name.startsWith("SOL") || inst.name.startsWith("ACE") || inst.name.startsWith("HANARO");
    const pos = calculatePosition(it, isETF ? "ETF" : inst.market);
    return sum + pos.realizedPnl;
  }, 0), [instruments, trades]);

  const totals = useMemo(() => {
    const totalInvested = positions.reduce((s: number, p: any) => s + p.avgPrice * p.totalQty, 0);
    const totalEval = positions.reduce((s: number, p: any) => s + (p.currentPrice > 0 ? p.currentPrice * p.totalQty : p.avgPrice * p.totalQty), 0);
    const totalUnrealized = positions.reduce((s: number, p: any) => s + (p.currentPrice > 0 ? (p.currentPrice - p.avgPrice) * p.totalQty : 0), 0);
    const totalRealized = allRealizedPnl;
    const totalTrades = trades.length;
    const noMemo = trades.filter(t => !t.note?.trim()).length;
    const totalReturnRate = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;
    return { totalInvested, totalEval, totalUnrealized, totalRealized, totalTrades, noMemo, totalReturnRate };
  }, [positions, trades, allRealizedPnl]);

  const instTrades = useMemo(() => selInst ? trades.filter(t => t.instrument_id === selInst).sort((a, b) => { const d = new Date(b.trade_date).getTime() - new Date(a.trade_date).getTime(); return d !== 0 ? d : a.id.localeCompare(b.id); }) : [], [trades, selInst]);
  const selPos = positions.find((p: any) => p.id === selInst);
  const selInstData = instruments.find(i => i.id === selInst);

  // --- LOADING ---
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#080c14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#e2e8f0", fontFamily: "'Pretendard','Apple SD Gothic Neo',-apple-system,sans-serif", gap: 16 }}>
      <div style={{ fontSize: 36 }}>📊</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>주식노트</div>
      <div style={{ fontSize: 13, color: "#64748b" }}>손실을 줄이는 투자 습관</div>
    </div>
  );

  // --- AUTH ---
  if (!user) return (
    <div style={{ minHeight: "100vh", background: "#080c14", display: "flex", alignItems: "center", justifyContent: "center", color: "#e2e8f0", fontFamily: "'Pretendard','Apple SD Gothic Neo',-apple-system,sans-serif" }}>
      <div style={{ width: 360, padding: 32, borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#3b82f6,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📊</div>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>주식노트</span>
        </div>
        <button onClick={signInKakao} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#FEE500", color: "#191919", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3C6.48 3 2 6.36 2 10.44c0 2.62 1.75 4.93 4.38 6.24l-1.12 4.16c-.1.36.32.64.62.42l4.94-3.26c.38.04.77.06 1.18.06 5.52 0 10-3.36 10-7.62S17.52 3 12 3z" fill="#191919"/></svg>
          카카오로 시작하기
        </button>
        <button onClick={signInGoogle} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e2e8f0", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Google로 시작하기
        </button>
        <div style={{ fontSize: 11, color: "#475569", textAlign: "center", marginBottom: 16 }}>※ 카카오톡 등 앱 내 브라우저에서는 카카오 로그인을 이용해주세요</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
          <span style={{ fontSize: 12, color: "#64748b" }}>또는</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>
        <input type="email" placeholder="이메일" value={authEmail} onChange={(e: any) => setAuthEmail(e.target.value)} style={{ ...is, marginBottom: 10 }} />
        <input type="password" placeholder="비밀번호" value={authPw} onChange={(e: any) => setAuthPw(e.target.value)} style={{ ...is, marginBottom: 10 }} onKeyDown={(e: any) => authMode === "login" && e.key === "Enter" && signInEmail()} />
        {authMode === "signup" && <input type="password" placeholder="비밀번호 확인" value={authPwConfirm} onChange={(e: any) => setAuthPwConfirm(e.target.value)} style={{ ...is, marginBottom: 10 }} onKeyDown={(e: any) => e.key === "Enter" && signInEmail()} />}
        {authError && <div style={{ fontSize: 12, color: "#f87171", marginBottom: 10 }}>{authError}</div>}
        {authSuccess && <div style={{ fontSize: 12, color: "#34d399", marginBottom: 10 }}>{authSuccess}</div>}
        <button onClick={signInEmail} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#3b82f6,#7c3aed)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 12 }}>
          {authMode === "login" ? "로그인" : "회원가입"}
        </button>
        <div style={{ textAlign: "center", fontSize: 13, color: "#64748b" }}>
          {authMode === "login" ? "계정이 없나요? " : "이미 계정이 있나요? "}
          <span onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")} style={{ color: "#8b5cf6", cursor: "pointer", fontWeight: 600 }}>
            {authMode === "login" ? "회원가입" : "로그인"}
          </span>
        </div>
      </div>
    </div>
  );

  // --- MAIN APP ---
  return (
    <div style={{ minHeight: "100vh", background: "#080c14", color: "#e2e8f0", fontFamily: "'Pretendard','Apple SD Gothic Neo',-apple-system,sans-serif", zoom: fontScale !== 1 ? fontScale : undefined }}>

      {/* HEADER */}
      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(8,12,20,0.95)", position: "sticky", top: 0, zIndex: 50, gap: 6 }}>
        {view === "detail" ? (
          <button onClick={goBack} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#94a3b8", fontSize: 14, cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}><IconBack /> 뒤로</button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: "linear-gradient(135deg,#3b82f6,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>📊</div>
            {!isMobile && <span style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc" }}>주식노트</span>}
          </div>
        )}
        {view !== "detail" && (
          <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 2 }}>
            {[{ k: "dashboard", l: "보유현황" }, { k: "trades", l: "거래내역" }, { k: "global", l: "국제지표" }, { k: "add", l: "+ 기록" }].map(t => (
              <button key={t.k} onClick={() => navigateTo(t.k)} style={{ padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: view === t.k ? 700 : 500, background: view === t.k ? "rgba(255,255,255,0.08)" : "transparent", color: view === t.k ? "#f1f5f9" : "#64748b", whiteSpace: "nowrap" }}>{t.l}</button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flex: "0 0 auto" }}>
          <button onClick={() => setShowSettings(!showSettings)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: showSettings ? "rgba(255,255,255,0.08)" : "transparent", color: "#64748b", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>⚙️</button>
          <button onClick={signOut} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#64748b", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap", flex: "0 0 auto" }}>로그아웃</button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div style={{ padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>글자 크기</span>
            {[{ v: 0.85, l: "작게" }, { v: 1, l: "보통" }, { v: 1.15, l: "크게" }, { v: 1.3, l: "아주 크게" }].map(({ v, l }) => (
              <button key={v} onClick={() => { setFontScale(v); localStorage.setItem("stocknote_fontScale", String(v)); }} style={{ padding: "4px 10px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: fontScale === v ? 700 : 500, background: fontScale === v ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.04)", color: fontScale === v ? "#a78bfa" : "#64748b", cursor: "pointer" }}>{l}</button>
            ))}
          </div>
        </div>
      )}

      <main style={{ maxWidth: 680, margin: "0 auto", padding: "16px 12px 60px" }}>

        {/* ============ DASHBOARD ============ */}
        {view === "dashboard" && <div>

          {/* Market Index Bar */}
          {(marketIndex["KOSPI"] || marketIndex["KOSDAQ"]) && (
            <div style={{ display: "flex", gap: 12, marginBottom: 12, padding: "8px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              {["KOSPI", "KOSDAQ"].map(key => {
                const idx = marketIndex[key];
                if (!idx) return null;
                const isUp = idx.changeRate >= 0;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{key}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isUp ? "#ef4444" : "#3b82f6" }}>{isUp ? "▲" : "▼"} {isUp ? "+" : ""}{idx.changeRate.toFixed(2)}%</span>
                  </div>
                );
              })}
              <button onClick={refreshPrices} disabled={priceLoading} style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", fontSize: 11, cursor: "pointer", padding: 0 }}>{priceLoading ? "갱신중..." : "🔄"}</button>
            </div>
          )}

          {/* Summary Card - 증권앱 스타일 */}
          {(positions.length > 0 || allRealizedPnl !== 0) && (
            <div style={{ ...cs, marginBottom: 16, padding: "20px 20px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>평가금액</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.5px" }}>{fmt(totals.totalEval)}원</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: totals.totalUnrealized >= 0 ? "#ef4444" : "#3b82f6", marginTop: 4 }}>
                    {fmt(Math.abs(totals.totalUnrealized))}원 &nbsp;{totals.totalReturnRate >= 0 ? "+" : ""}{totals.totalReturnRate.toFixed(2)}%
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>실현손익</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: totals.totalRealized >= 0 ? "#ef4444" : "#3b82f6" }}>
                    {totals.totalRealized >= 0 ? "+" : ""}{fmt(totals.totalRealized)}원
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 12, color: "#64748b" }}>
                <span>투자금 {fmt(totals.totalInvested)}원</span>
                <span>기록률 <b style={{ color: "#a78bfa" }}>{totals.totalTrades > 0 ? Math.round(((totals.totalTrades - totals.noMemo) / totals.totalTrades) * 100) : 0}%</b></span>
                <span>{positions.length}종목 · {totals.totalTrades}건</span>
              </div>
            </div>
          )}

          {/* Alert */}
          {totals.noMemo > 0 ? (
            <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", display: "flex", alignItems: "center", gap: 8 }}>
              <IconWarn /><span style={{ fontSize: 12, color: "#fbbf24" }}>이유 미기록 거래 <b>{totals.noMemo}건</b></span>
            </div>
          ) : trades.length > 0 ? (
            <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.12)", display: "flex", alignItems: "center", gap: 8 }}>
              <IconCheck /><span style={{ fontSize: 12, color: "#4ade80" }}>모든 거래에 이유가 기록됨</span>
            </div>
          ) : null}

          {/* Empty State */}
          {!positions.length && trades.length > 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b" }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>현재 보유 중인 종목이 없습니다</div>
              <button onClick={() => navigateTo("add")} style={{ padding: "10px 24px", borderRadius: 8, border: "1px dashed rgba(124,58,237,0.3)", background: "rgba(124,58,237,0.06)", color: "#a78bfa", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>새 거래 기록하기</button>
            </div>
          )}

          {!positions.length && !trades.length && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>아직 기록된 거래가 없습니다</div>
              <button onClick={() => navigateTo("add")} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3b82f6,#7c3aed)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>첫 거래 기록하기</button>
            </div>
          )}

          {/* Stock Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...positions].sort((a: any, b: any) => (b.currentPrice > 0 ? b.currentPrice * b.totalQty : b.avgPrice * b.totalQty) - (a.currentPrice > 0 ? a.currentPrice * a.totalQty : a.avgPrice * a.totalQty)).map((p: any) => {
              const buyCount = trades.filter(t => t.instrument_id === p.id && t.side === "BUY").length;
              const sellCount = trades.filter(t => t.instrument_id === p.id && t.side === "SELL").length;
              const isExpanded = expandedCards.has(p.id);
              const toggleExpand = (e: any) => { e.stopPropagation(); setExpandedCards(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; }); };

              if (isMobile) return (
                <div key={p.id} onClick={() => navigateTo("detail", p.id)} style={{ ...cs, padding: "12px 14px", cursor: "pointer" }}>
                  {/* Row 1: Logo+Name left, Eval right */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ flex: "0 0 36px" }}>
                        <img src={`https://file.alphasquare.co.kr/media/images/stock_logo/kr/${p.symbol}.png`} alt={p.name} onError={(e: any) => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }} style={{ width: 36, height: 36, borderRadius: 8 }} /><div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.06)", display: "none", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#94a3b8" }}>{p.name.slice(0,2)}</div>
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</span>
                          {p.noMemoCount > 0 && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#f59e0b" }} />}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{p.totalQty}주 · {holdingWeeks(p.firstBuyDate)}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>{p.currentPrice > 0 ? fmt(p.currentPrice * p.totalQty) : fmt(p.avgPrice * p.totalQty)}원</div>
                        {p.currentPrice > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: p.unrealizedPnl >= 0 ? "#ef4444" : "#3b82f6", marginTop: 1 }}>{p.unrealizedPnl >= 0 ? "▲" : "▼"}{fmt(Math.abs(p.unrealizedPnl))}원 {(p.stockReturn >= 0 ? "+" : "")}{(p.stockReturn * 100).toFixed(2)}%</div>}
                      </div>
                      <button onClick={toggleExpand} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: "2px", fontSize: 12, lineHeight: 1, marginTop: 2 }}>{isExpanded ? "▲" : "▼"}</button>
                    </div>
                  </div>
                  {/* Row 2: Memo + Reason */}
                  <div style={{ marginTop: 6, paddingLeft: 46, display: "flex", gap: 8 }}>
                    <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.memo ? <span style={{ color: "#e2e8f0" }}>&ldquo;{p.memo}&rdquo;</span> : <span style={{ color: "#475569" }}>메모없음</span>}</div>
                    <div style={{ fontSize: 11, color: "#8b9dc3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.firstMemo || ""}</div>
                  </div>
                  {/* Row 3: Toggle area — Price/Index + Counts */}
                  {isExpanded && (
                    <div style={{ marginTop: 8, paddingLeft: 46, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: (dayChanges[p.id] || 0) >= 0 ? "#ef4444" : "#3b82f6" }}>{fmt(p.currentPrice || 0)}원({(dayChanges[p.id] || 0) >= 0 ? "+" : ""}{(dayChanges[p.id] || 0).toFixed(1)}%)</div>
                        <div style={{ fontSize: 11, color: (marketIndex[p.market]?.changeRate || 0) >= 0 ? "#ef4444" : "#3b82f6", marginTop: 2 }}>{p.market} {(marketIndex[p.market]?.changeRate || 0) >= 0 ? "+" : ""}{(marketIndex[p.market]?.changeRate || 0).toFixed(2)}%</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "#b97070" }}>매수{buyCount}건</div>
                        <div style={{ fontSize: 11, color: "#7090b9", marginTop: 2 }}>매도{sellCount}건</div>
                      </div>
                    </div>
                  )}
                </div>
              );

              /* Desktop layout */
              return (
              <div key={p.id} onClick={() => navigateTo("detail", p.id)} style={{ ...cs, padding: "12px 14px", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  {/* Col 1: Logo */}
                  <div style={{ flex: "0 0 40px", marginRight: 12 }}>
                    <img src={`https://file.alphasquare.co.kr/media/images/stock_logo/kr/${p.symbol}.png`} alt={p.name} onError={(e: any) => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }} style={{ width: 40, height: 40, borderRadius: 10 }} /><div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,0.06)", display: "none", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#94a3b8" }}>{p.name.slice(0,2)}</div>
                  </div>
                  {/* Col 2: Name + holding */}
                  <div style={{ flex: "0 0 130px", minWidth: 0, marginRight: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: p.name.length > 8 ? (p.name.length > 10 ? 11 : 12) : 14, fontWeight: 700, whiteSpace: "nowrap" }}>{p.name}</span>
                      {p.noMemoCount > 0 && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#f59e0b", flex: "0 0 5px" }} />}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{p.totalQty}주 · {holdingWeeks(p.firstBuyDate)}</div>
                  </div>
                  {/* Col 3: Eval + PnL */}
                  <div style={{ flex: "0 0 130px", marginRight: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap" }}>{p.currentPrice > 0 ? fmt(p.currentPrice * p.totalQty) : fmt(p.avgPrice * p.totalQty)}원</div>
                    {p.currentPrice > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: p.unrealizedPnl >= 0 ? "#ef4444" : "#3b82f6", marginTop: 1, whiteSpace: "nowrap" }}>{p.unrealizedPnl >= 0 ? "▲" : "▼"}{fmt(Math.abs(p.unrealizedPnl))}원 {(p.stockReturn >= 0 ? "+" : "")}{(p.stockReturn * 100).toFixed(2)}%</div>}
                  </div>
                  {/* Col 4: Memo + Reason */}
                  <div style={{ flex: "1 1 70px", minWidth: 0, marginRight: 8 }}>
                    <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.memo ? <span style={{ color: "#e2e8f0" }}>&ldquo;{p.memo}&rdquo;</span> : <span style={{ color: "#475569" }}>메모없음</span>}</div>
                    <div style={{ fontSize: 11, color: "#8b9dc3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{p.firstMemo || ""}</div>
                  </div>
                  {/* Col 5: Price + Index */}
                  <div style={{ flex: "0 0 auto", textAlign: "right", marginRight: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: (dayChanges[p.id] || 0) >= 0 ? "#ef4444" : "#3b82f6", whiteSpace: "nowrap" }}>{fmt(p.currentPrice || 0)}원({(dayChanges[p.id] || 0) >= 0 ? "+" : ""}{(dayChanges[p.id] || 0).toFixed(1)}%)</div>
                    <div style={{ fontSize: 11, color: (marketIndex[p.market]?.changeRate || 0) >= 0 ? "#ef4444" : "#3b82f6", marginTop: 2, whiteSpace: "nowrap" }}>{p.market} {(marketIndex[p.market]?.changeRate || 0) >= 0 ? "+" : ""}{(marketIndex[p.market]?.changeRate || 0).toFixed(2)}%</div>
                  </div>
                  {/* Col 6: Buy/Sell */}
                  <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#b97070", whiteSpace: "nowrap" }}>매수{buyCount}건</div>
                    <div style={{ fontSize: 11, color: "#7090b9", whiteSpace: "nowrap", marginTop: 2 }}>매도{sellCount}건</div>
                  </div>
                </div>
              </div>
            ); })}
          </div>

          {/* Add Trade Button */}
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <button onClick={() => navigateTo("add")} style={{ padding: "12px 24px", borderRadius: 10, border: "1px dashed rgba(124,58,237,0.3)", background: "rgba(124,58,237,0.06)", color: "#a78bfa", fontSize: 13, fontWeight: 600, cursor: "pointer", width: "100%" }}>+ 거래 기록 추가하기</button>
          </div>

        </div>}

        {/* ============ DETAIL ============ */}
        {view === "detail" && selInstData && <div>
          {/* Header Card */}
          <div style={{ ...cs, marginBottom: 16, padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ flex: "0 0 44px" }}>
                  <img src={`https://file.alphasquare.co.kr/media/images/stock_logo/kr/${selInstData.symbol}.png`} alt={selInstData.name} onError={(e: any) => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }} style={{ width: 44, height: 44, borderRadius: 10 }} /><div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(255,255,255,0.06)", display: "none", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#94a3b8" }}>{selInstData.name.slice(0,2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>{selInstData.name}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{selInstData.symbol} · {selInstData.market}</div>
                </div>
              </div>
              {selPos && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{selPos.currentPrice > 0 ? fmt(selPos.currentPrice * selPos.totalQty) : fmt(selPos.avgPrice * selPos.totalQty)}원</div>
                  {selPos.currentPrice > 0 && (
                    <div style={{ fontSize: 14, fontWeight: 700, color: selPos.unrealizedPnl >= 0 ? "#ef4444" : "#3b82f6", marginTop: 2 }}>
                      {selPos.unrealizedPnl >= 0 ? "▲" : "▼"}{fmt(Math.abs(selPos.unrealizedPnl))}원  {(selPos.stockReturn >= 0 ? "+" : "")}{(selPos.stockReturn * 100).toFixed(2)}%
                    </div>
                  )}
                </div>
              )}
            </div>
            {selPos && (
              <div style={{ display: "flex", gap: 10, marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 12, color: "#64748b", flexWrap: "wrap" }}>
                <span>평균단가 <b style={{ color: "#e2e8f0" }}>{fmt(selPos.avgPrice)}원</b></span>
                <span>보유 <b style={{ color: "#e2e8f0" }}>{selPos.totalQty}주</b></span>
                <span>{holdingWeeks(selPos.firstBuyDate)}</span>
                <span style={{ color: (dayChanges[selInstData.id] || 0) >= 0 ? "#ef4444" : "#3b82f6" }}>오늘 {selPos.currentPrice > 0 ? fmt(Math.abs(Math.round(selPos.currentPrice * (dayChanges[selInstData.id] || 0) / (100 + (dayChanges[selInstData.id] || 0))))) + "원" : ""} ({(dayChanges[selInstData.id] || 0) >= 0 ? "+" : ""}{(dayChanges[selInstData.id] || 0).toFixed(1)}%) {(dayChanges[selInstData.id] || 0) >= 0 ? "상승" : "하락"}</span>
              </div>
            )}
          </div>

          {/* Drop Levels from High */}
          {chartHigh > 0 && selPos && (
            <div style={{ ...cs, marginBottom: 8, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: "#94a3b8", fontWeight: 600 }}>매수 후 고점 <b style={{ color: "#ef4444" }}>{fmt(chartHigh)}원</b></span>
                <span style={{ color: "#475569" }}>|</span>
                <span style={{ fontWeight: 600 }}>현재 <b style={{ color: "#e2e8f0" }}>{fmt(selPos.currentPrice)}원</b></span>
                <span style={{ color: selPos.currentPrice >= chartHigh ? "#ef4444" : "#3b82f6", fontWeight: 700 }}>({selPos.currentPrice >= chartHigh ? "고점" : `${((selPos.currentPrice / chartHigh - 1) * 100).toFixed(1)}%`})</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[-7, -10, -12, -15].map(pct => {
                  const price = Math.round(chartHigh * (1 + pct / 100));
                  const isReached = selPos.currentPrice <= price;
                  const isCurrentLevel = isReached && (pct === -7 || selPos.currentPrice <= Math.round(chartHigh * (1 + pct / 100)));
                  const nextPct = [-7, -10, -12, -15][[-7, -10, -12, -15].indexOf(pct) - 1];
                  const nextPrice = nextPct ? Math.round(chartHigh * (1 + nextPct / 100)) : chartHigh;
                  const isExactLevel = isReached && selPos.currentPrice > (pct === -15 ? 0 : Math.round(chartHigh * (1 + ([-7,-10,-12,-15][[-7,-10,-12,-15].indexOf(pct) + 1] || -100) / 100)));
                  return (
                    <div key={pct} style={{ padding: "5px 12px", borderRadius: 8, fontSize: 11, background: isReached ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${isExactLevel ? "#ef4444" : isReached ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.05)"}`, position: "relative" }}>
                      {isExactLevel && <span style={{ position: "absolute", top: -6, right: -4, fontSize: 8, background: "#ef4444", color: "#fff", borderRadius: 4, padding: "1px 4px", fontWeight: 700 }}>도달</span>}
                      <span style={{ color: isReached ? "#f87171" : "#64748b", fontWeight: isReached ? 700 : 500 }}>{pct}%</span> <span style={{ color: isReached ? "#f87171" : "#e2e8f0", fontWeight: 600 }}>{fmt(price)}원</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Drop Levels from Avg Price */}
          {selPos && selPos.avgPrice > 0 && selPos.currentPrice > 0 && (
            <div style={{ ...cs, marginBottom: 8, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: "#94a3b8", fontWeight: 600 }}>평균단가 <b style={{ color: "#e2e8f0" }}>{fmt(selPos.avgPrice)}원</b></span>
                <span style={{ color: "#475569" }}>|</span>
                <span style={{ fontWeight: 600 }}>현재 <b style={{ color: "#e2e8f0" }}>{fmt(selPos.currentPrice)}원</b></span>
                <span style={{ color: selPos.currentPrice >= selPos.avgPrice ? "#ef4444" : "#3b82f6", fontWeight: 700 }}>({selPos.currentPrice >= selPos.avgPrice ? "+" : ""}{((selPos.currentPrice / selPos.avgPrice - 1) * 100).toFixed(1)}%)</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[-7, -10, -12, -15].map(pct => {
                  const price = Math.round(selPos.avgPrice * (1 + pct / 100));
                  const isReached = selPos.currentPrice <= price;
                  const levels = [-7, -10, -12, -15];
                  const idx = levels.indexOf(pct);
                  const nextLevelPrice = idx < levels.length - 1 ? Math.round(selPos.avgPrice * (1 + levels[idx + 1] / 100)) : 0;
                  const isExactLevel = isReached && selPos.currentPrice > nextLevelPrice;
                  return (
                    <div key={pct} style={{ padding: "5px 12px", borderRadius: 8, fontSize: 11, background: isReached ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${isExactLevel ? "#3b82f6" : isReached ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.05)"}`, position: "relative" }}>
                      {isExactLevel && <span style={{ position: "absolute", top: -6, right: -4, fontSize: 8, background: "#3b82f6", color: "#fff", borderRadius: 4, padding: "1px 4px", fontWeight: 700 }}>도달</span>}
                      <span style={{ color: isReached ? "#60a5fa" : "#64748b", fontWeight: isReached ? 700 : 500 }}>{pct}%</span> <span style={{ color: isReached ? "#60a5fa" : "#e2e8f0", fontWeight: 600 }}>{fmt(price)}원</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Chart */}
          <div style={{ ...cs, marginBottom: 16, padding: "12px 14px" }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {([["day","일봉"],["week","주봉"],["month","월봉"]] as const).map(([k,l]) => (
                <button key={k} onClick={() => setChartType(k)} style={{ padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: chartType === k ? 700 : 500, background: chartType === k ? "rgba(255,255,255,0.08)" : "transparent", color: chartType === k ? "#f1f5f9" : "#64748b", cursor: "pointer" }}>{l}</button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", fontSize: 10 }}>
                <span style={{ color: "#f59e0b" }}>● MA5</span>
                <span style={{ color: "#8b5cf6" }}>● MA20</span>
              </div>
            </div>
            <div ref={chartRef} />
          </div>

          {/* Quick Trade */}
          <div style={{ ...cs, marginBottom: 16, padding: "14px 18px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>📝 추가 매수 기록</div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 80px" }}>
                <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>날짜</label>
                <input type="date" value={form.trade_date} onChange={(e: any) => setForm(f => ({ ...f, trade_date: e.target.value }))} style={{ ...is, fontSize: 12, padding: "8px 10px" }} />
              </div>
              <div style={{ flex: "0 0 60px" }}>
                <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>수량</label>
                <input type="number" placeholder="0" value={form.quantity} onChange={(e: any) => setForm(f => ({ ...f, quantity: e.target.value }))} style={{ ...is, fontSize: 12, padding: "8px 10px" }} />
              </div>
              <div style={{ flex: "0 0 90px" }}>
                <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>단가</label>
                <input type="number" placeholder="0" value={form.price} onChange={(e: any) => setForm(f => ({ ...f, price: e.target.value }))} style={{ ...is, fontSize: 12, padding: "8px 10px" }} />
              </div>
              <button onClick={async () => { if (!form.quantity || !form.price || !selInst) return; const { data } = await supabase.from("trades").insert({ instrument_id: selInst, trade_date: form.trade_date, side: "BUY", quantity: parseInt(form.quantity), price: parseInt(form.price), note: "추가 매수", user_id: user.id }).select().single(); if (data) { setTrades(p => [...p, data]); setForm(f => ({ ...f, quantity: "", price: "" })); loadData(); } }} disabled={!form.quantity || !form.price} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: form.quantity && form.price ? "#ef4444" : "rgba(255,255,255,0.05)", color: form.quantity && form.price ? "#fff" : "#475569", fontSize: 12, fontWeight: 700, cursor: form.quantity && form.price ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>매수</button>
            </div>
            {form.quantity && form.price && <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>총 {fmt(parseInt(form.quantity) * parseInt(form.price))}원</div>}
          </div>

          {/* Instrument Memo */}
          <div style={{ ...cs, marginBottom: 16, padding: "14px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>📌 종목 메모</span>
              {editingMemo !== selInstData.id && (
                <button onClick={() => { setEditingMemo(selInstData.id); setMemoText(selInstData.memo || ""); }} style={{ fontSize: 11, color: "#8b5cf6", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>수정</button>
              )}
            </div>
            {editingMemo === selInstData.id ? (
              <div>
                <textarea value={memoText} onChange={(e: any) => setMemoText(e.target.value)} placeholder="이 종목에 대한 메모를 남겨보세요..." rows={3} style={{ ...is, resize: "vertical", fontSize: 13, lineHeight: 1.6, minHeight: 60, fontFamily: "inherit" }} autoFocus />
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setEditingMemo(null)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#64748b", fontSize: 12, cursor: "pointer" }}>취소</button>
                  <button onClick={() => saveInstMemo(selInstData.id)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#7c3aed", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>저장</button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: selInstData.memo ? "#cbd5e1" : "#475569", lineHeight: 1.6 }}>
                {selInstData.memo || "메모가 없습니다. 수정을 눌러 추가하세요."}
              </div>
            )}
          </div>

          {/* Trade Timeline */}
          {(() => {
            // Current position trades only (after last full sell)
            const pos = selPos;
            const allTrades = [...instTrades]; // already sorted newest first
            const currentTrades = pos?.firstBuyDate ? allTrades.filter(t => t.trade_date >= pos.firstBuyDate) : allTrades;
            const sortedAsc = [...currentTrades].reverse(); // oldest first
            
            const firstBuy = sortedAsc.find(t => t.side === "BUY" && t.note?.trim() && t.note.trim() !== "추가 매수");
            const addBuys = currentTrades.filter(t => t.note?.trim() === "추가 매수");
            const recentActions = currentTrades.filter(t => t.id !== firstBuy?.id && t.note?.trim() !== "추가 매수");

            // Render a single trade card (reusable)
            const renderTrade = (t: Trade) => {
              const hm = !!t.note?.trim();
              const isEditingThis = editingNote === t.id;
              return (
                <div key={t.id} style={{ ...cs, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: hm || isEditingThis ? 10 : 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: t.side === "BUY" ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)", color: t.side === "BUY" ? "#ef4444" : "#3b82f6" }}>{t.side === "BUY" ? "매수" : "매도"}</span>
                    <span style={{ fontSize: 12, color: "#64748b" }}>{t.trade_date}</span>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{t.quantity}주 × {fmt(t.price)}원</span>
                    <span style={{ fontSize: 12, fontWeight: 700, marginLeft: "auto" }}>{fmt(t.quantity * t.price)}원</span>
                  </div>
                  {isEditingThis ? (
                    <div>
                      <textarea value={noteText} onChange={(e: any) => setNoteText(e.target.value)} placeholder="매매 이유를 기록하세요..." rows={2} style={{ ...is, resize: "vertical", fontSize: 13, lineHeight: 1.6, minHeight: 50, fontFamily: "inherit" }} autoFocus />
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                        <button onClick={() => { if (confirm("이 거래 기록을 삭제하시겠습니까?")) delTrade(t.id); }} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>삭제</button>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => setEditingNote(null)} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#64748b", fontSize: 11, cursor: "pointer" }}>취소</button>
                          <button onClick={() => saveTradeNote(t.id)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#7c3aed", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>저장</button>
                        </div>
                      </div>
                    </div>
                  ) : hm ? (
                    <div onClick={(e) => { e.stopPropagation(); setEditingNote(t.id); setNoteText(t.note); }} style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(255,255,255,0.02)", borderLeft: `3px solid ${t.side === "BUY" ? "#ef4444" : "#3b82f6"}`, cursor: "pointer" }}>
                      <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{t.note}</div>
                    </div>
                  ) : (
                    <div onClick={(e) => { e.stopPropagation(); setEditingNote(t.id); setNoteText(""); }} style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(245,158,11,0.06)", border: "1px dashed rgba(245,158,11,0.2)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <IconWarn /><span style={{ fontSize: 12, color: "#fbbf24" }}>이유 미기록 — 탭하여 추가</span>
                    </div>
                  )}
                </div>
              );
            };

            return <>
              {/* 1. First Buy Reason - Pinned */}
              {firstBuy && (
                editingNote === firstBuy.id ? (
                  <div style={{ ...cs, marginBottom: 12, padding: "14px 18px", borderLeft: "3px solid #ef4444" }}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>최초 매수 이유 · {firstBuy.trade_date}</div>
                    <textarea value={noteText} onChange={(e: any) => setNoteText(e.target.value)} rows={2} style={{ ...is, resize: "vertical", fontSize: 13, lineHeight: 1.6, minHeight: 50, fontFamily: "inherit", marginBottom: 8 }} autoFocus />
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <button onClick={() => { if (confirm("이 거래 기록을 삭제하시겠습니까?")) delTrade(firstBuy.id); }} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>삭제</button>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setEditingNote(null)} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#64748b", fontSize: 11, cursor: "pointer" }}>취소</button>
                        <button onClick={() => saveTradeNote(firstBuy.id)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#7c3aed", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>저장</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{firstBuy.quantity}주 × {fmt(firstBuy.price)}원 = {fmt(firstBuy.quantity * firstBuy.price)}원</div>
                  </div>
                ) : (
                  <div onClick={() => { setEditingNote(firstBuy.id); setNoteText(firstBuy.note || ""); }} style={{ ...cs, marginBottom: 12, padding: "14px 18px", borderLeft: "3px solid #ef4444", cursor: "pointer" }}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>최초 매수 이유 · {firstBuy.trade_date}</div>
                    <div style={{ fontSize: 14, color: "#f8fafc", lineHeight: 1.6, fontWeight: 500 }}>{firstBuy.note}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{firstBuy.quantity}주 × {fmt(firstBuy.price)}원 = {fmt(firstBuy.quantity * firstBuy.price)}원</div>
                  </div>
                )
              )}

              {/* 2. Recent Actions (newest first, excluding firstBuy and 추가매수) */}
              {recentActions.length > 0 && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><IconMemo /> 최근 매매</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                    {recentActions.map(renderTrade)}
                  </div>
                </>
              )}

              {/* 3. 추가 매수 Summary (grouped) */}
              {addBuys.length > 0 && (
                <div style={{ ...cs, marginBottom: 12, padding: "12px 18px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>추가 매수 {addBuys.length}건</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {addBuys.map(t => editingNote === t.id ? (
                      <div key={t.id} style={{ padding: "8px 0" }}>
                        <textarea value={noteText} onChange={(e: any) => setNoteText(e.target.value)} rows={2} style={{ ...is, resize: "vertical", fontSize: 13, lineHeight: 1.6, minHeight: 40, fontFamily: "inherit", marginBottom: 6 }} autoFocus />
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <button onClick={() => { if (confirm("이 거래 기록을 삭제하시겠습니까?")) delTrade(t.id); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>삭제</button>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setEditingNote(null)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#64748b", fontSize: 11, cursor: "pointer" }}>취소</button>
                            <button onClick={() => saveTradeNote(t.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#7c3aed", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>저장</button>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{t.trade_date} · {t.quantity}주 × {fmt(t.price)}원 = {fmt(t.quantity * t.price)}원</div>
                      </div>
                    ) : (
                      <div key={t.id} onClick={() => { setEditingNote(t.id); setNoteText(t.note || "추가 매수"); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer" }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{t.trade_date}</span>
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>{t.quantity}주 × {fmt(t.price)}원</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{fmt(t.quantity * t.price)}원</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>;
          })()}
        </div>}

        {/* ============ TRADES ============ */}
        {view === "trades" && <div>
          {!trades.length && <div style={{ textAlign: "center", padding: "60px 0", color: "#475569", fontSize: 14 }}>거래내역이 없습니다</div>}
          {trades.length > 0 && <>
            {/* View Mode Toggle */}
            <div style={{ display: "flex", gap: 4, marginBottom: 12, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3 }}>
              {([["date","날짜별"],["stock","종목별"]] as const).map(([k,l]) => (
                <button key={k} onClick={() => setTradesViewMode(k)} style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: "none", fontSize: 12, fontWeight: tradesViewMode === k ? 700 : 500, background: tradesViewMode === k ? "rgba(255,255,255,0.08)" : "transparent", color: tradesViewMode === k ? "#f1f5f9" : "#64748b", cursor: "pointer" }}>{l}</button>
              ))}
            </div>

            {/* DATE VIEW */}
            {tradesViewMode === "date" && (() => {
              const sorted = [...trades].sort((a, b) => { const d = b.trade_date.localeCompare(a.trade_date); return d !== 0 ? d : b.id.localeCompare(a.id); });
              const months: Record<string, Trade[]> = {};
              sorted.forEach(t => { const m = t.trade_date.slice(0, 7); if (!months[m]) months[m] = []; months[m].push(t); });
              const monthKeys = Object.keys(months).sort((a, b) => b.localeCompare(a));
              return monthKeys.map(monthKey => {
                const monthTrades = months[monthKey];
                const [y, m] = monthKey.split("-");
                const label = `${y}년 ${parseInt(m)}월`;
                const isOpen = expandedMonths.has(monthKey);
                const toggleMonth = () => setExpandedMonths(prev => { const next = new Set(prev); if (next.has(monthKey)) next.delete(monthKey); else next.add(monthKey); return next; });
                const buyTotal = monthTrades.filter(t => t.side === "BUY").reduce((s, t) => s + t.quantity * t.price, 0);
                const sellTotal = monthTrades.filter(t => t.side === "SELL").reduce((s, t) => s + t.quantity * t.price, 0);
                return (
                  <div key={monthKey} style={{ marginBottom: 8 }}>
                    <button onClick={toggleMonth} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", cursor: "pointer", color: "#e2e8f0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>{monthTrades.length}건</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {buyTotal > 0 && <span style={{ fontSize: 11, color: "#ef4444" }}>매수 {fmt(buyTotal)}원</span>}
                        {sellTotal > 0 && <span style={{ fontSize: 11, color: "#3b82f6" }}>매도 {fmt(sellTotal)}원</span>}
                        <span style={{ fontSize: 12, color: "#64748b" }}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                        {monthTrades.map(t => {
                          const inst = instruments.find(i => i.id === t.instrument_id); const hm = !!t.note?.trim(); const isEd = editTrade?.id === t.id;
                          if (isEd) return (
                            <div key={t.id} style={{ ...cs, padding: 16, border: "1px solid rgba(124,58,237,0.25)" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                                <select value={editTrade.instrument_id} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, instrument_id: e.target.value }))} style={{ ...ei, width: "100%" }}>{instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                                <input type="date" value={editTrade.trade_date} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, trade_date: e.target.value }))} style={{ ...ei, width: "100%" }} />
                              </div>
                              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                                {(["BUY", "SELL"] as const).map(s => <button key={s} onClick={() => setEditTrade((p: any) => ({ ...p, side: s }))} style={{ flex: 1, padding: "6px 0", borderRadius: 6, border: "1px solid", cursor: "pointer", fontSize: 11, fontWeight: 700, background: editTrade.side === s ? (s === "BUY" ? "rgba(239,68,68,0.15)" : "rgba(59,130,246,0.15)") : "transparent", borderColor: editTrade.side === s ? (s === "BUY" ? "#ef4444" : "#3b82f6") : "rgba(255,255,255,0.08)", color: editTrade.side === s ? (s === "BUY" ? "#ef4444" : "#3b82f6") : "#64748b" }}>{s === "BUY" ? "매수" : "매도"}</button>)}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}><input type="number" value={editTrade.quantity} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, quantity: e.target.value }))} style={{ ...ei, flex: 1, textAlign: "right" }} /><span style={{ fontSize: 12, color: "#475569" }}>주</span></div>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}><input type="number" value={editTrade.price} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, price: e.target.value }))} style={{ ...ei, flex: 1, textAlign: "right" }} /><span style={{ fontSize: 12, color: "#475569" }}>원</span></div>
                              </div>
                              <textarea value={editTrade.note || ""} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, note: e.target.value }))} placeholder="매매 이유" rows={2} style={{ ...ei, width: "100%", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit", minHeight: 48, marginBottom: 12 }} />
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <button onClick={() => delTrade(t.id)} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>삭제</button>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button onClick={() => setEditTrade(null)} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#94a3b8", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>취소</button>
                                  <button onClick={saveEdit} style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#3b82f6,#7c3aed)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>저장</button>
                                </div>
                              </div>
                            </div>
                          );
                          return (
                            <div key={t.id} style={{ ...cs, padding: "12px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: t.side === "BUY" ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)", color: t.side === "BUY" ? "#ef4444" : "#3b82f6" }}>{t.side === "BUY" ? "매수" : "매도"}</span>
                                  <span style={{ fontSize: 13, fontWeight: 700 }}>{inst?.name}</span>
                                  <span style={{ fontSize: 11, color: "#64748b" }}>{t.trade_date}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  {!hm && <IconWarn />}
                                  <button onClick={() => setEditTrade({ ...t, quantity: String(t.quantity), price: String(t.price) })} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "#64748b", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>수정</button>
                                </div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 38 }}>
                                <span style={{ fontSize: 12, color: "#94a3b8" }}>{t.quantity}주 × {fmt(t.price)}원</span>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{fmt(t.quantity * t.price)}원</span>
                              </div>
                              {hm && <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(255,255,255,0.02)", borderLeft: `3px solid ${t.side === "BUY" ? "#ef4444" : "#3b82f6"}` }}><div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{t.note}</div></div>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              });
            })()}

            {/* STOCK VIEW */}
            {tradesViewMode === "stock" && (() => {
              const byInst: Record<string, { inst: Instrument; trades: Trade[] }> = {};
              trades.forEach(t => {
                const inst = instruments.find(i => i.id === t.instrument_id);
                if (!inst) return;
                if (!byInst[t.instrument_id]) byInst[t.instrument_id] = { inst, trades: [] };
                byInst[t.instrument_id].trades.push(t);
              });
              const groups = Object.values(byInst).sort((a, b) => b.trades.length - a.trades.length);
              return groups.map(({ inst, trades: instTr }) => {
                const isOpen = expandedStocks.has(inst.id);
                const toggleStock = () => setExpandedStocks(prev => { const next = new Set(prev); if (next.has(inst.id)) next.delete(inst.id); else next.add(inst.id); return next; });
                const sorted = [...instTr].sort((a, b) => b.trade_date.localeCompare(a.trade_date));
                const buyCount = sorted.filter(t => t.side === "BUY").length;
                const sellCount = sorted.filter(t => t.side === "SELL").length;
                const buyTotal = sorted.filter(t => t.side === "BUY").reduce((s, t) => s + t.quantity * t.price, 0);
                const sellTotal = sorted.filter(t => t.side === "SELL").reduce((s, t) => s + t.quantity * t.price, 0);
                return (
                  <div key={inst.id} style={{ marginBottom: 8 }}>
                    <button onClick={toggleStock} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", cursor: "pointer", color: "#e2e8f0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <img src={`https://file.alphasquare.co.kr/media/images/stock_logo/kr/${inst.symbol}.png`} alt={inst.name} onError={(e: any) => { e.target.style.display="none"; }} style={{ width: 24, height: 24, borderRadius: 6 }} />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{inst.name}</span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>{sorted.length}건</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: "#ef4444" }}>매수{buyCount}</span>
                        <span style={{ fontSize: 11, color: "#3b82f6" }}>매도{sellCount}</span>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, padding: "8px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 4, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <span>총 매수 {fmt(buyTotal)}원</span>
                          <span>총 매도 {fmt(sellTotal)}원</span>
                        </div>
                        {sorted.map(t => {
                          const hm = !!t.note?.trim();
                          return (
                            <div key={t.id} style={{ display: "flex", flexDirection: "column", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: t.side === "BUY" ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)", color: t.side === "BUY" ? "#ef4444" : "#3b82f6" }}>{t.side === "BUY" ? "매수" : "매도"}</span>
                                  <span style={{ fontSize: 11, color: "#64748b" }}>{t.trade_date}</span>
                                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{t.quantity}주 × {fmt(t.price)}원</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600 }}>{fmt(t.quantity * t.price)}원</span>
                                  <button onClick={() => setEditTrade({ ...t, quantity: String(t.quantity), price: String(t.price) })} style={{ background: "none", border: "none", color: "#475569", fontSize: 10, cursor: "pointer" }}>수정</button>
                                </div>
                              </div>
                              {hm && <div style={{ fontSize: 11, color: "#8b9dc3", marginTop: 2, paddingLeft: 24 }}>{t.note}</div>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </>}
        </div>}


        {/* ============ GLOBAL INDICATORS ============ */}
        {view === "global" && <div>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>국제 지표</div>
          {Object.keys(globalData).length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b" }}>로딩 중...</div>
          ) : (<>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { key: "usdkrw", icon: "💱", desc: "원/달러 환율" },
                { key: "dxy", icon: "💵", desc: "달러 강세 지표" },
                { key: "us10y", icon: "📊", desc: "미국 국채 수익률" },
                { key: "gold", icon: "🥇", desc: "안전자산" },
                { key: "brent", icon: "🛢️", desc: "국제 유가 선물" },
                { key: "wti", icon: "🛢️", desc: "국제 유가 선물" },
                { key: "vix", icon: "😱", desc: "시장 변동성" },
                { key: "sox", icon: "🔧", desc: "반도체 업종" },
              ].map(({ key, icon, desc }) => {
                const d = globalData[key];
                if (!d) return null;
                const isUp = d.change >= 0;
                const isVix = key === "vix";
                const vixLevel = isVix ? (d.price >= 30 ? "극도의 공포" : d.price >= 20 ? "불안" : "안정") : "";
                const isSel = globalSel === key;
                const isGold = key === "gold";
                return (
                  <div key={key} onClick={() => setGlobalSel(isSel ? null : key)} style={{ ...cs, padding: "14px 16px", cursor: "pointer", border: isSel ? "1px solid rgba(124,58,237,0.4)" : "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{icon} {d.name}</div>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: isUp ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.1)", color: isUp ? "#ef4444" : "#3b82f6" }}>{isUp ? "▲" : "▼"} {Math.abs(d.change)}%</span>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>
                      {isGold ? <>{fmt(d.price)}<span style={{ fontSize: 13, fontWeight: 500, color: "#94a3b8" }}>원/g</span></> : d.unit === "원" ? <>{fmt(Math.round(d.price))}<span style={{ fontSize: 13, fontWeight: 500, color: "#94a3b8" }}>원</span></> : d.unit === "%" ? <>{d.price.toFixed(2)}<span style={{ fontSize: 13, fontWeight: 500, color: "#94a3b8" }}>%</span></> : d.unit === "$" ? <>${fmt(Math.round(d.price * 100) / 100)}</> : <>{fmt(Math.round(d.price * 100) / 100)}</>}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{isVix ? vixLevel : desc}{isGold && d.priceUsd ? ` · $${fmt(Math.round(d.priceUsd))}/oz` : ""}</div>
                  </div>
                );
              })}
            </div>

            {/* Global Chart */}
            {globalSel && globalData[globalSel] && (
              <div style={{ ...cs, marginTop: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{globalData[globalSel].name} 차트 (6개월){globalSel === "gold" ? " · USD 기준" : ""}</div>
                <div ref={globalChartRef} />
              </div>
            )}
          </>)}
        </div>}

        {/* ============ ADD TRADE ============ */}
        {view === "add" && <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div style={{ ...cs, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 22 }}>거래 기록</div>
            <div style={{ marginBottom: 16 }}>
              <label style={ls}>종목</label>
              {instruments.length > 0 ? <select value={form.instrument_id} onChange={(e: any) => { const id = e.target.value; const active = hasActivePosition(trades, id); setForm(f => ({ ...f, instrument_id: id, note: f.side === "BUY" && active ? "추가 매수" : "" })); }} style={is}>{instruments.map(i => <option key={i.id} value={i.id}>{i.name} ({i.symbol})</option>)}</select>
              : <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>등록된 종목이 없습니다</div>}
              <button onClick={() => setShowNewInst(!showNewInst)} style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, border: "1px dashed rgba(255,255,255,0.1)", background: "transparent", color: "#8b5cf6", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>{showNewInst ? "취소" : "+ 새 종목 추가"}</button>
              {showNewInst && <div style={{ marginTop: 10, padding: 14, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <input placeholder="종목명 검색 (예: 삼성전자, LIG넥스원)" value={searchQuery} onChange={(e: any) => searchStock(e.target.value)} style={is} autoFocus />
                {searching && <div style={{ fontSize: 12, color: "#64748b", padding: "8px 0" }}>검색 중...</div>}
                {searchResults.length > 0 && <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
                  {searchResults.map((item: any, idx: number) => (
                    <div key={idx} onClick={() => selectStock(item)} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      onMouseEnter={(e: any) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={(e: any) => e.currentTarget.style.background = "transparent"}>
                      <div><span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{item.name}</span><span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>{item.symbol}</span></div>
                      <span style={{ fontSize: 11, color: "#8b5cf6", fontWeight: 600 }}>{item.market}</span>
                    </div>
                  ))}
                </div>}
                {searchQuery && !searching && searchResults.length === 0 && <div style={{ fontSize: 12, color: "#64748b", padding: "8px 0" }}>검색 결과 없음</div>}
              </div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div><label style={ls}>날짜</label><input type="date" value={form.trade_date} onChange={(e: any) => setForm(f => ({ ...f, trade_date: e.target.value }))} style={is} /></div>
              <div><label style={ls}>구분</label><div style={{ display: "flex", gap: 6 }}>
                {["BUY","SELL"].map(s => <button key={s} onClick={() => { const active = hasActivePosition(trades, form.instrument_id); setForm(f => ({ ...f, side: s, note: s === "BUY" && active ? "추가 매수" : s === "BUY" && !active ? "" : s === "SELL" ? "" : f.note })); }} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid", borderColor: form.side === s ? (s === "BUY" ? "#ef4444" : "#3b82f6") : "rgba(255,255,255,0.06)", background: form.side === s ? (s === "BUY" ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.1)") : "transparent", color: form.side === s ? (s === "BUY" ? "#ef4444" : "#3b82f6") : "#64748b", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{s === "BUY" ? "매수" : "매도"}</button>)}
              </div></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div><label style={ls}>수량</label><input type="number" placeholder="0" value={form.quantity} onChange={(e: any) => setForm(f => ({ ...f, quantity: e.target.value }))} style={is} /></div>
              <div><label style={ls}>단가</label><input type="number" placeholder="0" value={form.price} onChange={(e: any) => setForm(f => ({ ...f, price: e.target.value }))} style={is} /></div>
            </div>
            {form.quantity && form.price && <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: "rgba(255,255,255,0.03)", display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#64748b" }}>총 금액</span><span style={{ fontSize: 15, fontWeight: 800, color: form.side === "BUY" ? "#ef4444" : "#3b82f6" }}>{fmt(parseInt(form.quantity) * parseInt(form.price))}원</span></div>}
            <div style={{ marginBottom: 20, padding: 16, borderRadius: 10, background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.12)" }}>
              <label style={{ ...ls, display: "flex", alignItems: "center", gap: 6, color: "#c4b5fd", marginBottom: 10 }}><IconMemo />{form.side === "BUY" ? "왜 매수하나요?" : "왜 매도하나요?"}</label>
              <textarea value={form.note} onChange={(e: any) => setForm(f => ({ ...f, note: e.target.value }))} placeholder={form.side === "BUY" ? "예: 방산 수주 증가 + 중동 긴장 고조" : "예: 목표가 도달. 비중 축소"} rows={3} style={{ ...is, resize: "vertical", lineHeight: 1.6, minHeight: 80, fontFamily: "inherit", borderColor: "rgba(124,58,237,0.15)", background: "rgba(255,255,255,0.02)" }} />
              {!form.note.trim() && <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#fbbf24" }}><IconWarn /> 이유를 기록하면 나중에 판단을 복기할 수 있습니다</div>}
            </div>
            <button onClick={addTrade} disabled={!form.quantity || !form.price || !form.instrument_id} style={{ width: "100%", padding: "14px 0", borderRadius: 10, border: "none", fontSize: 15, fontWeight: 700, cursor: form.quantity && form.price && form.instrument_id ? "pointer" : "not-allowed", background: form.quantity && form.price && form.instrument_id ? "linear-gradient(135deg,#3b82f6,#7c3aed)" : "rgba(255,255,255,0.05)", color: form.quantity && form.price && form.instrument_id ? "#fff" : "#475569" }}>
              {form.note.trim() ? "기록하기" : "이유 없이 기록하기"}
            </button>
          </div>
        </div>}
      </main>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "20px 12px 32px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>주식노트</div>
        <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>손실을 줄이는 투자 습관</div>
        <a href="https://forms.gle/V9kKgRmRq6iE84ye7" target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 10, padding: "6px 16px", borderRadius: 6, border: "1px solid rgba(124,58,237,0.2)", background: "rgba(124,58,237,0.06)", color: "#a78bfa", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>피드백하기</a>
        <a href="https://open.kakao.com/o/g906MGki" target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 10, marginLeft: 8, padding: "6px 16px", borderRadius: 6, border: "1px solid rgba(251,191,36,0.2)", background: "rgba(251,191,36,0.06)", color: "#fbbf24", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>주식노트 채팅방</a>
      </footer>
    </div>
  );
}

const cs: React.CSSProperties = { background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 18, border: "1px solid rgba(255,255,255,0.05)" };
const nb: React.CSSProperties = { padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13 };
const ls: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6 };
const is: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" };
const ei: React.CSSProperties = { padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" };
