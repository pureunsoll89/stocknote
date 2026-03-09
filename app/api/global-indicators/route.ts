import { NextResponse } from "next/server";

async function fetchYahoo(symbol: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const current = meta.regularMarketPrice || 0;
    const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
    const change = prevClose > 0 ? ((current - prevClose) / prevClose) * 100 : 0;

    return { price: current, change: Math.round(change * 100) / 100, prevClose };
  } catch (e) {
    return null;
  }
}

export async function GET() {
  const items = [
    { key: "usdkrw", symbol: "KRW=X", name: "USD/KRW 환율", unit: "원" },
    { key: "us10y", symbol: "^TNX", name: "미국 10년물 금리", unit: "%" },
    { key: "brent", symbol: "BZ=F", name: "브렌트유", unit: "$" },
    { key: "vix", symbol: "^VIX", name: "VIX 공포지수", unit: "" },
    { key: "sox", symbol: "^SOX", name: "필라델피아 반도체", unit: "" },
    { key: "gold", symbol: "GC=F", name: "금", unit: "원" },
  ];

  const results: Record<string, any> = {};

  await Promise.all(items.map(async ({ key, symbol, name, unit }) => {
    const data = await fetchYahoo(symbol);
    if (data && data.price > 0) {
      results[key] = { name, unit, yahooSymbol: symbol, price: data.price, change: data.change };
    }
  }));

  // Gold: convert $/oz to 원/g
  if (results["gold"]?.price && results["usdkrw"]?.price) {
    const usdPerOz = results["gold"].price;
    const krwRate = results["usdkrw"].price;
    results["gold"].priceUsd = usdPerOz;
    results["gold"].price = Math.round((usdPerOz / 31.1035) * krwRate);
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "s-maxage=180, stale-while-revalidate=360" },
  });
}
