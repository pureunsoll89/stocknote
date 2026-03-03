import { NextResponse } from "next/server";

export async function GET() {
  try {
    const indices: Record<string, { changeRate: number }> = {};

    // KOSPI: 0001, KOSDAQ: 1001
    const symbols = [
      { key: "KOSPI", code: "KOSPI" },
      { key: "KOSDAQ", code: "KOSDAQ" },
    ];

    await Promise.all(
      symbols.map(async ({ key, code }) => {
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
              indices[key] = { changeRate: ((curr - prev) / prev) * 100 };
            }
          }
        } catch (e) {}
      })
    );

    // Fallback: try Naver finance page
    if (!indices["KOSPI"] || !indices["KOSDAQ"]) {
      try {
        const res = await fetch("https://finance.naver.com/sise/", {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        const html = await res.text();

        const kospiMatch = html.match(/KOSPI.*?change_rate.*?([+-]?\d+\.\d+)%/s);
        const kosdaqMatch = html.match(/KOSDAQ.*?change_rate.*?([+-]?\d+\.\d+)%/s);

        if (kospiMatch && !indices["KOSPI"]) {
          indices["KOSPI"] = { changeRate: parseFloat(kospiMatch[1]) };
        }
        if (kosdaqMatch && !indices["KOSDAQ"]) {
          indices["KOSDAQ"] = { changeRate: parseFloat(kosdaqMatch[1]) };
        }
      } catch (e) {}
    }

    return NextResponse.json(indices, {
      headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (e) {
    return NextResponse.json({}, { status: 500 });
  }
}
