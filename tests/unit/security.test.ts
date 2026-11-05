// The Auditor's adversarial unit tests: each one is an attack that must keep failing.
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { checkRequest, hostnameOf, allowedHosts } from "@/lib/security/request-guard";
import { readJson, BadRequestError } from "@/lib/api";
import { importManuscript, ImportError } from "@/lib/doc/import";
import { z } from "zod";

const h = (o: Record<string, string>) => new Headers(o);
const local = allowedHosts("");

describe("request guard: DNS rebinding", () => {
  it("parses host names with ports and IPv6", () => {
    expect(hostnameOf("localhost:3100")).toBe("localhost");
    expect(hostnameOf("[::1]:3100")).toBe("[::1]");
    expect(hostnameOf("127.0.0.1")).toBe("127.0.0.1");
    expect(hostnameOf("Evil.Example:3100")).toBe("evil.example");
  });
  it("answers local hosts", () => {
    for (const host of ["localhost:3100", "127.0.0.1:3100", "[::1]:3100", "LOCALHOST:3100"])
      expect(checkRequest("GET", h({ host }), local).ok).toBe(true);
  });
  it("refuses any other Host, even for reads", () => {
    for (const host of ["evil.example:3100", "localhost.evil.example", "127.0.0.1.nip.io:3100", "192.168.1.20:3100", ""]) {
      const r = checkRequest("GET", h(host ? { host } : {}), local);
      expect(r.ok).toBe(false);
    }
  });
  it("allows hosts the owner adds to ALLOWED_HOSTS", () => {
    expect(checkRequest("GET", h({ host: "studio.lan:3100" }), allowedHosts("studio.lan")).ok).toBe(true);
  });
});

describe("request guard: cross-site requests (CSRF)", () => {
  const base = { host: "localhost:3100" };
  it("allows same-origin browser POSTs", () => {
    expect(checkRequest("POST", h({ ...base, origin: "http://localhost:3100", "sec-fetch-site": "same-origin" }), local).ok).toBe(true);
  });
  it("allows non-browser clients on this computer (no Origin)", () => {
    expect(checkRequest("POST", h(base), local).ok).toBe(true);
  });
  it("refuses POSTs from another site", () => {
    expect(checkRequest("POST", h({ ...base, origin: "https://evil.example" }), local).ok).toBe(false);
    expect(checkRequest("POST", h({ ...base, "sec-fetch-site": "cross-site" }), local).ok).toBe(false);
    expect(checkRequest("POST", h({ ...base, "sec-fetch-site": "same-site" }), local).ok).toBe(false);
    expect(checkRequest("DELETE", h({ ...base, origin: "http://localhost:4000" }), local).ok).toBe(false);
  });
  it("refuses Origin: null (sandboxed frames, file:// pages) and garbage origins", () => {
    expect(checkRequest("POST", h({ ...base, origin: "null" }), local).ok).toBe(false);
    expect(checkRequest("POST", h({ ...base, origin: "not a url" }), local).ok).toBe(false);
  });
});

describe("JSON body validation", () => {
  const S = z.object({ action: z.enum(["accept", "reject"]) });
  const req = (body: string) => new Request("http://localhost/x", { method: "POST", body });
  it("rejects malformed JSON with a 400-class error, not a crash", async () => {
    await expect(readJson(req("{bad"), S)).rejects.toBeInstanceOf(BadRequestError);
    await expect(readJson(req(""), S)).rejects.toBeInstanceOf(BadRequestError);
  });
  it("rejects null, arrays, wrong types and Prisma filter objects", async () => {
    for (const b of ["null", "[]", '{"action":1}', '{"action":{"contains":""}}', '{"action":"delete"}'])
      await expect(readJson(req(b), S)).rejects.toBeInstanceOf(BadRequestError);
  });
  it("accepts a valid body", async () => {
    await expect(readJson(req('{"action":"accept"}'), S)).resolves.toEqual({ action: "accept" });
  });
});

describe("hostile uploads", () => {
  it("refuses a DOCX zip bomb before unpacking it", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", "<w:document>" + "A".repeat(320 * 1024 * 1024) + "</w:document>");
    const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    expect(data.length).toBeLessThan(2 * 1024 * 1024);
    await expect(importManuscript("bomb.docx", data)).rejects.toThrow(/300 MB/);
  }, 120_000);
  it("refuses a zip that is not a Word document", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    const data = await zip.generateAsync({ type: "nodebuffer" });
    await expect(importManuscript("fake.docx", data)).rejects.toBeInstanceOf(ImportError);
  });
  it("refuses truncated / garbage DOCX", async () => {
    await expect(importManuscript("x.docx", Buffer.from("PK\u0003\u0004garbage"))).rejects.toBeInstanceOf(ImportError);
  });
  it("refuses binary data disguised as text", async () => {
    await expect(importManuscript("x.txt", Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).rejects.toBeInstanceOf(ImportError);
  });
  it("keeps script-looking text as plain text (no markup injection)", async () => {
    const r = await importManuscript("x.txt", Buffer.from('Chapter 1\n\n<script>alert(1)</script> and <img src=x onerror=alert(1)>'));
    expect(r.chapters[0].paragraphs[0].text).toContain("<script>alert(1)</script>");
  });
});
