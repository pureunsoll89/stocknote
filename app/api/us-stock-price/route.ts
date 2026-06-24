// app/api/us-stock-price/route.ts
//
// 미국 주식 실시간 시세 (Pre-market / Post-market 포함)
// 1순위: Yahoo v8 chart (includePrePost=true) - 시간외 거래 다 포함
// 2순위: Naver basic - 정규장만, Yahoo rate limit 시 fallback
//
// 30초 캐시: Yahoo rate limit 완화 + 사용자에겐 거의 실시간

import { NextResponse } from "next/server";

export const revalidate = 30;

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
        session: "regular",
        source: key,
      };
    }
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
  const isDebug = searchParams.get("debug") === "1";
  if (!symbol) return NextResponse.json({ error: "missing symbol" }, { status: 400 });

  const debug: Record<string, any> = {};

  // ─── 1. Yahoo Finance v8 chart (pre/post market 포함) ───
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=true`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
      }
    );
    debug.yahoo = `status=${res.status}`;
    if (res.ok) {
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice !== undefined) {
        // 가장 최근 거래된 가격 선택 (pre/regular/post 중 timestamp 가장 큰 것)
        let price = meta.regularMarketPrice;
        let priceTime = meta.regularMarketTime || 0;
        let session = "regular";

        if (meta.preMarketPrice && (meta.preMarketTime || 0) > priceTime) {
          price = meta.preMarketPrice;
          priceTime = meta.preMarketTime;
          session = "pre";
        }
        if (meta.postMarketPrice && (meta.postMarketTime || 0) > priceTime) {
          price = meta.postMarketPrice;
          priceTime = meta.postMarketTime;
          session = "post";
        }

        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;

        if (isDebug) {
          return NextResponse.json({ meta, picked: { price, session, priceTime } });
        }

        return NextResponse.json({
          price,
          changeRate: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
          change: price - prevClose,
          currency: meta.currency || "USD",
          session,
          source: `yahoo_${session}`,
        });
      }
      debug.yahoo = `${res.status},no_meta`;
    }
  } catch (e: any) {
    debug.yahoo = `error=${(e?.message || "?").slice(0, 50)}`;
  }

  // ─── 2. Naver Finance fallback (정규장만, Yahoo 막혔을 때) ───
  const paths = ["basic", "totalInfo", "snapshot", "integration"];
  const suffixes = ["K", "O", "N", "A"];
  for (const path of paths) {
    for (const suffix of suffixes) {
      const result = await tryNaver(symbol, suffix, path, debug);
      if (result) return NextResponse.json(result);
    }
  }

  return NextResponse.json({ error: "no data", debug });
}
