// Optional official validation with W3C EPUBCheck. It needs Java and the EPUBCheck jar, which
// are free but not bundled. Set EPUBCHECK_JAR, or unzip EPUBCheck into tools/epubcheck/.
// Without them the report says "Not checked" instead of pretending.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReadinessCheck } from "./checks";

export function epubcheckJar(): string | null {
  const candidates = [process.env.EPUBCHECK_JAR, path.join(process.cwd(), "tools", "epubcheck", "epubcheck.jar")].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // tools/epubcheck/epubcheck-5.x.x/epubcheck.jar (the release zip unpacked as-is)
  const dir = path.join(process.cwd(), "tools", "epubcheck");
  if (fs.existsSync(dir)) {
    for (const d of fs.readdirSync(dir)) {
      const p = path.join(dir, d, "epubcheck.jar");
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

interface EpubcheckJson {
  messages?: { severity: string; message: string; ID: string; locations?: { path?: string; line?: number }[] }[];
  checker?: { checkerVersion?: string };
}

export async function runEpubcheck(buf: Buffer): Promise<ReadinessCheck> {
  const label = "Official EPUBCheck validation";
  const jar = epubcheckJar();
  if (!jar) {
    return {
      id: "epub.epubcheck",
      label,
      status: "not_checked",
      detail: "EPUBCheck isn't installed. The built-in checks above still ran. To add the official validator, install Java and unzip EPUBCheck into tools/epubcheck (see README).",
    };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "epubcheck-"));
  const file = path.join(tmp, "book.epub");
  const report = path.join(tmp, "report.json");
  fs.writeFileSync(file, buf);
  try {
    const code = await new Promise<number>((resolve) => {
      execFile("java", ["-jar", jar, file, "--json", report], { timeout: 120_000, windowsHide: true }, (err) => {
        resolve(err ? ((err as NodeJS.ErrnoException & { code?: number | string }).code === "ENOENT" ? -1 : 1) : 0);
      });
    });
    if (code === -1) return { id: "epub.epubcheck", label, status: "not_checked", detail: "EPUBCheck is present but Java isn't installed, so it couldn't run." };
    const data = JSON.parse(fs.readFileSync(report, "utf8")) as EpubcheckJson;
    const msgs = data.messages ?? [];
    const errors = msgs.filter((m) => m.severity === "ERROR" || m.severity === "FATAL");
    const warnings = msgs.filter((m) => m.severity === "WARNING");
    const fmt = (m: (typeof msgs)[number]) => `${m.ID}: ${m.message}${m.locations?.[0]?.path ? ` (${m.locations[0].path}${m.locations[0].line ? `:${m.locations[0].line}` : ""})` : ""}`;
    const version = data.checker?.checkerVersion ? ` ${data.checker.checkerVersion}` : "";
    if (errors.length) return { id: "epub.epubcheck", label, status: "failed", detail: `EPUBCheck${version} found ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors.slice(0, 3).map(fmt).join("; ")}` };
    if (warnings.length) return { id: "epub.epubcheck", label, status: "warning", detail: `EPUBCheck${version}: no errors, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${warnings.slice(0, 3).map(fmt).join("; ")}` };
    return { id: "epub.epubcheck", label, status: "passed", detail: `EPUBCheck${version}: no errors or warnings.` };
  } catch (e) {
    return { id: "epub.epubcheck", label, status: "not_checked", detail: `EPUBCheck could not run: ${(e as Error).message}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
