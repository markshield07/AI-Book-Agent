# Architecture and key decisions

## Core invariant: the author's text is never overwritten

Imported paragraphs (`Paragraph.text` + inline `marks`) are written once and never updated. Every other view is computed:

- **Original view** = paragraphs as imported.
- **Accepted view / exports** = `applyEdits(paragraph, acceptedSuggestions)` (`src/lib/doc/assemble.ts`), a pure, deterministic function that refuses overlapping edits and maps italics/bold through replacements.

Approving, rejecting, modifying, undoing and restoring only change `Suggestion.status` / `authorText` and append `Decision` rows, so every state is replayable and auditable. A `ManuscriptVersion` freezes the decision map plus the assembled text at a point in time (on upload, approval, draft download, restore). Exports reference the exact version they were built from.

## Suggestions are anchored, validated, and minimal

The model returns structured JSON (Claude structured outputs + zod re-validation): paragraph ref, exact original text, replacement, category, explanation, severity, confidence, and whether it adds new material. `src/lib/editor/validate.ts` then:

1. Requires the original text to occur exactly once in the referenced paragraph.
2. Narrows the edit to the words that actually change (so the review UI shows tight, readable changes).
3. Rejects edits that touch protected terms, exceed the scope of the editing mode, delete long passages, duplicate other paragraphs, overlap accepted or pending edits, or repeat a change the author already rejected.

Discarded suggestions are logged with reasons, never shown.

## Long manuscripts: durable jobs with chapter checkpoints

`Job` + `JobStep` (one analysis step, then one step per chapter) live in the database (SQLite file, WAL mode). Workers claim jobs with a compare-and-set update (only one worker's `updateMany` matches the job's current status and lock time) and keep a heartbeat; a job whose worker died is reclaimed after 10 minutes and resumes from the first unfinished chapter. Each step retries up to 3 times with exponential backoff (on top of the SDK's own 429/5xx retries); non-retryable errors (bad API key, refusal) fail fast with a plain-language message. Cancelling is checked between chunks. Progress shown to the author is the real step count, and token usage is recorded per step and job.

Chapters are split into ~2,500-word chunks at paragraph boundaries. Each request carries the style sheet, a continuity reference built by the analysis step (characters, locations, terms, events, observed voice/POV/tense), and the author's earlier rejections for that chapter.

**Why SQLite, and no Redis for the queue?** Nothing to install or keep running for a single author on their own computer, transactional consistency between job state and suggestions, and backups are a file copy. The schema avoids Postgres-only features, so switching `provider` to `postgresql` for a hosted multi-user version is a small change. The `claimJob`/`runJob` boundary is small, so moving to BullMQ/Redis later is contained.

## AI provider layer

`EditorProvider` (`src/lib/ai/types.ts`) has two methods: `analyze` and `editChunk`. Three implementations:

- `ClaudeCodeEditor` (default): runs `claude -p --output-format json --json-schema …` with tools, MCP servers and settings disabled, in an empty temp directory, with API-key variables stripped from its environment. It uses the author's Claude subscription. Usage-limit errors are retryable, so a job resumes from its last checkpoint after the limit resets.
- `AnthropicEditor` (optional, API key): the official SDK with streaming, adaptive thinking, configurable effort, server-side refusal fallback, and JSON-schema structured output. The model id is an environment variable. Manuscript text is wrapped in `<manuscript>` tags and the system prompt instructs the model to treat it as data, not instructions.

Separate prompts per editing mode (proofread, copyedit, line edit, developmental) share one editorial philosophy: preserve voice and dialect, never invent plot or facts, distinguish mistakes from style. Developmental review returns notes, not text edits. Continuity concerns become reviewable notes labelled possible / likely / confirmed.

## Storage and privacy

Originals and exports are stored under random 48-hex-character keys outside the web root (`STORAGE_DIR`) with `0600` permissions and write-once semantics, and are only served through route handlers that check project ownership. Every project/suggestion/chapter lookup goes through owner-scoped helpers (`src/lib/projects.ts`). Swap `src/lib/storage.ts` for an S3-compatible implementation (with server-side encryption) for hosted deployments.

## Single-author mode

Per the owner's request, sign-in is disabled (`src/lib/auth.ts` returns one owner user). The schema and every query remain per-user, so re-enabling accounts means adding session handling to `currentUser()` and the login pages back. Do not expose single-author mode publicly.

## Export

`src/lib/export/docx.ts` builds the manuscript with explicit Word styles (Body Text with 0.5" first-line indent, First Paragraph with no indent after headings/scene breaks, centred Scene Break, Chapter Title starting on a new page, Times New Roman 12 pt double-spaced, running header and page numbers). No manual spaces or tabs are inserted. After building, the file is re-opened and checked: every chapter title and paragraph present once and in order, no duplicates, no change markup. A file that fails verification is not saved. Final exports require an approved version; drafts are labelled as drafts and do not apply pending edits.

## Publishing (Phase 2)

All publishing code is in `src/lib/publish/`. Editing and formatting are separate: publishing reads a frozen approved version (or, for previews only, the current draft with accepted edits) and never writes manuscript text.

- **Publication model** (`book.ts`): approved chapters plus author-supplied front/back matter as ordered sections of semantic blocks (paragraph, first paragraph, scene break, subheading, block quote, display line). Print, ebook and Kindle DOCX are all built from this one model, so they contain the same words in the same order. Book details are never generated; an empty field leaves its page out. The untitled text before the first heading (usually the author's own title page) is excluded by default and can be switched back on.
- **KDP registry** (`kdp.ts`): trim sizes, bleed (+0.125" width, +0.25" height), page-count limits by trim/ink/paper, the inside-margin table by page count, minimum outside margins (0.25", or 0.375" with bleed). Sources are linked in the file.
- **Templates** (`templates.ts`): fonts, sizes, leading, indents, heading styles, scene-break ornament, running-head style. Presentation only.
- **Layout engine** (`layout.ts`): measures text with the real font files (fontkit), breaks lines greedily with justification (spaces may tighten to 80%) and Liang hyphenation (`hyphen`, English only; max two hyphenated lines in a row), keeps at least two lines of a paragraph on each side of a page turn, keeps subheadings and scene breaks with what follows, sinks chapter openers, adds blank versos where a section must start on a right-hand page, roman front matter and arabic numbering from 1 on a right-hand page, running heads (none on openers, display or blank pages). **Reflow loop:** lay out, count pages, look up KDP's inside margin for that count, re-lay out with it; the margin only grows, so it terminates; if the starting estimate overshot a bracket, the smaller margin is tried once and kept only if it still complies. A final pass fills real page numbers into the table of contents (its space is reserved, so the page count can't change).
- **PDF** (`pdf.ts`): pdfkit, one page per page at the exact trim (+ bleed), fonts embedded as subsets, no outline, annotations, forms, encryption or crop marks; only title/author metadata.
- **EPUB** (`epub.ts`): EPUB 3 built with JSZip (mimetype stored first), one XHTML file per section, `nav.xhtml` with landmarks plus `toc.ncx`, em-based CSS, `<em>`/`<strong>`/`<br/>`, no page numbers, stable `urn:uuid` (or `urn:isbn` when the author gives an ebook ISBN). `validateEpub` checks the package, XML well-formedness, metadata, manifest/spine, navigation, every internal link and anchor, empty chapters, leftover artifacts and that every word is present. `epubcheck.ts` runs W3C EPUBCheck when Java and the jar are available, otherwise reports "Not checked".
- **Kindle DOCX** (`kindle-docx.ts`): Word styles, chapters as Heading 1 with page breaks (KDP and Kindle Create build the TOC from them), no headers/footers/page numbers. KPF is not generated; the Publish tab explains how to make one in Kindle Create.
- **Readiness checker** (`paperback-check.ts`, plus the EPUB/DOCX checks): re-opens the PDF with pdf-lib for structure, page sizes, embedded fonts, bookmarks/annotations and metadata, and reads the layout for gutter, safe margins, clipping, missing glyphs, minimum font size, pagination parity, blank pages and word placement. Results are Passed / Warning / Failed / Not checked. A file whose structure or word count is wrong is never saved; a file that is merely not KDP-ready (e.g. under 24 pages) is saved but marked "Not ready".
- **Preview**: `/api/projects/[id]/publish/preview` returns a page range from the same layout (cached in memory per settings + text hash); the browser draws the pages as SVG with the same bundled fonts (`/api/fonts/[family]/[style]`, allowlisted). The Kindle preview renders the publication model with React elements; no HTML from the manuscript is ever injected.
