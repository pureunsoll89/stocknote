import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "005930";

  let price = 0;
  let changeRate = 0;

  try {
    // Primary: Naver mobile API (most reliable)
    const mRes = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/basic`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
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

  // Try after-hours (시간외 단일가)
  try {
    const nxtRes = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/integration`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (nxtRes.ok) {
      const nxtData = await nxtRes.json();
      const afterHours = nxtData?.dealTrendInfos || nxtData?.afterHoursInfo;
      if (afterHours?.closePrice) {
        const afterPrice = Number(String(afterHours.closePrice).replace(/,/g, ""));
        if (afterPrice > 0 && afterPrice !== price) {
          price = afterPrice;
        }
      }
    }
  } catch (e) {}

  // Fallback: Naver finance HTML
  if (!price) {
    try {
      const res = await fetch(
        `https://finance.naver.com/item/main.naver?code=${symbol}`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
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
