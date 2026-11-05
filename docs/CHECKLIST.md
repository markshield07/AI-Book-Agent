# Development checklist

Status as of Phase 2. "Working" means implemented and covered by automated tests (unit/integration in `tests/unit`, browser flow in `tests/e2e`). Spec section numbers refer to the master development prompt.

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
| Paperback interior PDF (§11, §12) | Every KDP trim size (6 × 9 default), black-and-white / standard / premium color, white / cream / groundwood paper, bleed, mirrored margins, inside margin recalculated from the final page count (reflow loop), professional page numbering (roman front matter, arabic from 1 on a right-hand page), chapter start on next or right-hand page, running heads, widow/orphan control, hyphenation and justification, scene breaks, blank pages only where structurally needed, embedded fonts, no crop marks/annotations/bookmarks. `Title_Paperback_6x9.pdf`. |
| Kindle ebook (§13) | Reflowable EPUB 3 with semantic chapters, navigable TOC (nav + NCX), inline contents page, em-based CSS, italics/bold, scene breaks, line breaks, metadata, no print page numbers. Built-in validation plus W3C EPUBCheck (CI always; locally when installed). KDP-compatible DOCX (Heading 1 chapters, no headers/footers). KPF: instructions for Kindle Create only. |
| Templates (§14) | Classic Novel, Modern Fiction, Literary Fiction, Nonfiction (sans headings, block quotes, chapter-title running heads), Memoir. Open-license embeddable fonts. Templates never change the text. |
| Front and back matter (§15) | Half-title, title page, copyright page, dedication, epigraph, table of contents, about the author, also by, series, website; imported foreword/preface/acknowledgments kept. Nothing invented: empty fields leave the page out. Imported sections can be included or excluded. |
| Live previewer (§16) | Print: real pages from the actual layout, facing spreads, chapter openings, page numbers, running heads, margin/gutter guides, total pages, jump to page/chapter, arrow keys. Kindle: phone/tablet/e-reader frames, text-size slider, labelled as an app preview. |
| Final export workflow (§17) | Publishing files only from the approved version; layout, details and validation stored with each file; previews allowed on drafts. |
| KDP readiness checker (§18) | Passed / Warning / Failed / Not checked for trim, dimensions, bleed, safe margins, gutter, page limits, font embedding, missing glyphs, minimum font size, pagination, blank pages, missing/duplicated pages, PDF structure, metadata; ebook package, navigation, links, metadata, markup, images, empty chapters, artifacts, words present. Links to Amazon's guidance and Kindle Previewer. |
| Version control (§19) | Versions on upload, approval, draft download and restore; compare any two (word diff); restore any earlier state (itself a new version, undoable); reopen editing; export history. |
| Privacy (§20) | Private storage, owner-scoped queries, AI-processing consent before first pass, no training on manuscripts, export all data as JSON, delete a book (removes files). |

## Changed from the spec by request

- **Authentication (§3, §20)**: removed for now at the owner's request; the app runs in single-author mode. Data model stays per-user.

## Not built yet

| Area | Phase |
| --- | --- |
| Hardcover interior (different KDP margins and limits) | 3 |
| Cover creation (KDP Cover Creator or a designer's file is needed) | Not planned |
| Clean reading PDF of the manuscript, formatting validation report as a separate download (§17) | 3 |
| Non-Latin scripts in print (all bundled fonts cover accented Latin; Greek and Cyrillic depend on the template; anything a font lacks, such as Chinese, is flagged by the readiness check) | 3 |
| Editorial chat assistant (§9) | 3 |
| RTF, PDF, EPUB import; OCR (§4) | 3 |
| Images carried through import/export | 3 |
| Editing chapter headings (titles are imported as-is) | 3 |
| In-app notification when a job finishes (progress updates live on the page today) | 3 |
| S3 storage, malware scanning, data-retention settings (§20) | Before any hosted deployment |
| Accounts, sharing, collaboration (§3, §24) | When needed |

## Known limitations

- The subscription editor (Claude Code) was smoke-tested live on a test passage (`tests/live-claude-code.ts`): it returned valid structured suggestions that passed validation and preserved dialect in dialogue. A full-length book has not been run yet.
- The API-key provider (`AI_PROVIDER=anthropic`) is implemented but has not been run live (no key was available).
- Import splits plain-text paragraphs heuristically (blank-line separated vs one-line-per-paragraph).
- Sign-in throttling, email and password reset were removed with accounts.
- Print layout uses greedy (first-fit) line breaking, not the whole-paragraph Knuth–Plass method, so an occasional line is looser than in professionally typeset books. Hyphenation is English only.
- Images, tables and footnotes from Word files are not imported yet, so they don't appear in the paperback or ebook.
- The Kindle preview is an approximation; Kindle devices use their own fonts and spacing. Always check in Kindle Previewer and KDP's print previewer.
