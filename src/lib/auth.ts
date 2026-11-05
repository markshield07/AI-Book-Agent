// Identity. The app currently runs in single-author mode (Mark's request, 2026-11-03):
// there is no sign-in, and everything belongs to one owner account that is created on
// first use. All data is still stored per user and every query is scoped by owner, so
// multi-author accounts can be added back later without changing the data model.
//
// Do not expose single-author mode on a public URL: anyone who can reach it can open the
// manuscripts. Keep it on localhost or behind a private network / host-level auth.
import "server-only";
import { db } from "./db";

const OWNER_EMAIL = "owner@editorial-studio.local";

let ownerId: string | null = null;

export async function currentUser() {
  if (ownerId) {
    const u = await db.user.findUnique({ where: { id: ownerId } });
    if (u) return u;
  }
  let user = await db.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!user) {
    try {
      user = await db.user.create({ data: { email: OWNER_EMAIL, name: process.env.OWNER_NAME || "Author", passwordHash: "" } });
    } catch {
      // created concurrently by another request
      user = await db.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    }
  }
  ownerId = user.id;
  return user;
}

export async function requireUser() {
  return currentUser();
}
