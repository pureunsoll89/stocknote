import { NextResponse } from "next/server";

export async function GET() {
  try {
    const [kospiRes, kosdaqRes] = await Promise.all([
      fetch("https://m.stock.naver.com/api/index/KOSPI/basic", { headers: { "User-Agent": "Mozilla/5.0" } }),
      fetch("https://m.stock.naver.com/api/index/KOSDAQ/basic", { headers: { "User-Agent": "Mozilla/5.0" } }),
    ]);
    const kospi = await kospiRes.json();
    const kosdaq = await kosdaqRes.json();
    return NextResponse.json({
      KOSPI: { price: kospi?.closePrice, change: kospi?.compareToPreviousClosePrice, changeRate: parseFloat(kospi?.fluctuationsRatio || "0") },
      KOSDAQ: { price: kosdaq?.closePrice, change: kosdaq?.compareToPreviousClosePrice, changeRate: parseFloat(kosdaq?.fluctuationsRatio || "0") },
    });
  } catch (e) {
    return NextResponse.json({ KOSPI: { changeRate: 0 }, KOSDAQ: { changeRate: 0 } });
  }
}