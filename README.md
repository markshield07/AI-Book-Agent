# The Editorial Studio

AI-assisted book editing for authors: upload a manuscript, let **The Master Editor** propose edits, approve / reject / rewrite every change in a track-changes view, and download the approved manuscript as a Word document. Kindle EPUB and KDP paperback PDF output are Phase 2 (see [docs/CHECKLIST.md](docs/CHECKLIST.md)).

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

## Single-author mode (no login)

The app currently has **no sign-in**; everything belongs to one owner account created automatically. Data is still stored per user, so accounts can be switched back on later. **Do not put it on a public URL as-is.** Anyone who can reach it can read your manuscripts. Run it locally, or behind a private network or host-level password (e.g. your hosting provider's access protection).

## Tests

```bash
npm test                         # unit + database integration tests (builds a throwaway prisma/test.db)
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

The e2e test creates a book, uploads a generated .docx (dialogue, slang, italics, scene breaks, Unicode), runs the editor, approves/rejects/modifies/undoes, bulk-resolves, approves the manuscript, downloads the approved DOCX and checks the file's actual contents.

## Project layout

```
prisma/schema.prisma        data model (projects, chapters, paragraphs, suggestions, decisions, jobs, versions, exports, audit)
src/lib/doc/                import (DOCX/TXT/MD), internal document model, deterministic edit assembly
src/lib/ai/                 provider layer: Claude implementation, offline rules, prompts, schemas
src/lib/editor/             ingest, job pipeline, suggestion validation, decisions/undo, versions, review data
src/lib/export/             approved/draft DOCX, export verification, editorial report
src/worker/                 background job worker
src/app/                    Next.js pages, server actions and API routes
docs/ARCHITECTURE.md        design decisions
docs/CHECKLIST.md           what works today vs what's unfinished
```
