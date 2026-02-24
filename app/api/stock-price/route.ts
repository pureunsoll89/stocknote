import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  try {
    // 네이버 증권 내부 API (JSON 반환)
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/basic`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    
    const price = parseInt(data?.closePrice?.replace(/,/g, "") || "0");
    const change = parseInt(data?.compareToPreviousClosePrice?.replace(/,/g, "") || "0");
    const changeRate = parseFloat(data?.fluctuationsRatio || "0");
    const name = data?.stockName || "";

    const prevPrice = price - change;
    const dayChangeRate = prevPrice > 0 ? ((change / prevPrice) * 100) : 0;
    return NextResponse.json({ symbol, name, price, change, changeRate: dayChangeRate }, { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } });
  } catch (e: any) {
    return NextResponse.json({ error: "조회 실패", detail: e.message }, { status: 500 });
  }
}