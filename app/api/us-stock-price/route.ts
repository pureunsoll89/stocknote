// app/api/us-stock-price/route.ts
//
// 미국 주식 실시간 시세 (4단계 fallback)
// 1. 네이버 증권 (한국에서 빠르고 차단 없음, 비공식 API)
// 2. Finnhub (FINNHUB_API_KEY 환경변수 있을 때)
// 3. Yahoo Finance v8 chart (rate limit 자주 걸림)
// 4. Stooq (구 종목만 등록됨, 신규 ETF X)
//
// 사용법: /api/us-stock-price?symbol=DRAM

import { NextResponse } from "next/server";

function pickNumber(...values: any[]): number | undefined {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return undefined;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "missing symbol" }, { status: 400 });

  const debug: Record<string, any> = {};

  // ─── 1. 네이버 증권 (거래소 코드 여러 개 시도) ───
  // O=NASDAQ, N=NYSE, K=Cboe/BATS, A=AMEX
  for (const suffix of ["O", "N", "K", "A"]) {
    try {
      const url = `https://api.stock.naver.com/stock/${encodeURIComponent(symbol)}.${suffix}/integration`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; stocknote/1.0)" },
        cache: "no-store",
      });
      debug[`naver_${suffix}`] = `status=${res.status}`;
      if (res.ok) {
        const data = await res.json();
        // 응답 형태가 여러 가지일 수 있어서 defensive 하게 파싱
        const price = pickNumber(
          data?.dealTrendInfos?.[0]?.closePrice,
          data?.closePrice,
          data?.result?.closePrice,
          data?.realTimeInfo?.closePrice,
          data?.stockInfo?.closePrice,
          data?.tradeStop?.closePrice
        );
        const changeRate = pickNumber(
          data?.dealTrendInfos?.[0]?.fluctuationsRatio,
          data?.fluctuationsRatio,
          data?.result?.fluctuationsRatio,
          data?.realTimeInfo?.fluctuationsRatio
        );
        const change = pickNumber(
          data?.dealTrendInfos?.[0]?.compareToPreviousClosePrice,
          data?.compareToPreviousClosePrice,
          data?.result?.compareToPreviousClosePrice
        );

        if (price && price > 0) {
          return NextResponse.json({
            price,
            changeRate: changeRate ?? 0,
            change: change ?? 0,
            currency: "USD",
            source: `naver_${suffix}`,
          });
        }
        // 200 응답인데 가격 못 찾으면 응답 샘플 디버그에 포함 (한 번만)
        if (!debug.naver_sample) {
          debug.naver_sample = JSON.stringify(data).slice(0, 400);
        }
        debug[`naver_${suffix}`] = `status=${res.status},no_price`;
      }
    } catch (e: any) {
      debug[`naver_${suffix}`] = `error=${(e?.message || "?").slice(0, 60)}`;
    }
  }

  // ─── 2. Finnhub (env var 있을 때) ───
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (finnhubKey) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`,
        { cache: "no-store" }
      );
      debug.finnhub = `status=${res.status}`;
      if (res.ok) {
        const data = await res.json();
        if (data.c && data.c > 0) {
          return NextResponse.json({
            price: data.c,
            changeRate: data.dp || 0,
            change: data.d || 0,
            currency: "USD",
            source: "finnhub",
          });
        }
        debug.finnhub = `status=${res.status},c=${data.c}`;
      }
    } catch (e: any) {
      debug.finnhub = `error=${(e?.message || "?").slice(0, 60)}`;
    }
  } else {
    debug.finnhub = "no_key";
  }

  // ─── 3. Yahoo Finance v8 chart ───
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
    }
  } catch (e: any) {
    debug.yahoo = `error=${(e?.message || "?").slice(0, 60)}`;
  }

  // ─── 4. Stooq ───
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
        headers.forEach((h, i) => { row[h] = values[i]; });
        const close = parseFloat(row["Close"] || "0");
        const open = parseFloat(row["Open"] || "0");
        if (close > 0 && !isNaN(close)) {
          return NextResponse.json({
            price: close,
            changeRate: open > 0 ? ((close - open) / open) * 100 : 0,
            change: open > 0 ? close - open : 0,
            currency: "USD",
            source: "stooq",
          });
        }
      }
    }
  } catch (e: any) {
    debug.stooq = `error=${(e?.message || "?").slice(0, 60)}`;
  }

  return NextResponse.json({ error: "no data from any source", debug });
}
