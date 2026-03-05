import { NextResponse } from "next/server";

export async function GET() {
  const indices: Record<string, { changeRate: number }> = {};

  // KOSPI
  try {
    const res = await fetch("https://finance.naver.com/sise/sise_index.naver?code=KOSPI", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const html = await res.text();
    const rateMatch = html.match(/change_rate.*?([0-9]+\.[0-9]+)\s*%/s);
    if (rateMatch) {
      let rate = parseFloat(rateMatch[1]);
      if (html.includes("no_down") || html.includes("rate_down")) rate = -rate;
      indices["KOSPI"] = { changeRate: Math.round(rate * 100) / 100 };
    }
  } catch (e) {}

  // KOSDAQ
  try {
    const res = await fetch("https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const html = await res.text();
    const rateMatch = html.match(/change_rate.*?([0-9]+\.[0-9]+)\s*%/s);
    if (rateMatch) {
      let rate = parseFloat(rateMatch[1]);
      if (html.includes("no_down") || html.includes("rate_down")) rate = -rate;
      indices["KOSDAQ"] = { changeRate: Math.round(rate * 100) / 100 };
    }
  } catch (e) {}

  return NextResponse.json(indices, {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" },
  });
}
