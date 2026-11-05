import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { json, handleError, readJson, BadRequestError } from "@/lib/api";
import { getPublishing, savePublishing, SettingsError } from "@/lib/publish/service";

const Body = z.object({ layout: z.record(z.string(), z.unknown()).optional(), details: z.record(z.string(), z.unknown()).optional() });

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return json((await getPublishing(user.id, id)).pub);
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await readJson(req, Body);
    try {
      return json(await savePublishing(user.id, id, body));
    } catch (e) {
      if (e instanceof SettingsError) throw new BadRequestError(e.message);
      throw e;
    }
  } catch (e) {
    return handleError(e);
  }
}
