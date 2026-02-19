import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  if (!query) return NextResponse.json([]);

  try {
    const res = await fetch(
      `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    const items = (data.items || []).flatMap((group: any) =>
      (group || []).map((item: any) => ({
        symbol: item.code,
        name: item.name,
        market: item.typeCode === "KOSPI" ? "KOSPI" : item.typeCode === "KOSDAQ" ? "KOSDAQ" : item.typeCode,
      }))
    );
    return NextResponse.json(items.slice(0, 10));
  } catch (e) {
    return NextResponse.json([]);
  }
}