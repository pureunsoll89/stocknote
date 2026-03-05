import { NextResponse } from "next/server";

export async function GET() {
  const indices: Record<string, { changeRate: number }> = {};

  // Use same approach as stock-price (which works on Vercel)
  // Naver finance item page works for indices too with special codes
  const indexItems = [
    { key: "KOSPI", url: "https://finance.naver.com/sise/sise_index.naver?code=KOSPI" },
    { key: "KOSDAQ", url: "https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ" },
  ];

  // Method 1: Try m.stock.naver.com (mobile API - same domain as working stock-price)
  for (const { key } of indexItems) {
    try {
      const res = await fetch(
        `https://m.stock.naver.com/api/index/${key}/basic`,
        { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" } }
      );
      if (res.ok) {
        const data = await res.json();
        const close = parseFloat(String(data?.closePrice || "0").replace(/,/g, ""));
        const diff = parseFloat(String(data?.compareToPreviousClosePrice || "0").replace(/,/g, ""));
        const prev = close - diff;
        if (prev > 0 && close > 0) {
          indices[key] = { changeRate: Math.round((diff / prev) * 10000) / 100 };
        }
      }
    } catch (e) {}
  }

  // Method 2: Fallback - fchart API (XML based, different endpoint)
  if (!indices["KOSPI"] || !indices["KOSDAQ"]) {
    const fcodes = [
      { key: "KOSPI", code: "0001" },
      { key: "KOSDAQ", code: "1001" },
    ];
    for (const { key, code } of fcodes) {
      if (indices[key]) continue;
      try {
        const res = await fetch(
          `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=2&requestType=0`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        const text = await res.text();
        const matches = Array.from(text.matchAll(/data="([^"]+)"/g));
        if (matches.length >= 2) {
          const prev = Number(matches[matches.length - 2][1].split("|")[4]);
          const curr = Number(matches[matches.length - 1][1].split("|")[4]);
          if (prev > 0) {
            indices[key] = { changeRate: Math.round(((curr - prev) / prev) * 10000) / 100 };
          }
        }
      } catch (e) {}
    }
  }

  // Method 3: Last fallback - scrape main page
  if (!indices["KOSPI"] || !indices["KOSDAQ"]) {
    try {
      const res = await fetch("https://finance.naver.com/", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      const html = await res.text();
      if (!indices["KOSPI"]) {
        const m = html.match(/kospi_area.*?change_rate[^>]*>([^<]+)</s);
        if (m) {
          const rate = parseFloat(m[1].replace(/[^0-9.-]/g, ""));
          const isDown = html.match(/kospi_area.*?(down|minus)/s);
          indices["KOSPI"] = { changeRate: isDown ? -Math.abs(rate) : Math.abs(rate) };
        }
      }
      if (!indices["KOSDAQ"]) {
        const m = html.match(/kosdaq_area.*?change_rate[^>]*>([^<]+)</s);
        if (m) {
          const rate = parseFloat(m[1].replace(/[^0-9.-]/g, ""));
          const isDown = html.match(/kosdaq_area.*?(down|minus)/s);
          indices["KOSDAQ"] = { changeRate: isDown ? -Math.abs(rate) : Math.abs(rate) };
        }
      }
    } catch (e) {}
  }

  return NextResponse.json(indices, {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" },
  });
}
