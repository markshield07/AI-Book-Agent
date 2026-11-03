// Browser test of the complete author workflow against a running app (default http://localhost:3100):
// create book -> upload DOCX -> run editor -> approve/reject/modify/undo -> bulk -> approve
// manuscript -> download approved DOCX -> verify the downloaded file's contents.
import { chromium } from "playwright";
import mammoth from "mammoth";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fixtureDocx } from "./make-fixture";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const OUT = process.env.E2E_OUT || "test-results";

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`E2E check failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const fixture = path.join(OUT, "Southside_Summer.docx");
  await fs.writeFile(fixture, await fixtureDocx());
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const shot = (n: string) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: false });

  await page.goto(`${BASE}/dashboard`);
  await shot("01-dashboard");
  await page.getByRole("link", { name: "+ Create new book" }).click();
  const title = `Southside Summer ${Date.now().toString().slice(-5)}`;
  await page.getByLabel("Book title").fill(title);
  await page.getByLabel("Author or pen name").fill("D. Rivers");
  await page.getByLabel("Genre").fill("Urban fiction");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Editing level").selectOption("PROOFREAD");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Words and phrases that must never change").fill("Wabash");
  await shot("02-wizard-style");
  await page.getByRole("button", { name: "Create book project" }).click();
  await page.getByRole("heading", { name: title }).waitFor({ timeout: 15000 });
  check(!page.url().endsWith("/projects/new"), "project created");

  await page.getByLabel("Manuscript file").setInputFiles(fixture);
  await page.getByText(/Imported 2 sections/).waitFor({ timeout: 30000 });
  check(true, "DOCX imported with 2 chapters");
  check(await page.getByText(/1 scene break/).isVisible(), "scene break detected");
  check(await page.getByText(/Title found: “Southside Summer”/).isVisible(), "title detected");
  await shot("03-uploaded");

  // a corrupt file is refused with a clear message
  await fs.writeFile(path.join(OUT, "broken.docx"), "not really a word file");
  await page.getByLabel("Manuscript file").setInputFiles(path.join(OUT, "broken.docx"));
  await page.getByText(/isn't a valid Word document/).waitFor();
  check(true, "corrupt upload rejected with explanation");

  await page.reload();
  await page.getByRole("button", { name: "Start editing" }).click();
  await page.getByText("Your manuscript is ready for review.").waitFor({ timeout: 120000 });
  check(true, "editing job finished with real progress");
  await page.reload();
  await shot("04-job-done");

  await page.getByRole("link", { name: "Review changes" }).first().click();
  await page.waitForURL(/\/review/);
  await page.getByRole("button", { name: "Start with the first change" }).click();
  await shot("05-review");
  const panel = page.getByRole("complementary", { name: "Editorial explanation" });
  check(await panel.getByText("Why").isVisible(), "explanation panel shows the change");

  await panel.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Change approved").waitFor();
  await panel.getByRole("button", { name: "Reject" }).click();
  await page.getByText("Change rejected").waitFor();
  await panel.getByRole("button", { name: "Modify" }).click();
  await page.getByLabel("Your replacement").fill("the");
  await panel.getByRole("button", { name: "Save my version" }).click();
  await page.getByText("Your version saved").waitFor();
  check(true, "approve, reject and modify persisted");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText(/Undid 1 decision/).waitFor();
  check(true, "undo restored the last decision");
  await page.reload();
  check((await page.locator(".chg.accepted").count()) >= 1, "decisions survive a page refresh");

  await page.getByRole("tab", { name: "Original" }).click();
  check(await page.getByText("He saw the the dog , and i ran").isVisible(), "original view shows untouched text");
  await page.getByRole("tab", { name: "Suggested changes" }).click();

  for (const chapter of ["Chapter One", "Chapter Two"]) {
    await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: new RegExp(chapter) }).click();
    await page.waitForTimeout(400);
    const approveAll = page.getByRole("button", { name: "Approve all in chapter" });
    if (await approveAll.isEnabled()) {
      await approveAll.click();
      await page.getByRole("button", { name: "Yes" }).click();
      await page.getByText(/approved/).first().waitFor();
    }
    const rejectAll = page.getByRole("button", { name: "Reject all in chapter" });
    if (await rejectAll.isEnabled()) {
      await rejectAll.click();
      await page.getByRole("button", { name: "Yes" }).click();
      await page.waitForTimeout(500);
    }
  }
  await page.getByText("All suggestions resolved").waitFor();
  check(true, "bulk actions resolved every suggestion");
  await page.getByRole("tab", { name: "Accepted changes" }).click();
  await shot("06-accepted-view");
  check(await page.getByText(/Teh sky|Teh/).count() === 0, "accepted view applies approved edits");

  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Approve manuscript" }).click();
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await page.getByText(/approved and frozen/).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Generate approved manuscript (.docx)" }).click();
  await page.getByText(/Your file is ready/).waitFor({ timeout: 30000 });
  await page.reload();
  await shot("07-exported");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /_Approved_Manuscript\.docx$/ }).first().click()]);
  const file = path.join(OUT, download.suggestedFilename());
  await download.saveAs(file);
  check(/_Approved_Manuscript\.docx$/.test(download.suggestedFilename()), `downloaded ${download.suggestedFilename()}`);
  const raw = (await mammoth.extractRawText({ path: file })).value;
  check(raw.includes("The sky was gray over the Wabash bridge."), "approved edit present in exported file");
  check(raw.includes("could of told me"), "dialect in dialogue preserved");
  check(raw.includes("café on 47th") && raw.includes("Zoë"), "Unicode preserved");
  check(!raw.includes("Teh sky"), "no unapproved original typo left where edit was approved");
  check(raw.split("Nobody believed it.").length === 2, "no duplicated paragraphs");
  const html = (await mammoth.convertToHtml({ path: file })).value;
  check(/<em>Wabash<\/em>/.test(html) && /<em>Not today,<\/em>/.test(html), "italics preserved in export");

  await page.goto(`${BASE}/projects/${page.url().split("/projects/")[1].split(/[/?]/)[0]}/versions`);
  check(await page.getByText(/Approved manuscript/).first().isVisible(), "version history lists the approved version");
  await shot("08-versions");
  await page.goto(`${BASE}/projects/does-not-exist`);
  check(await page.getByText("We couldn't find that book.").isVisible(), "unknown project returns not found");
  await browser.close();
  console.log("E2E workflow passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
