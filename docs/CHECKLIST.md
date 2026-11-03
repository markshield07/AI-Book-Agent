# Development checklist

Status as of Phase 1. "Working" means implemented and covered by automated tests (unit/integration in `tests/unit`, browser flow in `tests/e2e`). Spec section numbers refer to the master development prompt.

## Working

| Area | Notes |
| --- | --- |
| Dashboard (§3) | Greeting, active / awaiting review / completed counts, recently edited, project cards (word count, chapters, status, modified date, review progress), search, status filter, sort, archive/unarchive, duplicate (copies manuscript, settings and decisions), rename via settings. |
| Project setup wizard (§5) | Title, pen name, genre, fiction/nonfiction, language, manuscript status, planned formats, editing mode + intensity, full style sheet incl. protected terms. Editable later. |
| Upload (§4) | DOCX (priority), TXT, Markdown, pasted text. Detects title, chapters (headings or "Chapter One"/"Prologue"/numbers), front/back matter, scene breaks, italics, bold, dialogue; reports word count and warnings (e.g. images not carried over). Corrupt, empty, binary and unsupported files are refused with a clear message. Original stored immutably and downloadable. |
| Partial manuscripts and adding chapters (§4) | Upload more chapters any time; existing decisions are kept. A changed version of an existing chapter is detected and the author chooses replace / add separately / keep old. |
| Editing modes and intensity (§6) | Proofread, copyedit, line edit, developmental (notes only); light / standard / intensive. Default standard copyediting. |
| Processing pipeline (§7) | Analysis → chapter-by-chapter editing → structured suggestions → validation → review → deterministic assembly. Real progress, retries, cancel, resume from checkpoint, stale-worker recovery, token usage, plain-language errors. |
| Review interface (§8) | Three panels; Original / Suggested / Accepted views; per-chapter counts; approve, reject, modify, back-to-pending; approve/reject all in chapter with confirmation; category filter; pending-only filter; find in chapter; undo (single or bulk); keyboard shortcuts; conflict protection for overlapping edits; read-only after approval. |
| Editorial notes and continuity (§10) | Analysis builds a per-project continuity reference (characters with spelling variants, locations, terms, events) shown on the overview and fed into every chapter request. Continuity concerns and developmental feedback appear as notes to resolve or dismiss. |
| Approval and approved DOCX export (§17) | Approval blocked until every edit and note is resolved; approved text is frozen as a version; final DOCX built only from that version and verified by re-reading the file. Draft DOCX available anytime, labelled as a draft. Editorial change report (DOCX) with AI-contribution summary for KDP disclosure. Clear filenames (`Book_Title_Approved_Manuscript.docx`). |
| Version control (§19) | Versions on upload, approval, draft download and restore; compare any two (word diff); restore any earlier state (itself a new version, undoable); reopen editing; export history. |
| Privacy (§20) | Private storage, owner-scoped queries, AI-processing consent before first pass, no training on manuscripts, export all data as JSON, delete a book (removes files). |

## Changed from the spec by request

- **Authentication (§3, §20)**: removed for now at the owner's request; the app runs in single-author mode. Data model stays per-user.

## Not built yet

| Area | Phase |
| --- | --- |
| KDP paperback interior PDF (trim sizes, page-count-dependent margins, reflow loop, font embedding) (§12) | 2 |
| Kindle EPUB export + EPUBCheck validation, KDP-compatible DOCX profile (§13) | 2 |
| Interior templates (§14), front/back matter editor (§15) | 2 |
| Print and Kindle previewer (§16), KDP readiness checker (§18) | 2 |
| Editorial chat assistant (§9) | 3 |
| RTF, PDF, EPUB import; OCR (§4) | 3 |
| Images carried through import/export | 3 |
| Editing chapter headings (titles are imported as-is) | 3 |
| In-app notification when a job finishes (progress updates live on the page today) | 3 |
| S3 storage, malware scanning, data-retention settings (§20) | Before any hosted deployment |
| Accounts, sharing, collaboration (§3, §24) | When needed |

## Known limitations

- The Claude integration is implemented against the current SDK and covered by schema/prompt tests, but has **not yet been run against the live API from this environment** (no API key was available). Run one short chapter with `ANTHROPIC_API_KEY` set before a full book.
- Import splits plain-text paragraphs heuristically (blank-line separated vs one-line-per-paragraph).
- Sign-in throttling, email and password reset were removed with accounts.
