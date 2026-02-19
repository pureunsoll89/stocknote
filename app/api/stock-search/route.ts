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
    const raw = await res.text();
    return NextResponse.json({ raw });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}