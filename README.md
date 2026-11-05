# The Editorial Studio

AI-assisted book editing and publishing for authors: upload a manuscript, let **The Master Editor** propose edits, approve / reject / rewrite every change in a track-changes view, then design and download the finished book: a print-ready **KDP paperback interior PDF**, a **Kindle EPUB** and a **Kindle-ready Word file**, each checked by a KDP readiness report. See [docs/CHECKLIST.md](docs/CHECKLIST.md) for what works today.

Nothing the AI suggests changes your text until you approve it. The original upload is stored unchanged and can always be downloaded.

## Quick start

Requirements: Node.js 20+. Nothing else to install: your books are stored in a database file inside the app folder (`prisma/studio.db`), and uploads and exports in `storage/`. Back up those two to back up everything.

```bash
npm install
cp .env.example .env            # Windows: copy .env.example .env
npx prisma migrate deploy       # create the database tables
npm run build
npm start                       # web app on http://localhost:3100 (change the port in package.json if 3100 is taken) + background editing worker
```

For development, use `npm run dev` instead of `build` + `start`.

`npm start` / `npm run dev` start two processes: the Next.js web app and the **worker** (`src/worker/index.ts`), which runs editing jobs. If you deploy them separately, run `npm run worker` alongside the web server. Without a worker, editing jobs stay queued.

### AI: use your Claude subscription (no API key)

The Master Editor runs through **Claude Code** on your computer, so it uses your Claude Pro/Max subscription and costs nothing extra.

1. Install Claude Code: `npm install -g @anthropic-ai/claude-code` (or see claude.com/claude-code).
2. Run `claude` once in a terminal, type `/login`, and sign in with your Claude account. You can close it afterwards.
3. Start the app. It detects Claude Code automatically; the book page says "Claude, using your Claude subscription".

The app removes any `ANTHROPIC_API_KEY` from Claude Code's environment, so editing never switches to pay-as-you-go billing.

**Usage limits:** editing counts toward your subscription's usage limits. A full novel can take more than one limit window. If the limit is reached, the job stops with a message, every finished chapter is kept, and **Resume** continues from where it stopped once the limit resets. Use `AI_MODEL=sonnet` to stretch your limits further.

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `claude-code` (default when Claude Code is installed), `anthropic` (API key, pay-as-you-go), or `rules` (offline mechanical checks only, clearly labelled "Automatic checks"). |
| `AI_MODEL` | `opus` (default), `sonnet`, `haiku`, or a full model id. |
| `AI_EFFORT` / `AI_ANALYSIS_EFFORT` | How hard the model thinks for chapter edits / whole-book analysis. |
| `CLAUDE_CLI` | Path to the `claude` command if it isn't on your PATH. |

Before the first AI pass, the app asks you to confirm that manuscript text will be sent to Claude. Whether Anthropic may use it to improve models follows your Claude account's privacy settings.

Quick check that it works: `npx tsx tests/live-claude-code.ts` edits one test sentence and prints the suggestions.

## Publishing (Kindle and paperback)

Open a book and choose the **Publish** tab.

- **Layout**: design template (Classic Novel, Modern Fiction, Literary Fiction, Nonfiction, Memoir), any KDP trim size (6 × 9 in by default), black-and-white or color ink, paper, bleed, chapter start, running headers, front-matter numbering, table of contents, and which imported sections to print.
- **Book details**: subtitle, copyright page, ISBNs, publisher, edition, dedication, epigraph, about the author, also-by, series and website. Nothing is ever made up: an empty field means that page is left out.
- **Paperback preview**: the real print layout (the same pages the PDF is drawn from) as facing spreads, with margin and gutter guides, page count and the KDP inside-margin requirement.
- **Kindle preview**: phone, tablet and e-reader frames with a text-size slider. It's an app preview; always check the final file in Amazon's free Kindle Previewer.
- **Create files** (after the manuscript is approved): `Title_Paperback_6x9.pdf`, `Title_Kindle.epub`, `Title_Kindle.docx`. Each comes with a readiness report (Passed / Warning / Failed / Not checked) and links to Amazon's official guidance.

The KDP rules (trim sizes, bleed, page-count limits, and the inside margin that grows with page count) live in `src/lib/publish/kdp.ts`, copied from Amazon's help pages. The layout engine lays the book out, works out the page count, applies the margin KDP requires for that count, and reflows until it fits.

Fonts: EB Garamond, Crimson Pro, Source Serif 4, Lora and Source Sans 3 are bundled in `assets/fonts` under the SIL Open Font License, which allows embedding in books you sell.

**Official EPUBCheck (optional, free).** The app always runs its own EPUB checks. To also run W3C's EPUBCheck, install Java and unzip [EPUBCheck](https://github.com/w3c/epubcheck/releases) into `tools/epubcheck/` (or set `EPUBCHECK_JAR` to the jar's path). Without it the report says "Not checked" for that line. The automatic gate on GitHub always runs EPUBCheck.

**Updating an existing install:** `npm install`, then `npm run build` and `npm start` as usual. `npm start` and `npm run dev` now apply database updates automatically (`prisma migrate deploy`).

## Single-author mode (no login)

The app currently has **no sign-in**; everything belongs to one owner account created automatically. Data is still stored per user, so accounts can be switched back on later. **Do not put it on a public URL as-is.** Anyone who can reach it can read your manuscripts. Run it locally, or behind a private network or host-level password (e.g. your hosting provider's access protection). To protect it, the app only listens on this computer (`127.0.0.1`), refuses requests addressed to any other host name (DNS-rebinding protection), and refuses changes coming from other websites (cross-site request protection). Open it at http://localhost:3100.

## The Auditor (QA and security)

A second agent, **The Auditor**, audits the app itself: a 30-year enterprise QA and security engineer whose job is to break it. See [docs/AUDITOR.md](docs/AUDITOR.md).

- **On every push** GitHub Actions runs the automatic gate (`.github/workflows/audit.yml`): type-check, all tests, dependency vulnerability scan, production build, the live attack suite, the browser end-to-end test, and a secret scan. A red X on a commit means don't ship it. Free tier, no API keys.
- **Full audit on request**: in Claude Code, type `/audit` (or "audit this update"). Claude follows the playbook, fixes what it finds with regression tests, and writes a report to `docs/audits/`.

Run the same gate locally:

```bash
npm run audit:all                # typecheck + tests + dependency audit + build
AI_PROVIDER=rules npm start &    # then, with the app running:
npm run test:attack              # tries to break the running app (CSRF, DNS rebinding, zip bombs, races, ...)
```

## Tests

```bash
npm test                         # unit + database integration + adversarial tests (builds a throwaway prisma/test.db)
```

Sample manuscripts for trying the app (a short novel with deliberate typos, dialect and continuity slips, as .docx, .txt and .md):

```bash
npx tsx tests/samples/make-samples.ts samples   # writes samples/lighthouse.docx, .txt, .md
```

Browser end-to-end test (needs the app running, plus Playwright: `npm i -D playwright && npx playwright install chromium`):

```bash
AI_PROVIDER=rules npm start &
npm run test:e2e                 # screenshots and the downloaded DOCX land in test-results/
```

The e2e test creates a book, uploads a generated .docx (dialogue, slang, italics, scene breaks, Unicode), runs the editor, approves/rejects/modifies/undoes, bulk-resolves, approves the manuscript, downloads the approved DOCX and checks the file's actual contents, then designs the book on the Publish tab, creates the paperback PDF, EPUB and Kindle DOCX, and checks the downloaded PDF's page size and the EPUB's text and italics.

## Project layout

```
prisma/schema.prisma        data model (projects, chapters, paragraphs, suggestions, decisions, jobs, versions, exports, audit)
src/lib/doc/                import (DOCX/TXT/MD), internal document model, deterministic edit assembly
src/lib/ai/                 provider layer: Claude implementation, offline rules, prompts, schemas
src/lib/editor/             ingest, job pipeline, suggestion validation, decisions/undo, versions, review data
src/lib/export/             approved/draft DOCX, export verification, editorial report
src/lib/publish/            KDP rules, templates, publishing settings, print layout engine, PDF, EPUB, Kindle DOCX, readiness checks
assets/fonts/               bundled OFL book fonts (embedded in PDFs)
src/worker/                 background job worker
src/app/                    Next.js pages, server actions and API routes
docs/ARCHITECTURE.md        design decisions
docs/CHECKLIST.md           what works today vs what's unfinished
```
