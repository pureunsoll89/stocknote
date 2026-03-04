import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "KRW=X";
  const range = req.nextUrl.searchParams.get("range") || "6mo";

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return NextResponse.json([]);

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const items: any[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const o = quotes.open?.[i];
      const h = quotes.high?.[i];
      const l = quotes.low?.[i];
      const c = quotes.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;

      const date = new Date(timestamps[i] * 1000);
      const time = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      items.push({ time, open: o, high: h, low: l, close: c, volume: quotes.volume?.[i] || 0 });
    }

    return NextResponse.json(items, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (e) {
    return NextResponse.json([], { status: 500 });
  }
}
