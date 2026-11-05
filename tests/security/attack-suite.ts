// The Auditor's live attack suite. Runs against a running app (default http://localhost:3100)
// and tries to break it from the outside, the way a hostile web page or a careless script would.
// Every check must pass before an update ships. Usage:
//   AI_PROVIDER=rules npm start &      (in another terminal)
//   npm run test:attack
import JSZip from "jszip";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const HOST = new URL(BASE).host;
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL || "file:./studio.db" });
let failures = 0;

function check(cond: unknown, msg: string, detail = "") {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}${detail ? `  (${detail})` : ""}`);
  }
}

const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(BASE + path, { redirect: "manual", ...init });

async function setupProject() {
  // Same owner account the app creates in single-author mode.
  const owner = await db.user.upsert({
    where: { email: "owner@editorial-studio.local" },
    update: {},
    create: { email: "owner@editorial-studio.local", name: "Author", passwordHash: "" },
  });
  return db.project.create({ data: { userId: owner.id, title: `Attack suite ${Date.now()}`, authorName: "Auditor", targetFormats: ["kindle"], styleSheet: {} } });
}

function upload(projectId: string, name: string, data: Buffer | string, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new Blob([typeof data === "string" ? data : new Uint8Array(data)]), name);
  return req(`/api/projects/${projectId}/upload`, { method: "POST", body: form, headers });
}

async function main() {
  const project = await setupProject();
  const P = project.id;
  console.log(`Attacking ${BASE} (project ${P})`);

  console.log("\nNetwork exposure and DNS rebinding");
  {
    const net = await import("node:net");
    const u = new URL(BASE);
    const raw: string = await new Promise((resolve, reject) => {
      const s = net.connect(Number(u.port || 80), u.hostname, () =>
        s.write(`GET /api/account/export HTTP/1.1\r\nHost: rebind.evil.example:${u.port}\r\nConnection: close\r\n\r\n`)
      );
      let out = "";
      s.on("data", (d) => (out += d));
      s.on("end", () => resolve(out));
      s.on("error", reject);
    });
    check(/^HTTP\/1\.1 4(21|03)/.test(raw), "raw DNS-rebinding request for all manuscripts refused", raw.split("\r\n")[0]);
  }

  console.log("\nCross-site requests (CSRF)");
  for (const [label, headers] of [
    ["evil Origin", { Origin: "https://evil.example" }],
    ["Sec-Fetch-Site cross-site", { "Sec-Fetch-Site": "cross-site" }],
    ["Origin null (sandboxed frame)", { Origin: "null" }],
  ] as const) {
    const r = await req(`/api/projects/${P}/undo`, { method: "POST", headers: { "Content-Type": "text/plain", ...headers } });
    check(r.status === 403, `undo refused with ${label}`, `got ${r.status}`);
    const u = await upload(P, "x.txt", "Chapter 1\n\nPlanted text.", headers);
    check(u.status === 403, `upload refused with ${label}`, `got ${u.status}`);
  }
  const action = await req(`/dashboard`, { method: "POST", headers: { Origin: "https://evil.example", "Next-Action": "0".repeat(40), "Content-Type": "text/plain" }, body: "[]" });
  check(action.status === 403, "cross-site server action refused", `got ${action.status}`);
  const same = await req(`/api/projects/${P}/undo`, { method: "POST", headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin" } });
  check(same.status === 200, "same-origin request still works", `got ${same.status}`);

  console.log("\nSecurity headers");
  for (const path of ["/dashboard", `/api/projects/${P}/job`]) {
    const r = await req(path);
    check(r.headers.get("x-frame-options") === "DENY", `${path} cannot be framed (clickjacking)`);
    check(/frame-ancestors 'none'/.test(r.headers.get("content-security-policy") ?? ""), `${path} sends CSP frame-ancestors`);
    check(r.headers.get("x-content-type-options") === "nosniff", `${path} sends nosniff`);
    check(!r.headers.get("x-powered-by"), `${path} doesn't advertise the framework`);
  }

  console.log("\nMalformed and hostile input");
  for (const [label, body] of [["broken JSON", "{bad"], ["null body", "null"], ["array body", "[]"], ["wrong type", '{"action":42}'],
    ["unknown action", '{"action":"delete"}']] as const) {
    const r = await req(`/api/chapters/nope/bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    check(r.status === 400, `bulk: ${label} is a 400`, `got ${r.status}`);
    const s = await req(`/api/suggestions/nope`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    check(s.status === 400, `suggestion: ${label} is a 400`, `got ${s.status}`);
  }
  // Query-operator objects where a string is expected must never reach the database layer.
  const inj1 = await req(`/api/chapters/nope/bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"accept","category":{"not":""}}' });
  check(inj1.status === 400, "bulk: Prisma filter object in category is a 400", `got ${inj1.status}`);
  const inj2 = await req(`/api/suggestions/nope`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"modify","authorText":{"not":""}}' });
  check(inj2.status === 400, "suggestion: object in authorText is a 400", `got ${inj2.status}`);
  const huge = await req(`/api/suggestions/nope`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "modify", authorText: "x".repeat(200_000) }) });
  check(huge.status === 400, "oversized replacement text refused", `got ${huge.status}`);

  console.log("\nIDs that don't exist or try to escape");
  for (const id of ["does-not-exist", "..%2F..%2Fetc%2Fpasswd", "%00", "' OR 1=1 --", "a".repeat(500)]) {
    for (const path of [`/api/exports/${id}`, `/api/source-files/${id}`, `/api/projects/${id}/job`, `/api/projects/${id}/review`]) {
      const r = await req(path);
      check([400, 404].includes(r.status), `GET ${path.slice(0, 50)} → not found`, `got ${r.status}`);
    }
  }
  const page = await req(`/projects/does-not-exist`);
  check(page.status === 404, "unknown book page is a 404", `got ${page.status}`);

  console.log("\nHostile uploads");
  check((await upload(P, "empty.txt", "")).status === 422, "empty file refused");
  check((await upload(P, "virus.exe", "MZ\u0000\u0001")).status === 422, "executable refused");
  check((await upload(P, "fake.docx", "this is not a zip")).status === 422, "fake .docx refused");
  {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document>" + "A".repeat(320 * 1024 * 1024) + "</w:document>");
    const bomb = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const r = await upload(P, "bomb.docx", bomb);
    check(r.status === 422, `zip bomb (${(bomb.length / 1024).toFixed(0)} KB → 320 MB) refused without crashing`, `got ${r.status}`);
  }
  const big = await upload(P, "big.txt", Buffer.alloc(26 * 1024 * 1024, 0x61));
  check(big.status === 422 || big.status === 413, "file over 25 MB refused", `got ${big.status}`);
  {
    // A legitimate large Word file (pictures make real manuscripts 10-25 MB) must still upload.
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Chapter 1</w:t></w:r></w:p><w:p><w:r><w:t>A big book with pictures.</w:t></w:r></w:p></w:body></w:document>');
    const { randomBytes } = await import("node:crypto");
    zip.file("word/media/photo.bin", randomBytes(15 * 1024 * 1024), { compression: "STORE" });
    const bigDocx = await zip.generateAsync({ type: "nodebuffer" });
    const r = await upload(P, "big-with-pictures.docx", bigDocx);
    check(r.status === 200, `legitimate ${(bigDocx.length / 1048576).toFixed(0)} MB Word file uploads`, `got ${r.status}`);
  }
  const alive = await req("/dashboard");
  check(alive.status === 200, "app still up after hostile uploads");

  console.log("\nStored script injection (XSS) and file name tricks");
  const xss = '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">';
  const ok = await upload(P, `../../${'"'}evil\r\nX-Injected: 1.txt`, `Chapter 1 ${xss}\n\nA line with ${xss} inside.`);
  check(ok.status === 200, "manuscript with script-looking text imports as text", `got ${ok.status}`);
  const html = await (await req(`/projects/${P}/review`)).text();
  check(!html.includes("<script>window.__pwned"), "script tags in a manuscript are escaped on the review page");
  check(!/<img src=x onerror/.test(html), "event-handler markup in a manuscript is escaped");
  const sf = await db.sourceFile.findFirst({ where: { projectId: P }, orderBy: { createdAt: "desc" } });
  if (sf) {
    check(!sf.storageKey.includes(".."), "upload stored under a random key, not the supplied path");
    const dl = await req(`/api/source-files/${sf.id}`);
    const cd = dl.headers.get("content-disposition") ?? "";
    check(dl.status === 200 && !/[\r\n"]evil/.test(cd) && !dl.headers.get("x-injected"), "download file name can't inject headers", cd);
  } else check(false, "source file saved");

  console.log("\nRace conditions (rapid clicking)");
  const para = await db.paragraph.findFirst({ where: { chapter: { projectId: P } } });
  if (para) {
    const s = await db.suggestion.create({ data: { projectId: P, chapterId: para.chapterId, paragraphId: para.id, start: 0, end: 1, originalText: para.text.slice(0, 1), suggestedText: "Z", category: "style", explanation: "race" } });
    const t = Date.now();
    const acts = ["accept", "reject", "accept", "reset", "reject", "accept", "reject", "accept"];
    const rs = await Promise.all(acts.map((action) => req(`/api/suggestions/${s.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })));
    const ms = Date.now() - t;
    check(rs.every((r) => r.status === 200), "8 simultaneous decisions all succeed", rs.map((r) => r.status).join(","));
    check(ms < 5000, `no lock-up under rapid clicks (${ms} ms)`);
  }

  await db.project.delete({ where: { id: P } }).catch(() => undefined);
  await db.$disconnect();
  console.log(failures ? `\nATTACK SUITE FAILED: ${failures} check(s)` : "\nAttack suite passed: nothing broke.");
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
