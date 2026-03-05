import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "005930";

  try {
    // Try Naver finance page for real-time + after-hours
    const res = await fetch(
      `https://finance.naver.com/item/main.naver?code=${symbol}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const html = await res.text();

    // Current price
    const priceMatch = html.match(/no_today.*?<span class="blind">([0-9,]+)<\/span>/s);
    let price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : 0;

    // Change rate
    const changeMatch = html.match(/no_exday.*?<span class="blind">([0-9.]+)<\/span>/s);
    const isDown = html.includes("no_exday") && html.includes("nv_down");
    let changeRate = changeMatch ? Number(changeMatch[1]) : 0;
    if (isDown) changeRate = -changeRate;

    // Try after-hours (시간외) price from NXT
    try {
      const nxtRes = await fetch(
        `https://m.stock.naver.com/api/stock/${symbol}/afterhours`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (nxtRes.ok) {
        const nxtData = await nxtRes.json();
        if (nxtData?.closePrice) {
          const afterPrice = Number(String(nxtData.closePrice).replace(/,/g, ""));
          if (afterPrice > 0) {
            price = afterPrice;
            // Recalculate change rate based on after-hours
            if (nxtData?.compareToPreviousClosePrice) {
              const diff = Number(String(nxtData.compareToPreviousClosePrice).replace(/,/g, ""));
              const prevPrice = afterPrice - diff;
              if (prevPrice > 0) changeRate = (diff / prevPrice) * 100;
            }
          }
        }
      }
    } catch (e) {}

    // Fallback: try mobile API
    if (!price) {
      try {
        const mRes = await fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/basic`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        const mData = await mRes.json();
        if (mData?.closePrice) price = Number(String(mData.closePrice).replace(/,/g, ""));
        if (mData?.compareToPreviousClosePrice && mData?.closePrice) {
          const diff = Number(String(mData.compareToPreviousClosePrice).replace(/,/g, ""));
          const prev = price - diff;
          if (prev > 0) changeRate = (diff / prev) * 100;
        }
      } catch (e) {}
    }

    return NextResponse.json(
      { price, changeRate: Math.round(changeRate * 100) / 100 },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (e) {
    return NextResponse.json({ price: 0, changeRate: 0 }, { status: 500 });
  }
}
