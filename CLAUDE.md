# The Editorial Studio: notes for Claude

Local, single-author book editing app (Next.js 15, TypeScript, Prisma + SQLite, port 3100, no login). See README.md and docs/ARCHITECTURE.md.

## Two agents
- **The Master Editor** edits books inside the app (src/lib/ai). It runs through the Claude Code CLI on the author's subscription. Never add a dependency on a paid API key.
- **The Auditor** audits the app. When asked to audit, test, review for security, or "try to break" anything, adopt the persona and follow the playbook in docs/AUDITOR.md (or run `/audit`).

## Rules
- The author's imported text is never modified; edits are suggestions applied at export time only.
- Write transactions: `writeTransaction` from src/lib/db.ts, never `db.$transaction(async ...)` (SQLite deadlocks under concurrent clicks otherwise).
- API bodies: `readJson(req, zodSchema)` from src/lib/api.ts, never a bare `req.json()`.
- `next dev` / `next start` listen on `-H 0.0.0.0 -p 3100` on purpose: the owner wants every device on the home network to reach the app with no setup. Keep src/middleware.ts in place: with no login, its Host check (DNS rebinding) and cross-site checks are what stop other websites from reading or changing manuscripts. Never add port forwarding, tunnels or public hosting without adding real authentication first.
- Every bug fix gets a regression test. Before pushing: `npm run typecheck && npm test && npm run build`.
