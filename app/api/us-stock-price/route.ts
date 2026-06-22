// app/api/us-stock-price/route.ts
//
// 미국 주식 실시간 시세 (Yahoo Finance v8 chart endpoint)
// 사용법: /api/us-stock-price?symbol=DRAM
// 응답: { price: 76.71, changeRate: 9.66, change: 6.76, currency: "USD" }
//
// v7 /finance/quote 는 클라우드에서 자주 막혀서 v8 /finance/chart 사용

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return NextResponse.json({}, { status: 400 });

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) return NextResponse.json({});

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta || meta.regularMarketPrice === undefined) {
      return NextResponse.json({});
    }

    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change = price - prevClose;
    const changeRate = prevClose ? (change / prevClose) * 100 : 0;

    return NextResponse.json({
      price,
      changeRate,
      change,
      symbol: meta.symbol,
      currency: meta.currency || "USD",
      exchange: meta.exchangeName,
    });
  } catch (e) {
    console.error("US stock price fetch error:", e);
    return NextResponse.json({});
  }
}
