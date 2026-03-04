import { NextResponse } from "next/server";

async function fetchYahoo(symbol: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    const quotes = data.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!meta || !quotes) return null;

    const closes = quotes.close?.filter((v: any) => v != null) || [];
    const current = meta.regularMarketPrice || closes[closes.length - 1] || 0;
    const prev = closes.length >= 2 ? closes[closes.length - 2] : current;
    const change = prev > 0 ? ((current - prev) / prev) * 100 : 0;

    return { price: current, change: Math.round(change * 100) / 100 };
  } catch (e) {
    return null;
  }
}

export async function GET() {
  const symbols = [
    { key: "usdkrw", symbol: "KRW=X", name: "USD/KRW 환율", unit: "원" },
    { key: "us10y", symbol: "^TNX", name: "미국 10년물 금리", unit: "%" },
    { key: "brent", symbol: "BZ=F", name: "브렌트유", unit: "$" },
    { key: "vix", symbol: "^VIX", name: "VIX 공포지수", unit: "" },
    { key: "sox", symbol: "^SOX", name: "필라델피아 반도체", unit: "" },
    { key: "gold", symbol: "GC=F", name: "금", unit: "$" },
  ];

  const results: Record<string, any> = {};

  await Promise.all(
    symbols.map(async ({ key, symbol, name, unit }) => {
      const data = await fetchYahoo(symbol);
      results[key] = { name, unit, ...(data || { price: 0, change: 0 }) };
    })
  );

  return NextResponse.json(results, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
  });
}
