// app/api/us-stock-price/route.ts
//
// 미국 주식 실시간 시세
// Primary: Yahoo Finance v8 chart endpoint (Origin/Referer 헤더 추가)
// Fallback: Stooq (무료, API 키 불필요, 클라우드 차단 거의 없음)
// 사용법: /api/us-stock-price?symbol=DRAM
// 응답: { price, changeRate, change, currency, source }

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "missing symbol" }, { status: 400 });

  const debug: Record<string, string> = {};

  // ─── 1. Yahoo Finance v8 chart ───
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "https://finance.yahoo.com",
          Referer: "https://finance.yahoo.com/",
        },
        cache: "no-store",
      }
    );
    debug.yahoo = `status=${res.status}`;
    if (res.ok) {
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice !== undefined) {
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
        return NextResponse.json({
          price,
          changeRate: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
          change: price - prevClose,
          currency: meta.currency || "USD",
          source: "yahoo",
        });
      }
      debug.yahoo = `status=${res.status},no_meta`;
    }
  } catch (e: any) {
    debug.yahoo = `error=${(e?.message || "unknown").slice(0, 80)}`;
  }

  // ─── 2. Stooq fallback ───
  try {
    const stooqSym = symbol.toLowerCase() + ".us";
    const res = await fetch(
      `https://stooq.com/q/l/?s=${stooqSym}&f=sd2t2ohlcv&h&e=csv`,
      { cache: "no-store" }
    );
    debug.stooq = `status=${res.status}`;
    if (res.ok) {
      const csv = await res.text();
      const lines = csv.trim().split("\n");
      if (lines.length >= 2) {
        const headers = lines[0].split(",").map((h) => h.trim());
        const values = lines[1].split(",").map((v) => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
          row[h] = values[i];
        });
        const close = parseFloat(row["Close"] || "0");
        const open = parseFloat(row["Open"] || "0");
        if (close > 0 && !isNaN(close)) {
          return NextResponse.json({
            price: close,
            // Stooq simple quote 는 prev close 미제공 → 시가 대비 변화율로 근사
            changeRate: open > 0 ? ((close - open) / open) * 100 : 0,
            change: open > 0 ? close - open : 0,
            currency: "USD",
            source: "stooq",
          });
        }
        debug.stooq = `status=${res.status},close=${row["Close"]}`;
      }
    }
  } catch (e: any) {
    debug.stooq = `error=${(e?.message || "unknown").slice(0, 80)}`;
  }

  return NextResponse.json({ error: "no data from any source", debug });
}
