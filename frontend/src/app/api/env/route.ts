import { NextResponse } from "next/server";

export const runtime = "nodejs"; // keep it on Node, not edge

export async function GET() {
  const keys = [
    "NEXT_PUBLIC_API_BASE_URL",
    "NEXT_PUBLIC_AWS_REGION",
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
    "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  ];

  const report = Object.fromEntries(
    keys.map((k) => [k, process.env[k] ? "SET" : "MISSING"])
  );

  // also show if *any* NEXT_PUBLIC_ vars exist at runtime
  const allNextPublic = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"));

  return NextResponse.json({
    report,
    countNextPublic: allNextPublic.length,
    sampleNextPublic: allNextPublic.slice(0, 20),
    nodeEnv: process.env.NODE_ENV,
  });
}