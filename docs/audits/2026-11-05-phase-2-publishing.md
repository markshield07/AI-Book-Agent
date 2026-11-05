# Audit 2: Phase 2 publishing (2026-11-05)

**Scope:** everything added for Phase 2 on top of `e1d8d02`: `src/lib/publish/*` (KDP registry, templates, settings, publication model, layout engine, PDF, EPUB, EPUBCheck runner, Kindle DOCX, readiness checks, service), the Publish tab and its components, four new API routes (`publishing`, `publish/preview`, `publish/ebook`, `fonts/[family]/[style]`), the `publishExportAction` server action, the `Project.publishing` migration, bundled fonts, and new dependencies (`pdfkit`, `pdf-lib`, `fontkit`, `fast-xml-parser`, `hyphen`).
**Method:** KDP numbers checked against Amazon's help pages (links in `src/lib/publish/kdp.ts`); unit and database tests; rendered PDFs inspected page by page as images; EPUBs run through W3C EPUBCheck 5.2.1; robustness runs (150,000 words in 300 chapters, a 300-character title, Unicode title with Chinese characters, a 200-character URL, empty chapters, tabs and runs of spaces); the live attack suite and the browser end-to-end test against the running app with `AI_PROVIDER=rules`.
**Result:** 91 unit/integration tests pass (was 67), attack suite 85 checks pass (18 new), browser end-to-end passes (17 new checks), `npm audit`: 0 vulnerabilities, production build clean.

## Verdict: SHIP WITH NOTES
No critical or high issue open. Every defect below was found while building or auditing this update and is fixed with a regression test.

## Findings (all fixed)

| # | Severity | Finding | Fix | Proven by |
| --- | --- | --- | --- | --- |
| 1 | High | **Text ran into the margin.** 58 lines in a 120,000-word book ended up to 3 pt past the text block: a paragraph's last line was allowed to fit with tightened spaces but then printed with normal spaces. | Any line wider than the measure is shrunk back to fit (`drawLine`). | "produces a PDF that passes the paperback readiness checks"; the checker's own "No clipped or overflowing lines" now passes on every template and trim |
| 2 | High | **Running heads and page numbers were drawn on the last page only**, so the PDF had none on normal pages and a pile of overprinted text at the end. | The finishing pass now draws onto each page it decorates. | "draws running heads and page numbers on their own page" |
| 3 | Medium | **Part pages were blank.** A "Part One" section has no body text, so nothing was printed on its page. | Part pages print their title. | same test (checks the part title on the page) |
| 4 | Medium | **Word-count checks gave false alarms** that would have blocked real exports: a word with italics in the middle counted as two in the EPUB check; the Kindle DOCX check read text with line breaks glued together; a URL split across lines counted differently. | Inline tags no longer split words in the count; the DOCX check counts from the HTML view; a split word is counted once, as written. | "counts a word with italics in the middle as one word"; "splits an over-long word (a URL)…" |
| 5 | Low | **EPUB "runs of spaces" warning fired on every book** (it was matching the file's own indentation). | The check only looks at text content. | EPUB test requires no warnings on the sample novel |

## Checked and passing
- **KDP rules** match Amazon's pages: 16 trim sizes, bleed +0.125"/+0.25", inside margin by page count (0.375" to 0.875"), outside margins 0.25" (0.375" with bleed), page limits for every trim/ink/paper row including the A4 standard-color gap.
- **Reflow loop**: starting from too small a gutter on a 170-page book, the engine re-lays out with 0.5"; starting too large, it settles back to the smallest margin that still complies. Final inside margin is always at least KDP's minimum for the final page count.
- **PDF**: exact page size on every page, all fonts embedded (subset), no bookmarks, annotations or forms, not encrypted, odd folios on right-hand pages, body starts at 1 on a right-hand page, never two blank pages in a row, every word placed (118,175 of 118,175 in the 120,000-word test book), widows/orphans: at least 2 lines either side of a page turn.
- **All five templates × 5×8 / 5.5×8.5 / 6×9, with and without bleed**: no readiness failures except the honest page-count failure for a short test text.
- **EPUB**: W3C EPUBCheck 5.2.1 reports no errors or warnings for the sample novel and the 120,000-word book; built-in checks catch a broken chapter link, missing title and compressed mimetype (tested). CI now installs EPUBCheck and requires a pass.
- **Honest reporting**: a 10-page book fails "Page count within KDP limits"; Chinese characters in a title fail "No missing characters" by name; EPUBCheck missing locally is "Not checked", never "Passed"; images and cover are "Not checked" with a reason.
- **Author text untouched**: publishing reads the approved snapshot only; imported paragraphs and the original upload are byte-identical afterwards (tested). Nothing is invented for copyright, ISBN, bio or publisher (tested).
- **Final files only from the approved version**: all three exports refuse a draft (tested); previews of drafts are labelled as drafts.
- **Security**: cross-site PUT to settings refused (403); malformed, wrong-type, oversized and `__proto__` bodies are 400 or harmlessly stripped; font route refuses traversal, `constructor` and `toString` (allowlist, no path from input); unknown and traversal project ids are 404 on all new routes; preview page range clamped to 40 pages; Kindle preview renders text with React elements (no `dangerouslySetInnerHTML`); exports stored under random keys and served with the right content type.
- **Performance**: 120,000 words lay out in about 0.3 s and render to PDF in about 0.5 s; 150,000 words in 300 chapters: 580 pages in about 2 s including PDF and EPUB.
- **Dependencies**: `fast-xml-parser` pinned to 5.12 (earlier versions have a critical advisory); all new packages MIT/BSD-style; fonts SIL OFL 1.1 with licence files.

## Not tested in this audit
- Uploading the files to KDP itself and Kindle Previewer (Amazon's tools need Mark's account and a desktop app). The readiness report links to both and says so.
- Phone-width layout of the Publish tab (desktop and laptop widths checked).
- EPUBCheck on Mark's Windows machine (optional; requires Java).

## Residual risks
- Line breaking is first-fit, not whole-paragraph optimisation: an occasional justified line is looser than professional typesetting. Readable, but a typographer would notice.
- Hyphenation is English only; other languages are justified without hyphens.
- KDP's numbers can change. They're in one file with source links; re-check before a big release.
