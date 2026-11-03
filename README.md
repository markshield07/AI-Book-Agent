# The Editorial Studio

AI-assisted book editing for authors: upload a manuscript, let **The Master Editor** propose edits, approve / reject / rewrite every change in a track-changes view, and download the approved manuscript as a Word document. Kindle EPUB and KDP paperback PDF output are Phase 2 (see [docs/CHECKLIST.md](docs/CHECKLIST.md)).

Nothing the AI suggests changes your text until you approve it. The original upload is stored unchanged and can always be downloaded.

## Quick start

Requirements: Node.js 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL and add ANTHROPIC_API_KEY
npx prisma migrate deploy       # create the database tables
npm run build
npm start                       # web app on http://localhost:3000 + background editing worker
```

For development, use `npm run dev` instead of `build` + `start`.

`npm start` / `npm run dev` start two processes: the Next.js web app and the **worker** (`src/worker/index.ts`), which runs editing jobs. If you deploy them separately, run `npm run worker` alongside the web server. Without a worker, editing jobs stay queued.

### Creating the database (local Postgres)

```bash
createuser -P studio            # password: studio (or change DATABASE_URL)
createdb -O studio editorial_studio
```

### AI configuration

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Enables the Claude-powered Master Editor. Get a key at console.anthropic.com. |
| `AI_MODEL` | Model id, default `claude-opus-5-5`. Change it to upgrade without code changes. |
| `AI_EFFORT` / `AI_ANALYSIS_EFFORT` | How hard the model thinks for chapter edits / whole-book analysis. |
| `AI_PROVIDER` | `anthropic` or `rules`. With no key, the app falls back to `rules`: a small, honest set of mechanical checks (doubled words, spacing, common misspellings), clearly labelled "Automatic checks" in the UI. |

Before the first AI pass, the app asks you to confirm that manuscript text will be sent to Anthropic's API.

## Single-author mode (no login)

The app currently has **no sign-in**; everything belongs to one owner account created automatically. Data is still stored per user, so accounts can be switched back on later. **Do not put it on a public URL as-is.** Anyone who can reach it can read your manuscripts. Run it locally, or behind a private network or host-level password (e.g. your hosting provider's access protection).

## Tests

```bash
createdb -O studio editorial_studio_test
DATABASE_URL=postgresql://studio:studio@localhost:5432/editorial_studio_test npx prisma migrate deploy
npm test                         # unit + database integration tests (uses the _test database)
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
