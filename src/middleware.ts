import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/lib/security/request-guard";

export function middleware(req: NextRequest) {
  const r = checkRequest(req.method, req.headers);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status, headers: { "Cache-Control": "no-store" } });
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
