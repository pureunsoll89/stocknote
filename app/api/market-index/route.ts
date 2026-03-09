import { NextResponse } from "next/server";

export async function GET() {
  const indices: Record<string, { changeRate: number }> = {};

  try {
    const res = await fetch(
      "https://polling.finance.naver.com/api/realtime?query=SERVICE_INDEX:KOSPI,SERVICE_INDEX:KOSDAQ",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    if (data?.result?.areas) {
      for (const area of data.result.areas) {
        if (area.datas) {
          for (const d of area.datas) {
            if (d.cd === "KOSPI" || d.cd === "KOSDAQ") {
              // cr is change rate: 0.02 = 0.02%
              // rf: "2"=up, "5"=down
              let rate = d.cr || 0;
              if (d.rf === "5") rate = -Math.abs(rate);
              else if (d.rf === "2") rate = Math.abs(rate);
              indices[d.cd] = { changeRate: Math.round(rate * 100) / 100 };
            }
          }
        }
      }
    }
  } catch (e) {}

  return NextResponse.json(indices, {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" },
  });
}
