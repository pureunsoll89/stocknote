// app/api/us-stock-price/route.ts
//
// 미국 주식 실시간 시세
// 네이버 증권을 거래소 코드 + 다양한 path 조합으로 시도
// DRAM 같은 Cboe 상장 ETF 는 .K, NASDAQ 은 .O, NYSE 는 .N

import { NextResponse } from "next/server";

function pickNumber(...values: any[]): number | undefined {
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return undefined;
}

async function tryNaver(symbol: string, suffix: string, path: string, debug: Record<string, any>) {
  const key = `naver_${suffix}_${path}`;
  try {
    const url = `https://api.stock.naver.com/stock/${encodeURIComponent(symbol)}.${suffix}/${path}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; stocknote/1.0)" },
      cache: "no-store",
    });
    debug[key] = `status=${res.status}`;
    if (!res.ok) return null;
    const data = await res.json();
    const price = pickNumber(
      data?.closePrice,
      data?.now,
      data?.currentPrice,
      data?.tradedPrice,
      data?.realTimeInfo?.closePrice,
      data?.realTimeInfo?.currentPrice,
      data?.dealTrendInfos?.[0]?.closePrice,
      data?.tradeStop?.closePrice,
      data?.basicInfo?.closePrice
    );
    const changeRate = pickNumber(
      data?.fluctuationsRatio,
      data?.changeRate,
      data?.realTimeInfo?.fluctuationsRatio,
      data?.dealTrendInfos?.[0]?.fluctuationsRatio
    );
    const change = pickNumber(
      data?.compareToPreviousClosePrice,
      data?.change,
      data?.realTimeInfo?.compareToPreviousClosePrice,
      data?.dealTrendInfos?.[0]?.compareToPreviousClosePrice
    );

    if (price && price > 0) {
      return {
        price,
        changeRate: changeRate ?? 0,
        change: change ?? 0,
        currency: "USD",
        source: key,
      };
    }
    // 200 인데 가격 없으면 응답 sample 보관 (디버그용)
    if (!debug.naver_sample && Object.keys(data || {}).length > 0) {
      debug.naver_sample_from = key;
      debug.naver_sample = JSON.stringify(data).slice(0, 800);
    }
    debug[key] = `status=${res.status},no_price`;
    return null;
  } catch (e: any) {
    debug[key] = `error=${(e?.message || "?").slice(0, 50)}`;
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "missing symbol" }, { status: 400 });

  const debug: Record<string, any> = {};

  // ─── 1. 네이버 증권 ───
  // path 종류: basic, integration, totalInfo, snapshot
  // 거래소 코드: K(Cboe/BATS), O(NASDAQ), N(NYSE), A(AMEX)
  const paths = ["basic", "totalInfo", "snapshot", "integration"];
  const suffixes = ["K", "O", "N", "A"];

  for (const path of paths) {
    for (const suffix of suffixes) {
      const result = await tryNaver(symbol, suffix, path, debug);
      if (result) return NextResponse.json(result);
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
      }
    } catch (e: any) {
      debug.finnhub = `error=${(e?.message || "?").slice(0, 50)}`;
    }
  } else {
    debug.finnhub = "no_key";
  }

  // ─── 3. Yahoo Finance ───
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
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
    debug.yahoo = `error=${(e?.message || "?").slice(0, 50)}`;
  }

  return NextResponse.json({ error: "no data", debug });
}
