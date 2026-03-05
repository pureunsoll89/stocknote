import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "005930";

  let price = 0;
  let changeRate = 0;

  try {
    const mRes = await fetch(
      `https://m.stock.naver.com/api/stock/${symbol}/basic`,
      { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" } }
    );
    if (mRes.ok) {
      const mData = await mRes.json();

      // Regular market price
      if (mData?.closePrice) {
        price = Number(String(mData.closePrice).replace(/,/g, ""));
      }
      if (mData?.fluctuationsRatio) {
        changeRate = Number(String(mData.fluctuationsRatio).replace(/,/g, ""));
        if (mData?.compareToPreviousPrice?.code === "5" || mData?.compareToPreviousPrice?.name === "FALLING") {
          changeRate = -Math.abs(changeRate);
        }
      }

      // After-hours price (시간외)
      const over = mData?.overMarketPriceInfo;
      if (over?.overPrice && over?.overMarketStatus !== "NONE") {
        const overPrice = Number(String(over.overPrice).replace(/,/g, ""));
        if (overPrice > 0) {
          price = overPrice;
          if (over?.fluctuationsRatio) {
            changeRate = Number(String(over.fluctuationsRatio).replace(/,/g, ""));
            if (over?.compareToPreviousPrice?.code === "5" || over?.compareToPreviousPrice?.name === "FALLING") {
              changeRate = -Math.abs(changeRate);
            }
          }
        }
      }
    }
  } catch (e) {}

  // Fallback: HTML scraping
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
      if (changeMatch) {
        changeRate = Number(changeMatch[1]);
        if (html.includes("nv_down")) changeRate = -changeRate;
      }
    } catch (e) {}
  }

  return NextResponse.json(
    { price, changeRate: Math.round(changeRate * 100) / 100 },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } }
  );
}
