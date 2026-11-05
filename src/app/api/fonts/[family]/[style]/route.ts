// Serves the bundled book fonts to the print preview. Only the fixed list of OFL fonts in
// assets/fonts is reachable; anything else is a 404 (no path is built from the request).
import fs from "node:fs";
import { NextResponse } from "next/server";
import { fontPath } from "@/lib/publish/fonts";

export async function GET(_: Request, { params }: { params: Promise<{ family: string; style: string }> }) {
  const { family, style } = await params;
  const p = fontPath(`${family}/${style}`);
  if (!p || !fs.existsSync(p)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(p)), {
    headers: { "Content-Type": "font/ttf", "Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
