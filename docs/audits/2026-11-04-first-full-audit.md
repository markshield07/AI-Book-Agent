# Audit 1: first full Auditor pass (2026-11-04)

**Scope:** the whole app at `7fe014a` (Phase 1 + the two earlier audit rounds), every API route, server action, upload path, the job worker boundary and dependencies.
**Method:** code review, then a live attack suite (`tests/security/attack-suite.ts`) and new adversarial unit tests run against the real app with `AI_PROVIDER=rules`.
**Before fixes:** 27 attack-suite checks failed. **After fixes:** all pass, 67 unit/integration tests pass (was 48), browser end-to-end workflow passes, `npm audit`: 0 vulnerabilities (was 5: 4 high, 1 moderate).

## Verdict: SHIP WITH NOTES
No critical or high issue remains open. Notes are listed under residual risks.

## Findings

| # | Severity | Finding | Fix | Proven by |
| --- | --- | --- | --- | --- |
| 1 | High | **Rapid clicks lock up the app.** Five or more decisions at the same moment (double-click, two tabs, bulk + undo) deadlocked SQLite inside Prisma: every request hung 30 s, then most failed with a 500. | `writeTransaction` (src/lib/db.ts) runs write transactions one at a time and takes the write lock first. All 8 interactive transactions switched to it. 8 simultaneous decisions: 30,132 ms with 5 failures → 81 ms, all succeed. | `tests/unit/concurrency.test.ts`; attack suite "Race conditions" |
| 2 | High | **Manuscripts readable from the local network.** `next start`/`next dev` listened on all interfaces (log showed a `Network:` URL). With no login, anyone on the same Wi-Fi could open or download every book. | Bind to `127.0.0.1` in `npm start` / `npm run dev`. | Startup log shows only `127.0.0.1:3100` |
| 3 | High | **DNS rebinding could read everything.** A request with a foreign `Host` (what a malicious site sees after re-pointing its domain at 127.0.0.1) got `200` from `/api/account/export`: all manuscripts, decisions and notes. | `src/middleware.ts` + `src/lib/security/request-guard.ts`: only local host names (plus opt-in `ALLOWED_HOSTS`) are answered; others get 421. | `tests/unit/security.test.ts`; attack suite raw-socket rebinding check |
| 4 | High | **Any website could change the book.** Cross-site POSTs (foreign `Origin`, `Origin: null`, `Sec-Fetch-Site: cross-site`) to undo and upload were accepted, e.g. a page planting text into a manuscript via upload. | Same guard refuses cross-site state-changing requests with 403; same-origin and local scripts still work. | unit + attack suite "Cross-site requests" (6 checks) |
| 5 | Medium | **Clickjacking / missing security headers.** Pages could be framed by another site (an invisible "Approve all"), and `X-Powered-By` advertised the framework. | `next.config.ts`: `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, nosniff, `Referrer-Policy: no-referrer`, COOP/CORP, `poweredByHeader: false`. | attack suite "Security headers" (8 checks) |
| 6 | Medium | **Malformed input crashed routes.** Broken JSON or a `null` body to the suggestion and bulk routes returned 500; replacement text had no length limit; types weren't checked before reaching the database layer. | `readJson(req, zodSchema)` in src/lib/api.ts; both routes use strict schemas (400 on any bad input; 100,000-char limit). | unit "JSON body validation"; attack suite "Malformed and hostile input" |
| 7 | Medium | **DOCX zip bombs.** A 319 KB .docx expanding to 320 MB would be fully unpacked by the Word parser (memory exhaustion / crash risk). | `checkDocxSize` reads the zip directory first and refuses anything over 300 MB unpacked or 5,000 entries. | unit "hostile uploads"; attack suite zip-bomb check |
| 8 | Medium | **Vulnerable dependencies.** 4 high + 1 moderate (`postcss` inside Next.js: file disclosure / XSS in CSS output; `deepmerge-ts` in the Prisma CLI: stack exhaustion). Build-time only and not reachable from the app's inputs, but they'd fail any enterprise gate. | `overrides` in package.json pin the patched versions without a breaking Next/Prisma upgrade. | `npm run audit:deps` (in CI) |
| 9 | Medium | **Regression caught by the new suite:** adding the request guard made Next.js cut request bodies to 10 MB, so legitimate 10-25 MB Word files (manuscripts with pictures) failed to upload. | `middlewareClientMaxBodySize: "30mb"` and the guard runs in the Edge runtime. | attack suite "legitimate 15 MB Word file uploads" |

## Checked and passing (no change needed)
- Unknown, traversal (`..%2F..`), NUL, SQL-looking and 500-char IDs on every download/job/review route → 404.
- Uploads stored under random keys; storage keys validated; download filenames can't inject headers (CR/LF and quotes stripped).
- Empty, executable, fake-DOCX and >25 MB uploads refused with a message; app stays up.
- Script and event-handler markup in a manuscript is rendered as text on the review page (no stored XSS).
- Claude Code runs with no tools, no MCP servers, no settings, in an empty temp directory, with API keys removed from its environment, so instructions hidden in a manuscript can only produce suggestions that still need approval.
- No secrets in git history (pattern scan); `.env`, databases and `storage/` are not tracked.
- Existing 48 tests and the browser end-to-end workflow still pass.

## Not tested in this audit
- A live Claude Code run (no subscription login in the audit environment; covered by `tests/live-claude-code.ts` on Mark's machine).
- 150,000-word performance run, phone-width layout and keyboard-only use of every page (next audit).
- Worker killed mid-job by hand (covered by existing unit tests for stale-job recovery, not re-run by hand).

## Residual risks
- The app still has no login. Its protection is "local only". Don't expose it on a network or the internet without adding authentication.
- The zip-bomb check trusts the sizes declared in the zip directory; a hand-crafted file that lies about them could still get past it. Low risk, since the only uploader is the author.
- `writeTransaction` serialises writes inside one web process. Running several web processes against one SQLite file would need the same protection at the database level.
