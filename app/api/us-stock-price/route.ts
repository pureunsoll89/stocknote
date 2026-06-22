// app/api/us-stock-price/route.ts
//
// 미국 주식 실시간 시세 (Yahoo Finance 사용, 무료)
// 사용법: /api/us-stock-price?symbol=AAPL
// 응답: { price: 190.5, changeRate: 1.23, change: 2.3, name: "Apple Inc." }

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return NextResponse.json({}, { status: 400 });

  try {
    // Yahoo Finance unofficial endpoint
    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return NextResponse.json({});
    }

    const data = await res.json();
    const quote = data?.quoteResponse?.result?.[0];

    if (!quote) return NextResponse.json({});

    return NextResponse.json({
      price: quote.regularMarketPrice,
      changeRate: quote.regularMarketChangePercent,
      change: quote.regularMarketChange,
      name: quote.shortName || quote.longName,
      currency: quote.currency || "USD",
    });
  } catch (e) {
    console.error("US stock price fetch error:", e);
    return NextResponse.json({});
  }
}
