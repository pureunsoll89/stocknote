import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "005930";

  let price = 0;
  let changeRate = 0;

  // Method 1: Naver mobile API (works from Vercel)
  try {
    const mRes = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/basic`,
      { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" } }
    );
    if (mRes.ok) {
      const mData = await mRes.json();
      if (mData?.closePrice) {
        price = Number(String(mData.closePrice).replace(/,/g, ""));
      }
      if (mData?.compareToPreviousClosePrice && price) {
        const diff = Number(String(mData.compareToPreviousClosePrice).replace(/,/g, ""));
        const prev = price - diff;
        if (prev > 0) changeRate = (diff / prev) * 100;
      }
    }
  } catch (e) {}

  // Method 2: Try after-hours price via Naver mobile real API
  try {
    const aRes = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/dealTrend`,
      { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" } }
    );
    if (aRes.ok) {
      const aData = await aRes.json();
      // After-hours price from deal trend
      if (Array.isArray(aData) && aData.length > 0) {
        const last = aData[aData.length - 1];
        if (last?.closePrice) {
          const afterPrice = Number(String(last.closePrice).replace(/,/g, ""));
          if (afterPrice > 0) price = afterPrice;
        }
      }
    }
  } catch (e) {}

  // Method 3: Fallback - HTML scraping
  if (!price) {
    try {
      const res = await fetch(
        `https://finance.naver.com/item/main.naver?code=${symbol}`,
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
      );
      const html = await res.text();
      const priceMatch = html.match(/no_today.*?<span class="blind">([0-9,]+)<\/span>/s);
      if (priceMatch) price = Number(priceMatch[1].replace(/,/g, ""));

      const changeMatch = html.match(/no_exday.*?<span class="blind">([0-9.]+)<\/span>/s);
      const isDown = html.includes("nv_down");
      if (changeMatch) {
        changeRate = Number(changeMatch[1]);
        if (isDown) changeRate = -changeRate;
      }
    } catch (e) {}
  }

  return NextResponse.json(
    { price, changeRate: Math.round(changeRate * 100) / 100 },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } }
  );
}
