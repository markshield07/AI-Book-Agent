// Stress run: a full-length novel (about 110,000 words, 36 chapters) through the whole author
// workflow in a real browser, timing each step. Run against a running app: npx tsx tests/e2e/long-book.ts
import { chromium } from "playwright";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { promises as fs } from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const OUT = process.env.E2E_OUT || "test-results/long-book";
const CHAPTERS = Number(process.env.CHAPTERS || 36);
const PARAS = Number(process.env.PARAS || 60);

const SENT = [
  "The rain had not let up since morning, and the gutters along Fenwick Street ran like small rivers.",
  "“You can't keep doing this,” she said, not looking up from the stove.",
  "He waited by the window for a long time, counting the cars that passed and the ones that didn't.",
  "Nobody in the family talked about that summer, but everybody remembered it.",
  "She folded the letter twice and slid it under the sugar tin where no one would think to look.",
  "Teh old church bell rang three times, then stopped, as if it had forgotten the rest.",
  "Margaret Ann laughed alot louder than she meant to, and the whole room turned to look.",
  "It was the kind of quiet that made you want to whisper even when you were alone.",
];
const t0 = Date.now();
const lap = (label: string, since: number) => console.log(`  ✓ ${label} (${((Date.now() - since) / 1000).toFixed(1)} s)`);

async function makeBook(): Promise<{ buf: Buffer; words: number }> {
  const kids: Paragraph[] = [new Paragraph({ style: "Title", children: [new TextRun("The Long Way Home")] })];
  let words = 0;
  for (let c = 1; c <= CHAPTERS; c++) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Chapter ${c}`)] }));
    for (let p = 0; p < PARAS; p++) {
      if (p === Math.floor(PARAS / 2)) { kids.push(new Paragraph({ children: [new TextRun("* * *")] })); continue; }
      const text = Array.from({ length: 4 }, (_, k) => SENT[(c * 7 + p * 3 + k) % SENT.length]).join(" ");
      words += text.split(/\s+/).length;
      kids.push(new Paragraph({ children: [new TextRun(text), new TextRun({ text: " Not again.", italics: true })] }));
      words += 2;
    }
  }
  return { buf: await Packer.toBuffer(new Document({ sections: [{ children: kids }] })), words };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const { buf, words } = await makeBook();
  const file = path.join(OUT, "The_Long_Way_Home.docx");
  await fs.writeFile(file, buf);
  console.log(`Manuscript: ${words.toLocaleString()} words, ${CHAPTERS} chapters, ${(buf.length / 1024).toFixed(0)} KB`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(300_000);

  let s = Date.now();
  await page.goto(`${BASE}/projects/new`);
  await page.getByLabel("Book title").fill(`The Long Way Home ${Date.now().toString().slice(-4)}`);
  await page.getByLabel("Author or pen name").fill("M. Shield");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create book project" }).click();
  await page.getByLabel("Manuscript file").waitFor({ state: "attached" });
  await page.getByLabel("Manuscript file").setInputFiles(file);
  await page.getByText(/Imported \d+ sections/).waitFor();
  lap(`imported (${await page.getByText(/Imported \d+ sections/).innerText()})`, s);

  s = Date.now();
  await page.reload();
  await page.getByRole("button", { name: "Start editing" }).click();
  await page.getByText("Editing pass finished.").waitFor();
  lap("editing job finished", s);

  s = Date.now();
  await page.getByRole("link", { name: "Review changes" }).first().click();
  await page.waitForURL(/\/review/);
  await page.getByRole("navigation", { name: "Chapters" }).waitFor();
  lap("review page opened", s);
  s = Date.now();
  const nav = page.getByRole("navigation", { name: "Chapters" }).getByRole("button");
  const n = await nav.count();
  for (let i = 0; i < n; i++) {
    await nav.nth(i).click();
    await page.waitForTimeout(150);
    const approveAll = page.getByRole("button", { name: "Approve all in chapter" });
    if (await approveAll.isEnabled()) {
      await approveAll.click();
      await page.getByRole("button", { name: "Yes" }).click();
      await page.waitForTimeout(300);
    }
  }
  await page.reload();
  await page.getByText("All suggestions resolved").waitFor({ timeout: 30_000 });
  lap(`approved all suggestions in ${n} sections`, s);

  s = Date.now();
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Approve manuscript" }).click();
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await page.getByText(/approved and frozen/).waitFor();
  lap("manuscript approved", s);

  s = Date.now();
  await page.reload();
  await page.getByRole("button", { name: "Generate approved manuscript (.docx)" }).click();
  await page.getByText(/Your file is ready/).waitFor();
  lap("approved DOCX generated", s);

  const pid = page.url().split("/projects/")[1].split(/[/?]/)[0];
  s = Date.now();
  await page.goto(`${BASE}/projects/${pid}/publish`);
  await page.getByText(/\d+ pages ·/).waitFor();
  lap(`print preview laid out (${await page.getByText(/\d+ pages ·/).first().innerText()})`, s);
  for (const name of ["Paperback interior (PDF)", "Kindle ebook (EPUB)", "Kindle ebook (Word)"]) {
    s = Date.now();
    const card = page.locator("div.rounded-lg", { has: page.getByRole("heading", { name }) });
    await card.getByRole("button", { name: /Create file|Create again/ }).click();
    await card.getByText(/was created|is ready|failed verification|went wrong|couldn't/i).waitFor();
    const failed = await card.getByText(/failed verification|went wrong|couldn't/i).count();
    if (failed) { await page.screenshot({ path: path.join(OUT, "fail.png"), fullPage: true }); throw new Error(`${name} failed`); }
    lap(`${name} created`, s);
  }
  await page.reload();
  await page.screenshot({ path: path.join(OUT, "publish.png"), fullPage: true });
  const failedChecks = await page.getByText(/^Failed$/).count();
  console.log(`  readiness: ${failedChecks} failed checks shown`);
  await browser.close();
  console.log(`Long-book run passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
