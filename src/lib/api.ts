import { NextResponse } from "next/server";
import { NotFoundError } from "./projects";
import { DecisionError } from "./editor/decisions";
import { ImportError } from "./doc/import";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function handleError(e: unknown) {
  if (e instanceof NotFoundError) return json({ error: "Not found" }, 404);
  if (e instanceof DecisionError) return json({ error: e.message, code: e.code }, e.code === "invalid" ? 400 : 409);
  if (e instanceof ImportError) return json({ error: e.message }, 422);
  console.error(e);
  return json({ error: "Something went wrong on our side. Your work is saved; please try again." }, 500);
}

export function fileResponse(buf: Buffer, filename: string, type: string) {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
