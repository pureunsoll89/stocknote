import { NextResponse } from "next/server";

export async function GET() {
  const results: Record<string, any> = {};

  // Naver marketindex page - exchange rates & commodities
  // These URLs work reliably from Vercel
  const items = [
    { key: "usdkrw", name: "USD/KRW 환율", unit: "원", url: "https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW" },
    { key: "gold", name: "금", unit: "$/oz", url: "https://finance.naver.com/marketindex/goldDetail.naver?marketindexCd=GOLD_HKEX" },
    { key: "brent", name: "브렌트유", unit: "$", url: "https://finance.naver.com/marketindex/worldOilDetail.naver?marketindexCd=OIL_BRT" },
  ];

  const worldItems = [
    { key: "vix", name: "VIX 공포지수", unit: "", symbol: "VIX@CBOE" },
    { key: "sox", name: "필라델피아 반도체", unit: "", symbol: "SOX@PHIL" },
    { key: "us10y", name: "미국 10년물 금리", unit: "%", symbol: "US10YT=X" },
  ];

  // Method 1: Naver marketindex pages for exchange/commodities
  await Promise.all(items.map(async ({ key, name, unit, url }) => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      const html = await res.text();
      // Price: <span class="no">1,450.50</span>
      const priceMatch = html.match(/<span\s+class="no">\s*([0-9,]+\.?[0-9]*)\s*<\/span>/);
      // Change rate: class="cpc" or percent
      const rateMatch = html.match(/class="per[^"]*"[^>]*>\s*([0-9.]+)%/s);
      const isDown = html.includes("graph_img down") || html.includes("ico_down") || html.includes("minus");

      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ""));
        let change = rateMatch ? parseFloat(rateMatch[1]) : 0;
        if (isDown) change = -change;
        results[key] = { name, unit, price, change: Math.round(change * 100) / 100 };
      }
    } catch (e) {}
  }));

  // Method 2: Naver world stock indices via sise page
  await Promise.all(worldItems.map(async ({ key, name, unit, symbol }) => {
    try {
      // Try world index page
      const codeMap: Record<string, string> = {
        "VIX@CBOE": "VIX",
        "SOX@PHIL": "SOXX",
        "US10YT=X": "US10Y",
      };
      const worldCode = codeMap[symbol] || symbol;

      // Try Naver world sise
      const res = await fetch(
        `https://finance.naver.com/world/sise.naver?symbol=${symbol}`,
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
      );
      const html = await res.text();
      // <span id="now_value">5,234.56</span>
      const priceMatch = html.match(/now_value[^>]*>\s*([0-9,]+\.?[0-9]*)/);
      const rateMatch = html.match(/per_value[^>]*>\s*([0-9.]+)%/);
      const isDown = html.includes("point_dn") || html.includes("ico_d_") || html.includes("minus");

      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ""));
        let change = rateMatch ? parseFloat(rateMatch[1]) : 0;
        if (isDown) change = -change;
        results[key] = { name, unit, price, change: Math.round(change * 100) / 100 };
      }
    } catch (e) {}
  }));

  // Gold: convert to KRW/g if we have exchange rate
  if (results["gold"]?.price && results["usdkrw"]?.price) {
    results["gold"].priceKrw = Math.round((results["gold"].price / 31.1035) * results["usdkrw"].price);
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "s-maxage=180, stale-while-revalidate=360" },
  });
}
