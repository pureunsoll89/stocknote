import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "005930";
  const type = req.nextUrl.searchParams.get("type") || "day"; // day, week, month
  const count = req.nextUrl.searchParams.get("count") || "120";

  const timeframe = type === "month" ? "month" : type === "week" ? "week" : "day";

  try {
    const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${symbol}&timeframe=${timeframe}&count=${count}&requestType=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const text = await res.text();

    // Parse the XML-like response
    // Format: <item data="20250226|207500|209000|205500|207000|1234567" />
    const items: any[] = [];
    const regex = /data="([^"]+)"/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const parts = match[1].split("|");
      if (parts.length >= 6) {
        const date = parts[0];
        items.push({
          time: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
          open: Number(parts[1]),
          high: Number(parts[2]),
          low: Number(parts[3]),
          close: Number(parts[4]),
          volume: Number(parts[5]),
        });
      }
    }

    return NextResponse.json(items, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (e) {
    return NextResponse.json([], { status: 500 });
  }
}
