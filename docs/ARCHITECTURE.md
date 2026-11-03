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

`Job` + `JobStep` (one analysis step, then one step per chapter) live in Postgres. Workers claim jobs with `FOR UPDATE SKIP LOCKED` and keep a heartbeat; a job whose worker died is reclaimed after 10 minutes and resumes from the first unfinished chapter. Each step retries up to 3 times with exponential backoff (on top of the SDK's own 429/5xx retries); non-retryable errors (bad API key, refusal) fail fast with a plain-language message. Cancelling is checked between chunks. Progress shown to the author is the real step count, and token usage is recorded per step and job.

Chapters are split into ~2,500-word chunks at paragraph boundaries. Each request carries the style sheet, a continuity reference built by the analysis step (characters, locations, terms, events, observed voice/POV/tense), and the author's earlier rejections for that chapter.

**Why Postgres instead of Redis for the queue?** One fewer service to run for a single author, transactional consistency between job state and suggestions, and it already provides locking. The `claimJob`/`runJob` boundary is small, so moving to BullMQ/Redis later is contained.

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
