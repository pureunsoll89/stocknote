import { NextResponse } from "next/server";

// Fetch from Naver world index API
async function fetchNaverWorldIndex(code: string) {
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/index/${code}/basic`,
      { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const close = parseFloat(String(data?.closePrice || "0").replace(/,/g, ""));
    const ratio = parseFloat(String(data?.fluctuationsRatio || "0").replace(/,/g, ""));
    const isFalling = data?.compareToPreviousPrice?.name === "FALLING" || data?.compareToPreviousPrice?.code === "5";
    return { price: close, change: isFalling ? -Math.abs(ratio) : Math.abs(ratio) };
  } catch (e) { return null; }
}

// Fetch from Naver marketindex (exchange rates, commodities)
async function fetchNaverMarketIndex(code: string) {
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/marketindex/${code}/basic`,
      { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const close = parseFloat(String(data?.closePrice || "0").replace(/,/g, ""));
    const ratio = parseFloat(String(data?.fluctuationsRatio || "0").replace(/,/g, ""));
    const isFalling = data?.compareToPreviousPrice?.name === "FALLING" || data?.compareToPreviousPrice?.code === "5";
    return { price: close, change: isFalling ? -Math.abs(ratio) : Math.abs(ratio) };
  } catch (e) { return null; }
}

export async function GET() {
  const results: Record<string, any> = {};

  // Define items to fetch
  const items = [
    { key: "usdkrw", name: "USD/KRW 환율", unit: "원", type: "marketindex", code: "FX_USDKRW" },
    { key: "us10y", name: "미국 10년물 금리", unit: "%", type: "index", code: "US10YT" },
    { key: "brent", name: "브렌트유", unit: "$", type: "marketindex", code: "OIL_CL" },
    { key: "vix", name: "VIX 공포지수", unit: "", type: "index", code: "VIX" },
    { key: "sox", name: "필라델피아 반도체", unit: "", type: "index", code: "SOX" },
    { key: "gold", name: "금", unit: "원", type: "marketindex", code: "GOLD_HKEX" },
  ];

  // Try Naver mobile APIs
  await Promise.all(items.map(async (item) => {
    let data = null;
    if (item.type === "marketindex") {
      data = await fetchNaverMarketIndex(item.code);
    } else {
      data = await fetchNaverWorldIndex(item.code);
    }
    if (data) {
      results[item.key] = { name: item.name, unit: item.unit, ...data, yahooSymbol: item.code };
    }
  }));

  // Fallback codes if primary ones fail
  const fallbacks: Record<string, { type: string; codes: string[] }> = {
    usdkrw: { type: "marketindex", codes: ["FX_USDKRW", "exchangeRate/FX_USDKRW"] },
    brent: { type: "marketindex", codes: ["OIL_BT", "worldOilPrice/OIL_BT", "OIL_CL"] },
    gold: { type: "marketindex", codes: ["GOLD_HKEX", "goldPrice/GOLD_HKEX", "GLD"] },
    vix: { type: "index", codes: ["VIX", "CBOE_VIX", ".VIX"] },
    sox: { type: "index", codes: ["SOX", "SOXX", "PHLX_SOX"] },
    us10y: { type: "index", codes: ["US10YT", "TNX", "US10Y"] },
  };

  for (const [key, fb] of Object.entries(fallbacks)) {
    if (results[key]) continue;
    for (const code of fb.codes) {
      const data = fb.type === "marketindex" ? await fetchNaverMarketIndex(code) : await fetchNaverWorldIndex(code);
      if (data && data.price > 0) {
        const item = items.find(i => i.key === key);
        results[key] = { name: item?.name || key, unit: item?.unit || "", ...data, yahooSymbol: code };
        break;
      }
    }
  }

  // Calculate gold in KRW/g if we have USD gold price and exchange rate
  if (results["gold"]?.price && results["usdkrw"]?.price && results["gold"].unit !== "원") {
    const usdPrice = results["gold"].price;
    const krwRate = results["usdkrw"].price;
    results["gold"].priceKrw = Math.round((usdPrice / 31.1035) * krwRate);
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "s-maxage=180, stale-while-revalidate=360" },
  });
}
