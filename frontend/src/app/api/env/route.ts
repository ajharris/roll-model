export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      nodeEnv: process.env.NODE_ENV,
      sampleNextPublic: Object.keys(process.env).filter(k => k.startsWith("NEXT_PUBLIC_")).slice(0, 50),
      report: {
        NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ? "SET" : "MISSING",
        NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION ? "SET" : "MISSING",
        NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ? "SET" : "MISSING",
        NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ? "SET" : "MISSING",
      },
    },
    { headers: { "cache-control": "no-store" } }
  );
}