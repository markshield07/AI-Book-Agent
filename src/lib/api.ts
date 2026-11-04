import { NextResponse } from "next/server";
import type { z } from "zod";
import { NotFoundError } from "./projects";
import { DecisionError } from "./editor/decisions";
import { ImportError } from "./doc/import";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export class BadRequestError extends Error {}

/** Parse and validate a JSON request body. Malformed or wrongly-typed input is a 400, never a 500. */
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("The request body isn't valid JSON.");
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestError("The request is missing a field or has a field of the wrong type.");
  return r.data;
}

export function handleError(e: unknown) {
  if (e instanceof BadRequestError) return json({ error: e.message }, 400);
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
