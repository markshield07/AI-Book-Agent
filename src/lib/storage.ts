// Private file storage. Files are kept outside the web root under random keys and are
// only ever served through authorised route handlers, never by predictable URL.
// Swap this module for an S3-compatible implementation in production (see docs/ARCHITECTURE.md).
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = () => path.resolve(process.env.STORAGE_DIR || "./storage");

export function newStorageKey(prefix: string): string {
  return `${prefix}/${crypto.randomBytes(24).toString("hex")}`;
}

function resolveKey(key: string): string {
  if (!/^[a-z-]+\/[a-f0-9]{48}$/.test(key)) throw new Error("Invalid storage key");
  return path.join(root(), key);
}

export async function putFile(key: string, data: Buffer): Promise<void> {
  const p = resolveKey(key);
  await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  // wx: never overwrite an existing object (originals are immutable)
  await fs.writeFile(p, data, { flag: "wx", mode: 0o600 });
}

export async function getFile(key: string): Promise<Buffer> {
  return fs.readFile(resolveKey(key));
}

export async function deleteFile(key: string): Promise<void> {
  await fs.rm(resolveKey(key), { force: true });
}

export function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
