import { NextResponse } from "next/server";

export async function GET() {
  try {
    const indices: Record<string, { changeRate: number }> = {};

    // Try Naver mobile API for indices
    const indexCodes = [
      { key: "KOSPI", code: "KOSPI" },
      { key: "KOSDAQ", code: "KOSDAQ" },
    ];

    await Promise.all(
      indexCodes.map(async ({ key, code }) => {
        try {
          const res = await fetch(
            `https://m.stock.naver.com/api/index/${code}/basic`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
          );
          if (res.ok) {
            const data = await res.json();
            if (data?.compareToPreviousClosePrice && data?.closePrice) {
              const close = Number(String(data.closePrice).replace(/,/g, ""));
              const diff = Number(String(data.compareToPreviousClosePrice).replace(/,/g, ""));
              const prev = close - diff;
              if (prev > 0) {
                indices[key] = { changeRate: Math.round((diff / prev) * 10000) / 100 };
              }
            }
          }
        } catch (e) {}
      })
    );

    // Fallback: fchart
    if (!indices["KOSPI"] || !indices["KOSDAQ"]) {
      const fallbackCodes = [
        { key: "KOSPI", code: "0001" },
        { key: "KOSDAQ", code: "1001" },
      ];
      await Promise.all(
        fallbackCodes.map(async ({ key, code }) => {
          if (indices[key]) return;
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
        })
      );
    }

    return NextResponse.json(indices, {
      headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (e) {
    return NextResponse.json({}, { status: 500 });
  }
}
