import { NextResponse } from "next/server";

export async function GET() {
  const indices: Record<string, { changeRate: number }> = {};

  // Fetch KOSPI and KOSDAQ separately to ensure both work
  for (const cd of ["KOSPI", "KOSDAQ"]) {
    try {
      const res = await fetch(
        `https://polling.finance.naver.com/api/realtime?query=SERVICE_INDEX:${cd}`,
        { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
      );
      const data = await res.json();
      const datas = data?.result?.areas?.[0]?.datas;
      if (datas && datas.length > 0) {
        const d = datas[0];
        // cr = change rate (e.g. 4.90 means 4.90%)
        // rf: "2" = up, "5" = down
        const cr = typeof d.cr === "number" ? d.cr : parseFloat(d.cr) || 0;
        const rate = d.rf === "5" ? -Math.abs(cr) : Math.abs(cr);
        indices[cd] = { changeRate: Math.round(rate * 100) / 100 };
      }
    } catch (e) {}
  }

  return NextResponse.json(indices, {
    headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" },
  });
}
