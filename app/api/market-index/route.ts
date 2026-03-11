import { NextResponse } from "next/server";

// [핵심 1] Next.js 라우트 캐싱 방지 (항상 최신 데이터를 가져와야 한다면 추가)
export const dynamic = "force-dynamic";

export async function GET() {
  const indices: Record<string, { changeRate: number }> = {};

  for (const cd of ["KOSPI", "KOSDAQ"]) {
    try {
      // [핵심 2] 외부 API 캐싱 완벽 차단을 위해 타임스탬프 추가
      const timestamp = new Date().getTime();
      const res = await fetch(
        `https://polling.finance.naver.com/api/realtime?query=SERVICE_INDEX:${cd}&_=${timestamp}`,
        { 
          headers: { "User-Agent": "Mozilla/5.0" }, 
          cache: "no-store" 
        }
      );
      
      const data = await res.json();
      const datas = data?.result?.areas?.[0]?.datas;
      
      if (datas && datas.length > 0) {
        const d = datas[0];
        const cr = typeof d.cr === "number" ? d.cr : parseFloat(d.cr) || 0;
        const rate = d.rf === "5" ? -Math.abs(cr) : Math.abs(cr);
        indices[cd] = { changeRate: Math.round(rate * 100) / 100 };
      }
    } catch (e) {
      // [참고] 에러가 났을 때 파악하기 위해 로그를 남겨두는 것을 권장합니다.
      console.error(`Failed to fetch ${cd}:`, e);
    }
  }

  return NextResponse.json(indices, {
    // Vercel Edge / CDN 단의 캐싱 시간 설정 (30초 동안 캐싱 후 백그라운드 재검증)
    headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" },
  });
}