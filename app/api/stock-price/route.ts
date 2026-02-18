import { NextResponse } from "next/server";

const KIS_APPKEY = "PSZgH1twYifPWfWujMcHoj8vk0q0PxpZtGHZ";
const KIS_APPSECRET = "sNJawgp5O18717pkBGmPEW+nSS51YJbty8TPlOIj/PT3Yk7yBCPV/q5qEjWT2qymm83O8QRiJtqG/Bs//5bxSRTP509EyGAPQ5A/0c4U1t44rZdxMnQBG67vPNHX4kfJgRu7S3N5SIsu+tjBSbAjcAPPbhCKnAl0VPoj9qfYY5F3E8sIBfo=";
const KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";

let cachedToken = "";
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: KIS_APPKEY,
      appsecret: KIS_APPSECRET,
    }),
  });
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  try {
    const token = await getToken();
    const res = await fetch(
      `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${symbol}`,
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
          appkey: KIS_APPKEY,
          appsecret: KIS_APPSECRET,
          tr_id: "FHKST01010100",
        },
      }
    );
    const data = await res.json();
    const price = parseInt(data.output?.stck_prpr || "0");
    const change = parseInt(data.output?.prdy_vrss || "0");
    const changeRate = parseFloat(data.output?.prdy_ctrt || "0");
    return NextResponse.json({ symbol, price, change, changeRate });
  } catch (e) {
    return NextResponse.json({ error: "API 호출 실패" }, { status: 500 });
  }
}