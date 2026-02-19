"use client";

import { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://gmvctjccieepzjjeofpc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtdmN0amNjaWVlcHpqamVvZnBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDU1NTEsImV4cCI6MjA4NjkyMTU1MX0.-iPj_DOhvUd9JIdbmaE-iEg0ZAusjSprQsv2K0vNw1w"
);

interface Instrument { id: string; symbol: string; name: string; market: string; }
interface Trade { id: string; instrument_id: string; trade_date: string; side: string; quantity: number; price: number; fee: number; note: string; }

function calculatePosition(trades: Trade[]) {
  let totalBuyQty = 0, totalBuyAmt = 0, totalSellQty = 0, realizedPnl = 0, firstBuyDate = "";
  const sorted = [...trades].sort((a, b) => new Date(a.trade_date).getTime() - new Date(b.trade_date).getTime());
  for (const t of sorted) {
    if (t.side === "BUY") {
      totalBuyQty += t.quantity; totalBuyAmt += t.quantity * t.price;
      if (!firstBuyDate) firstBuyDate = t.trade_date;
    } else {
      const avg = totalBuyQty > 0 ? totalBuyAmt / totalBuyQty : 0;
      realizedPnl += (t.price - avg) * t.quantity; totalSellQty += t.quantity;
    }
  }
  return { totalQty: totalBuyQty - totalSellQty, avgPrice: totalBuyQty > 0 ? Math.round(totalBuyAmt / totalBuyQty) : 0, realizedPnl: Math.round(realizedPnl), firstBuyDate };
}

function holdingDays(d: string) { return d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0; }
function getAlertLevel(r: number) { return r >= 0.05 ? "OUTPERFORM" : r >= -0.05 ? "NORMAL" : r >= -0.12 ? "WARNING" : "DANGER"; }
const alertCfg: Record<string, { label: string; color: string; bg: string; border: string }> = {
  OUTPERFORM: { label: "시장 대비 우수", color: "#0ea5e9", bg: "#0c2d48", border: "#0e4f7a" },
  NORMAL: { label: "시장과 유사", color: "#94a3b8", bg: "#1e293b", border: "#334155" },
  WARNING: { label: "시장 대비 약세", color: "#f59e0b", bg: "#422006", border: "#713f12" },
  DANGER: { label: "매도 검토 필요", color: "#ef4444", bg: "#450a0a", border: "#7f1d1d" },
};
function fmt(n: number) { return new Intl.NumberFormat("ko-KR").format(n); }
const BENCH_RET: Record<string, number> = { KOSPI: 0.054, KOSDAQ: 0.038 };

const IconMemo = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const IconWarn = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IconCheck = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IconBack = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;

export default function Home() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [priceLoading, setPriceLoading] = useState(false);
  const [view, setView] = useState("dashboard");
  const [selInst, setSelInst] = useState<string | null>(null);
  const [editTrade, setEditTrade] = useState<any>(null);
  const [form, setForm] = useState({ instrument_id: "", trade_date: new Date().toISOString().split("T")[0], side: "BUY", quantity: "", price: "", note: "" });
  const [showNewInst, setShowNewInst] = useState(false);
  const [newInst, setNewInst] = useState({ symbol: "", name: "", market: "KOSPI" });
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      if (instruments.length > 0) {
        const prices: Record<string, number> = {};
        Promise.all(instruments.map(async (inst) => {
          try {
            const res = await fetch(`/api/stock-price?symbol=${inst.symbol}`);
            const data = await res.json();
            if (data.price) prices[inst.id] = data.price;
          } catch (e) {}
        })).then(() => setCurrentPrices(prices));
      }
    }, 300000); // 5분
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    setLoading(true);
    const { data: i } = await supabase.from("instruments").select("*");
    const { data: t } = await supabase.from("trades").select("*");
    setInstruments(i || []); setTrades(t || []);
    if (i && i.length > 0) setForm(f => ({ ...f, instrument_id: f.instrument_id || i[0].id }));
    
// 현재가 조회 (병렬)
    if (i && i.length > 0) {
      const prices: Record<string, number> = {};
      await Promise.all(i.map(async (inst) => {
        try {
          const res = await fetch(`/api/stock-price?symbol=${inst.symbol}`);
          const data = await res.json();
          if (data.price) prices[inst.id] = data.price;
        } catch (e) {}
      }));
      setCurrentPrices(prices);
    }
    setLoading(false);
  }

  async function refreshPrices() {
    if (instruments.length === 0) return;
    setPriceLoading(true);
    const prices: Record<string, number> = {};
    for (const inst of instruments) {
      try {
        const res = await fetch(`/api/stock-price?symbol=${inst.symbol}`);
        const data = await res.json();
        if (data.price) prices[inst.id] = data.price;
      } catch (e) {}
    }
    setCurrentPrices(prices);
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
      setShowNewInst(false);
      setSearchQuery("");
      setSearchResults([]);
      return;
    }
    const { data } = await supabase.from("instruments").insert({
      symbol: item.symbol, name: item.name, market: item.market,
    }).select().single();
    if (data) {
      setInstruments(p => [...p, data]);
      setForm(f => ({ ...f, instrument_id: data.id }));
      setShowNewInst(false);
      setSearchQuery("");
      setSearchResults([]);
    }
  }

  async function addInstrument() {
    if (!newInst.name || !newInst.symbol) return;
    const { data } = await supabase.from("instruments").insert({ symbol: newInst.symbol, name: newInst.name, market: newInst.market }).select().single();
    if (data) { setInstruments(p => [...p, data]); setForm(f => ({ ...f, instrument_id: data.id })); setNewInst({ symbol: "", name: "", market: "KOSPI" }); setShowNewInst(false); }
  }

  async function addTrade() {
    if (!form.quantity || !form.price || !form.instrument_id) return;
    const { data } = await supabase.from("trades").insert({ instrument_id: form.instrument_id, trade_date: form.trade_date, side: form.side, quantity: parseInt(form.quantity), price: parseInt(form.price), note: form.note.trim() }).select().single();
    if (data) { setTrades(p => [...p, data]); setForm(f => ({ ...f, quantity: "", price: "", note: "" })); setView("dashboard"); }
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
    const pos = calculatePosition(it); if (pos.totalQty <= 0) return null;
    const cp = currentPrices[inst.id] || 0;
    const stockRet = cp > 0 && pos.avgPrice > 0 ? (cp / pos.avgPrice) - 1 : 0;
    const br = BENCH_RET[inst.market] || 0; const rr = stockRet - br;
    const noMemo = it.filter(t => !t.note?.trim()).length;
    const fm = [...it].sort((a, b) => new Date(a.trade_date).getTime() - new Date(b.trade_date).getTime()).find(t => t.side === "BUY" && t.note?.trim());
    return { ...inst, ...pos, currentPrice: cp, stockReturn: stockRet, benchReturn: br, relativeReturn: rr, alertLevel: getAlertLevel(rr), evalAmount: cp * pos.totalQty, unrealizedPnl: (cp - pos.avgPrice) * pos.totalQty, tradeCount: it.length, noMemoCount: noMemo, firstMemo: fm?.note || "" };
  }).filter(Boolean) as any[], [instruments, trades, currentPrices]);

  const totals = useMemo(() => {
    const totalInvested = positions.reduce((s: number, p: any) => s + p.avgPrice * p.totalQty, 0);
    const totalEval = positions.reduce((s: number, p: any) => s + (p.currentPrice > 0 ? p.currentPrice * p.totalQty : p.avgPrice * p.totalQty), 0);
    const totalUnrealized = positions.reduce((s: number, p: any) => s + (p.currentPrice > 0 ? (p.currentPrice - p.avgPrice) * p.totalQty : 0), 0);
    const totalRealized = positions.reduce((s: number, p: any) => s + p.realizedPnl, 0);
    const totalTrades = trades.length;
    const noMemo = trades.filter(t => !t.note?.trim()).length;
    return { totalInvested, totalEval, totalUnrealized, totalRealized, totalTrades, noMemo };
  }, [positions, trades]);
  const instTrades = useMemo(() => selInst ? trades.filter(t => t.instrument_id === selInst).sort((a, b) => new Date(b.trade_date).getTime() - new Date(a.trade_date).getTime()) : [], [trades, selInst]);
  const selPos = positions.find((p: any) => p.id === selInst);
  const selInstData = instruments.find(i => i.id === selInst);

  if (loading) return <div style={{ minHeight: "100vh", background: "#080c14", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>로딩 중...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#080c14", color: "#e2e8f0", fontFamily: "'Pretendard','Apple SD Gothic Neo',-apple-system,sans-serif" }}>
      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(8,12,20,0.95)", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff" }}>N</div>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#f8fafc" }}>투자노트</span>
        </div>
        {view === "detail" ? (
          <button onClick={() => { setView("dashboard"); setSelInst(null); }} style={{ ...nb, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}><IconBack /> 돌아가기</button>
        ) : (
          <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 3 }}>
            {[{ k: "dashboard", l: "보유현황" }, { k: "trades", l: "거래내역" }, { k: "add", l: "＋ 기록" }].map(t => (
              <button key={t.k} onClick={() => setView(t.k)} style={{ ...nb, background: view === t.k ? "rgba(255,255,255,0.08)" : "transparent", color: view === t.k ? "#f1f5f9" : "#64748b", fontWeight: view === t.k ? 700 : 500 }}>{t.l}</button>
            ))}
          </div>
        )}
      </header>

      <main style={{ maxWidth: 880, margin: "0 auto", padding: "24px 16px 60px" }}>

        {view === "dashboard" && <div>
          {totals.noMemo > 0 ? <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", display: "flex", alignItems: "center", gap: 10 }}><IconWarn /><span style={{ fontSize: 13, color: "#fbbf24" }}>이유 미기록 거래 <b>{totals.noMemo}건</b></span></div>
          : trades.length > 0 ? <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.12)", display: "flex", alignItems: "center", gap: 10 }}><IconCheck /><span style={{ fontSize: 13, color: "#4ade80" }}>모든 거래에 이유가 기록됨</span></div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 10 }}>
              <div style={cs}><div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>총 투자금</div><div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(totals.totalInvested)}원</div></div>
              <div style={cs}><div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>평가금액</div><div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(totals.totalEval)}원</div></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 24 }}>
            <div style={cs}><div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>평가손익</div><div style={{ fontSize: 18, fontWeight: 800, color: totals.totalUnrealized >= 0 ? "#ef4444" : "#3b82f6" }}>{totals.totalUnrealized >= 0 ? "+" : ""}{fmt(totals.totalUnrealized)}원</div></div>
              <div style={cs}><div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>실현손익</div><div style={{ fontSize: 18, fontWeight: 800, color: totals.totalRealized >= 0 ? "#ef4444" : "#3b82f6" }}>{totals.totalRealized >= 0 ? "+" : ""}{fmt(totals.totalRealized)}원</div></div>
              <div style={cs}><div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>기록률</div><div style={{ fontSize: 18, fontWeight: 800, color: "#a78bfa" }}>{totals.totalTrades > 0 ? Math.round(((totals.totalTrades - totals.noMemo) / totals.totalTrades) * 100) : 0}%</div></div>
            </div>

          {!positions.length && <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}><div style={{ fontSize: 14, marginBottom: 8 }}>아직 기록된 거래가 없습니다</div><button onClick={() => setView("add")} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#3b82f6,#7c3aed)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>첫 거래 기록하기</button></div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {positions.map((p: any) => { const a = alertCfg[p.alertLevel]; return (
              <div key={p.id} onClick={() => { setSelInst(p.id); setView("detail"); }} style={{ ...cs, padding: "16px 18px", cursor: "pointer", position: "relative" }}>
                {p.noMemoCount > 0 && <div style={{ position: "absolute", top: 12, right: 14 }}><div style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b" }} /></div>}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span><span style={{ fontSize: 11, color: "#475569" }}>{p.totalQty}주 · {holdingDays(p.firstBuyDate)}일</span></div>
                  <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, color: a.color, background: a.bg, border: `1px solid ${a.border}` }}>{a.label}</div>
                </div>
                <div style={{ display: "flex", gap: 20, alignItems: "baseline" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: "#94a3b8" }}>{fmt(p.avgPrice * p.totalQty)}원</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>→</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: p.currentPrice > 0 ? (p.unrealizedPnl >= 0 ? "#ef4444" : "#3b82f6") : "#e2e8f0" }}>{p.currentPrice > 0 ? fmt(p.currentPrice * p.totalQty) + "원" : "현재가 없음"}</span>
                    {p.currentPrice > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: p.unrealizedPnl >= 0 ? "#ef4444" : "#3b82f6" }}>{(p.unrealizedPnl >= 0 ? "+" : "")}{fmt(p.unrealizedPnl)}원 ({(p.stockReturn >= 0 ? "+" : "") + (p.stockReturn * 100).toFixed(2)}%)</span>}
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, color: "#475569" }}><IconMemo /><span style={{ fontSize: 11 }}>{p.tradeCount}건</span></div>
                </div>
                {p.firstMemo && <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "rgba(255,255,255,0.02)", borderLeft: "2px solid rgba(124,58,237,0.3)" }}><span style={{ fontSize: 12, color: "#8b9dc3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{p.firstMemo}</span></div>}
              </div>
            ); })}
          </div>
        </div>}

        {view === "detail" && selInstData && <div>
          <div style={{ ...cs, marginBottom: 20, padding: "20px 22px" }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{selInstData.name}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{selInstData.symbol} · {selInstData.market}</div>
            {selPos && <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 14 }}>
              <div><div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>평균단가</div><div style={{ fontSize: 16, fontWeight: 800 }}>{fmt(selPos.avgPrice)}원</div></div>
              <div><div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>보유수량</div><div style={{ fontSize: 16, fontWeight: 800 }}>{selPos.totalQty}주</div></div>
              <div><div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>보유일수</div><div style={{ fontSize: 16, fontWeight: 800 }}>{holdingDays(selPos.firstBuyDate)}일</div></div>
            </div>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}><IconMemo /> 매매 기록 타임라인</div>
          <div style={{ position: "relative", paddingLeft: 20 }}>
            <div style={{ position: "absolute", left: 7, top: 8, bottom: 8, width: 2, background: "rgba(255,255,255,0.06)" }} />
            {instTrades.map((t, i) => { const hm = !!t.note?.trim(); return (
              <div key={t.id} style={{ position: "relative", marginBottom: i < instTrades.length - 1 ? 14 : 0, paddingLeft: 16 }}>
                <div style={{ position: "absolute", left: -16, top: 6, width: 12, height: 12, borderRadius: "50%", background: t.side === "BUY" ? "#1d4ed8" : "#b91c1c", border: "2px solid #080c14" }} />
                <div style={{ ...cs, padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: hm ? 10 : 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: t.side === "BUY" ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)", color: t.side === "BUY" ? "#60a5fa" : "#fca5a5" }}>{t.side === "BUY" ? "매수" : "매도"}</span>
                    <span style={{ fontSize: 12, color: "#64748b" }}>{t.trade_date}</span>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{t.quantity}주 × {fmt(t.price)}원</span>
                  </div>
                  {hm ? <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", borderLeft: `3px solid ${t.side === "BUY" ? "#3b82f6" : "#ef4444"}` }}><div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{t.note}</div></div>
                  : <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(245,158,11,0.06)", border: "1px dashed rgba(245,158,11,0.2)", display: "flex", alignItems: "center", gap: 6 }}><IconWarn /><span style={{ fontSize: 12, color: "#fbbf24" }}>이유 미기록</span></div>}
                </div>
              </div>
            ); })}
          </div>
        </div>}

        {view === "trades" && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {!trades.length && <div style={{ textAlign: "center", padding: "60px 0", color: "#475569", fontSize: 14 }}>거래내역이 없습니다</div>}
          {[...trades].sort((a, b) => new Date(b.trade_date).getTime() - new Date(a.trade_date).getTime()).map(t => {
            const inst = instruments.find(i => i.id === t.instrument_id); const hm = !!t.note?.trim(); const isEd = editTrade?.id === t.id;
            if (isEd) return (
              <div key={t.id} style={{ ...cs, padding: 18, border: "1px solid rgba(124,58,237,0.25)" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <select value={editTrade.instrument_id} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, instrument_id: e.target.value }))} style={{ ...ei, flex: "0 0 120px" }}>{instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                  <input type="date" value={editTrade.trade_date} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, trade_date: e.target.value }))} style={{ ...ei, flex: "0 0 130px" }} />
                  {(["BUY", "SELL"] as const).map(s => <button key={s} onClick={() => setEditTrade((p: any) => ({ ...p, side: s }))} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid", cursor: "pointer", fontSize: 11, fontWeight: 700, background: editTrade.side === s ? (s === "BUY" ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)") : "transparent", borderColor: editTrade.side === s ? (s === "BUY" ? "#3b82f6" : "#ef4444") : "rgba(255,255,255,0.08)", color: editTrade.side === s ? (s === "BUY" ? "#60a5fa" : "#fca5a5") : "#64748b" }}>{s === "BUY" ? "매수" : "매도"}</button>)}
                  <input type="number" value={editTrade.quantity} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, quantity: e.target.value }))} style={{ ...ei, flex: "0 0 70px", textAlign: "right" }} /><span style={{ fontSize: 12, color: "#475569" }}>주</span>
                  <input type="number" value={editTrade.price} onChange={(e: any) => setEditTrade((p: any) => ({ ...p, price: e.target.value }))} style={{ ...ei, flex: "0 0 110px", textAlign: "right" }} /><span style={{ fontSize: 12, color: "#475569" }}>원</span>
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
              <div key={t.id} style={{ ...cs, padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: hm ? 8 : 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: t.side === "BUY" ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)", color: t.side === "BUY" ? "#60a5fa" : "#fca5a5" }}>{t.side === "BUY" ? "매수" : "매도"}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{inst?.name}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{t.trade_date}</span>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{t.quantity}주 × {fmt(t.price)}원</span>
                  <span style={{ fontSize: 13, fontWeight: 600, marginLeft: "auto" }}>{fmt(t.quantity * t.price)}원</span>
                  {!hm && <IconWarn />}
                  <button onClick={() => setEditTrade({ ...t, quantity: String(t.quantity), price: String(t.price) })} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "#64748b", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>수정</button>
                </div>
                {hm && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(255,255,255,0.02)", borderLeft: `3px solid ${t.side === "BUY" ? "#3b82f6" : "#ef4444"}` }}><div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{t.note}</div></div>}
              </div>
            );
          })}
        </div>}

        {view === "add" && <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div style={{ ...cs, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 22 }}>거래 기록</div>
            <div style={{ marginBottom: 16 }}>
              <label style={ls}>종목</label>
              {instruments.length > 0 ? <select value={form.instrument_id} onChange={(e: any) => setForm(f => ({ ...f, instrument_id: e.target.value }))} style={is}>{instruments.map(i => <option key={i.id} value={i.id}>{i.name} ({i.symbol})</option>)}</select>
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
                {(["BUY", "SELL"] as const).map(s => <button key={s} onClick={() => setForm(f => ({ ...f, side: s }))} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "2px solid", cursor: "pointer", fontSize: 13, fontWeight: 700, background: form.side === s ? (s === "BUY" ? "rgba(59,130,246,0.12)" : "rgba(239,68,68,0.12)") : "rgba(255,255,255,0.02)", borderColor: form.side === s ? (s === "BUY" ? "#3b82f6" : "#ef4444") : "rgba(255,255,255,0.08)", color: form.side === s ? (s === "BUY" ? "#60a5fa" : "#fca5a5") : "#64748b" }}>{s === "BUY" ? "매수" : "매도"}</button>)}
              </div></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div><label style={ls}>수량</label><input type="number" placeholder="0" value={form.quantity} onChange={(e: any) => setForm(f => ({ ...f, quantity: e.target.value }))} style={is} /></div>
              <div><label style={ls}>단가</label><input type="number" placeholder="0" value={form.price} onChange={(e: any) => setForm(f => ({ ...f, price: e.target.value }))} style={is} /></div>
            </div>
            {form.quantity && form.price && <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: "rgba(255,255,255,0.03)", display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#64748b" }}>총 금액</span><span style={{ fontSize: 15, fontWeight: 800, color: form.side === "BUY" ? "#60a5fa" : "#fca5a5" }}>{fmt(parseInt(form.quantity) * parseInt(form.price))}원</span></div>}
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
    </div>
  );
}

const cs: React.CSSProperties = { background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 18, border: "1px solid rgba(255,255,255,0.05)" };
const nb: React.CSSProperties = { padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13 };
const ls: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6 };
const is: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" };
const ei: React.CSSProperties = { padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" };