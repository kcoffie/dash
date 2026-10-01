# Project Handoff — Security Audit Platform

**Last updated:** 2026-10-01 (end of session 4)
**Branch:** `main` @ `9116ed3` — everything merged (PRs #2–#7), no open PRs, no other branches
**Status:** Week 1 scanners ✅ (deps, secrets, SQLi, XSS) · CI gate ✅ · Week 2 Dashboard Core ✅ (PR #7) · repo public, `main` protected
**Next step:** Task #5 — Dashboard Polish (dark mode, severity chart, responsive refinements) on a new branch `feature/dashboard-polish`

---

## ▶ START HERE (Next Agent)

### Where we are
The core loop works end to end: `npm run scan <repo>` → `scanner-output.json` → React dashboard (`npm run dev`). Scanners for dependency CVEs, hardcoded secrets, SQL injection, and XSS are merged and validated against OWASP Juice Shop + DVNA answer keys. The dashboard core (summary cards, coverage report, search/filters, expandable findings with "why this severity") is merged (PR #7). CI (`test` job: `npm ci` → `npm test` → `npm run build`) must pass before anything merges to `main`. Crypto (#2.4) and async (#2.5) scanners are deferred until after the dashboard and deploy (user's call).

### Do these, in order
1. **Setup**
   ```bash
   git checkout main && git pull
   npm ci                                   # node_modules isn't committed; needed for dev/build
   # Scan targets live outside the repo — re-clone if /tmp was wiped:
   git clone --depth 1 https://github.com/expressjs/express.git /tmp/express
   git clone --depth 1 https://github.com/juice-shop/juice-shop.git /tmp/juice-shop
   git clone --depth 1 https://github.com/appsecco/dvna.git /tmp/dvna
   ```
   `npm ci` warns that esbuild's install script wasn't approved — harmless (the build works; CI is green).
2. **Verify baseline**
   ```bash
   npm test                                 # 5 suites: dependency 3/3, secrets 5/5, SQLi 21/21, XSS 22/22, dashboard helpers 10/10
   npm run build                            # must succeed (CI runs it)
   ```
   Scanner counts (run from a scratch dir — `index.js` writes `scanner-output.json` to the cwd):
   Juice Shop 13 SQLi / 19 XSS / 138 total · DVNA 1 SQLi / 10 XSS · Express 0 SQLi / 54 XSS (all low).
3. **See the dashboard**: from the repo root, `npm run scan /tmp/juice-shop` (writes the gitignored `scanner-output.json` the dev server serves), then `npm run dev` → http://localhost:5173. "Load scan file…" loads any other report.
4. **Task #5: Dashboard Polish** — new branch `feature/dashboard-polish`, PR when done. DOD (STATUS.md / PRD.md Req 5):
   - **Dark mode** — the PRD's "bonus" item. Tailwind v4 is set up via `@import "tailwindcss"` in `src/index.css` (no `tailwind.config.js` — v4 doesn't use it). Follow the system preference with `dark:` variants; severity colors in `src/components/SeverityBadge.jsx` (`SEVERITY_STYLES`) and `SummaryCards.jsx` need dark counterparts. Keep contrast readable.
   - **Severity / type chart** — STATUS.md says "pie chart"; consider a horizontal bar per severity or per type instead (easier to compare). Load the `dataviz` skill before writing chart code. Prefer no new heavy dependency (plain SVG/CSS is fine).
   - **Responsive refinements** — the 5th summary card ("Info", usually 0) sits alone on phones; consider hiding zero-count cards or a 3-col layout.
   - Put any new logic in `src/utils/findings.js` with tests in `src/utils/__tests__/findings.test.js`.
5. **Then Week 3: Deploy (Task #6)** — Vercel. Blocked on committed demo data (see Open TODOs: "Deploy needs committed demo data"). Ask the user which scan to publish.
6. **Later:** fix the scanner TODOs (secret ids, `@undefined` dep versions, secret context factors, ESLint config), then #2.4 crypto / #2.5 async.

### Dashboard map (Task #4, merged)
- `src/App.jsx` — loads `/scanner-output.json`; a non-JSON response means "no report" (Vite and static hosts answer missing files with `index.html` + 200). File picker via `normalizeReport()`.
- `src/pages/Dashboard.jsx` — sorts once, assigns stable row keys on the unfiltered list (so expanded rows survive filtering), filters, composes components.
- `src/components/` — `SummaryCards` (click = severity filter), `CoverageReport` (`coverage.checked` / `notYetChecked` / `errors`), `FilterBar`, `FindingsTable` (expand/collapse, responsive columns), `FindingDetails` (snippet, ✓/⚠/? factors, fix, links — only `http(s)` URLs are linked), `SeverityBadge`.
- `src/utils/findings.js` — filter/search/sort/count, `parseFactor`, `findingKey` (scanner ids aren't unique), `isSafeUrl`, `CATEGORY_TYPES`.
- Manual-testing tips: Claude-in-Chrome's `resize_window` didn't change the viewport here — test phone width by injecting `<iframe src="/" style="width:390px">` via the JS tool. Close tabs and stop the dev server when done.

### Working agreements with the user
- **Commit and push right away** after each logical chunk — user wants to be aggressive about pushing so no work is lost.
- Commit style: separate `feat:` / `test:` / `docs:` commits, task ref like `(#2)` (these are plan task numbers — there are no GitHub issues, so don't write `Closes #N`). Never commit `.obsidian/workspace.json`.
- **No `Co-Authored-By:` or other AI attribution lines** in commits (or PR descriptions). History was rewritten once to remove them.
- Work on a branch, open PRs with the CONTRIBUTING.md template, **squash merge only when the user says so**. Delete merged branches. `main` is protected — direct pushes and force pushes are rejected.
- **The repo is public** (since 2026-10-01). Commits in this repo use the GitHub noreply email (`git config user.email` is set locally); don't put personal info in commits, docs, or PRs.
- Track limitations as checkboxes in **Open TODOs** below, and check them off when fixed — user wants limitations visible until they're gone.
- Confirm a new test actually fails against the old code before calling a fix done.

---

## What We Did in Session 4 (2026-10-01)

- ✅ **Route-handler detection** — `ROUTE_HANDLER` (now in `file-utils.js`) also matches `(req, res` signatures incl. typed `(req: Request, res: Response) =>`. Juice Shop `login.ts:34` and DVNA `appHandler.js:10` → CRITICAL.
- ✅ **XSS scanner** (`src/scanner/patterns/xss.js`, 22 tests) — Angular `bypassSecurityTrust*`, React `dangerouslySetInnerHTML`, `innerHTML`, `document.write`/`insertAdjacentHTML`/jQuery `.html()`, unescaped template output (EJS/Handlebars/Pug/Vue), `res.send()` of HTML or raw `req.*`. Recall: Juice Shop 8/9 challenges, DVNA 3/3 (answer key below).
- ✅ **Non-production code capped at LOW** (user decision) — training snippets (`codefixes/`, `snippets/`, `fixtures/`) and test/example files, in both SQLi and XSS, via `nonProductionContext()`.
- ✅ `*.min.js` skipped by all scanners; shared `USER_INPUT` in `file-utils.js`.
- ✅ **PR #2 squash-merged** to `main` (`488951c`); `feature/scanner-patterns`, `feature/scanner-deps`, and the rewrite backup branch deleted.
- ✅ **Housekeeping** — `Co-Authored-By` lines stripped from branch history (user request); stale Finder duplicates (`* 2.js`) deleted and `* 2.*` added to `.gitignore`; status docs updated (PR #3).
- ✅ **CI test gate** (PR #4) — `npm test` (Node built-in runner over every `*.test.js`) + GitHub Actions `test` job on PRs/pushes to `main`. Verified a failing suite fails the run.
- ✅ **Repo made public** after a full-history audit (32 commits): no secrets, no `.env` / `scanner-output.json` ever committed; only fake test fixtures. Personal Gmail stays in old commit metadata (user's choice); new commits use the GitHub noreply email. `main` ruleset now enforced: PR required (0 approvals, squash only), `test` check required, no force pushes or deletion.
- ✅ **Dashboard Core (Task #4, PR #7)** — summary cards, coverage report, search + severity/type filters, expandable rows explaining severity, responsive; tested logic in `src/utils/findings.js`. Fixed along the way: Tailwind v3/v4 mismatch (no styles were generated), scanner coverage claiming 9 checked categories when only 4 exist (`notYetChecked` added), Vite's index.html fallback breaking the empty state. CI now also runs `npm ci` + `npm run build`.

## What We Did in Session 3 (2026-09-30)

- ✅ **SQL injection scanner** (`src/scanner/patterns/sql-injection.js`)
  - Detects SQL built via string concatenation (`'SELECT … ' + id`) and template literal interpolation (`` `… ${id}` ``)
  - Only flags strings that look like SQL: uppercase keywords anywhere, lowercase only when the string starts with them (avoids `'Please select an option from '`)
  - Context factors adjust severity (base MEDIUM): user input `req.*` (↑), used directly in a route handler (↑ to CRITICAL), escaping / `parseInt` nearby (↓), constant value like `${PAGE_SIZE}` (→ LOW), test/example file (confidence ↓), placeholders present (noted as partially parameterized)
  - Remediation shows before/after parameterized query + OWASP links
- ✅ **Multi-line queries** — `toStatements()` in `src/scanner/file-utils.js` joins lines continued by `+` or an open template literal (max 20 lines) before matching
- ✅ **Shared helpers** — `src/scanner/file-utils.js`: `walkDir`, `shouldSkipFile`, `isSourceFile`, `isTestOrExampleFile`, `toStatements`. Secrets scanner refactored to use them (no behavior change)
- ✅ **Tests** — `src/scanner/__tests__/sql-injection.test.js`, 17/17 passing (detection, false positives, severity adjustments, multi-line)
- ✅ **Second scan targets** — OWASP Juice Shop + DVNA (intentionally vulnerable → known answer key). **SQLi recall 3/3**, safe static query not flagged, Juice Shop's "correct fix" files not flagged
- ✅ Express.js still scans clean for SQLi (it has no SQL) — useful false-positive check (`express.raw()`, supertest `.query('/')` not flagged)

### Scan results snapshot

| Target | Dependency CVEs | Secrets | SQL injection | XSS |
|---|---|---|---|---|
| Express (`/tmp/express`) | 4 | 1 | 0 (correct — no SQL) | 54 (all low — all in `test/` + `examples/`) |
| Juice Shop (`/tmp/juice-shop`) | 65 | 41 (noisy) | 13 (1 critical, 1 high + 11 low snippets) | 19 (5 high, 8 medium + 6 low snippets) |
| DVNA (`/tmp/dvna`) | 0 | 0 | 1 (critical) | 10 (medium) |

### XSS answer key + recall (session 4)

Juice Shop marks real vulnerable lines with `// vuln-code-snippet vuln-line <challenge>`; the rest were traced from `data/static/challenges.yml` (9 XSS challenges). DVNA's are listed in `docs/solution/a7-xss.md`.

| Challenge | Sink | Found | Severity |
|---|---|---|---|
| DOM XSS + Bonus Payload | `frontend/src/app/search-result/search-result.component.ts:144` | ✅ | high |
| API-only XSS | `search-result.component.ts:111` | ✅ | high |
| Reflected XSS | `frontend/src/app/track-result/track-result.component.ts:49` | ✅ | high |
| HTTP-Header XSS | `frontend/src/app/last-login-ip/last-login-ip.component.ts:40` | ✅ | high |
| Client-side XSS Protection | `frontend/src/app/administration/administration.component.ts:74` | ✅ | medium |
| Server-side XSS Protection | `frontend/src/app/about/about.component.ts:120` (+ `administration.component.ts:92`) | ✅ | medium |
| Video XSS | `routes/videoHandler.ts:72` (`res.send` of HTML built from `subs` on :71) | ✅ | medium |
| CSP Bypass | `routes/userProfile.ts:73` (username spliced into a Pug template, then `pug.compile`) | ❌ | — |
| DVNA reflected search | `views/app/products.ejs:20` | ✅ | medium |
| DVNA stored products | `views/app/products.ejs:49-53` | ✅ | medium |
| DVNA DOM (admin users) | `views/app/adminusers.ejs:40-42` | ✅ | medium |

**Recall: Juice Shop 8/9 challenges (7/8 sink sites), DVNA 3/3.** Juice Shop's `*_correct.ts` codefixes are not flagged; neither are the fake-API quiz variants (`bypassSecurityTrustSoundCloud`). Juice Shop `.hbs` views (all `{{ }}`) are not flagged.

Juice Shop app-code findings that aren't challenges (5 of 13): `data-export.component.ts:58` (captcha, server-generated), `:72` (`document.write` of the user's own export), `score-board.component.ts:83` (challenge descriptions), `hacking-instructor/index.ts:126` (static hint markdown), `assets/private/three.js:11375` (vendored). Debatable, not clearly wrong.

Design decisions: template files (`.html/.ejs/.pug/.hbs/.vue`) are scanned for XSS only (DVNA's sinks are all in `.ejs`). Angular `[innerHTML]` bindings are **not** flagged — Angular sanitizes them; the risk is `bypassSecurityTrust*`, which is.

---

## Current State

```
Design Phase     ████████████████████████████████ 100% ✅
Week 1 Scanner   ██████████████████████████░░░░░░  80% ✅  (deps ✅ secrets ✅ SQLi ✅ XSS ✅ merged | crypto ⏳ async ⏳ deferred)
Week 2 Dashboard ████████████████░░░░░░░░░░░░░░░░  50% 🔵  (core ✅ merged | polish ⏳)
Week 3 Deploy    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0% ⏳
```

| Task | Status | Where |
|---|---|---|
| #1 Dependency scanner | ✅ Merged to `main` (PR #1) | `src/scanner/dependency-scanner.js`, `npm-audit-client.js` |
| #2.1 Hardcoded secrets | ✅ Merged to `main` (PR #2) | `src/scanner/patterns/hardcoded-secrets.js` |
| #2.2 SQL injection | ✅ Merged to `main` (PR #2) | `src/scanner/patterns/sql-injection.js` |
| #2.3 XSS | ✅ Merged to `main` (PR #2) — see TODOs | `src/scanner/patterns/xss.js` |
| #2.4 Insecure crypto | ⏳ Deferred until after dashboard (confirm with user) | — |
| #2.5 Async footguns | ⏳ Deferred until after dashboard (confirm with user) | — |
| #4 Dashboard Core | ✅ Merged to `main` (PR #7) | `src/App.jsx`, `src/pages/Dashboard.jsx`, `src/components/`, `src/utils/findings.js` |
| #5 Dashboard Polish | ⏳ **Next** | dark mode, chart, responsive refinements |
| #6 Deploy (Vercel) | ⏳ After #5 — needs demo data | — |

---

## Open TODOs

- [x] **SQL injection: multi-line queries are missed.** Fixed — `toStatements()` in `src/scanner/file-utils.js` joins lines continued by `+` or an open template literal before matching (max 20 lines per statement). Reusable for XSS.
- [x] **Add a second scan target.** Done — two intentionally vulnerable Express + SQL apps, so findings can be checked against a known answer key:
  - **OWASP Juice Shop** (`git clone --depth 1 https://github.com/juice-shop/juice-shop.git /tmp/juice-shop`, tested at `1618a61`) — primary demo target, well known, TypeScript + Sequelize, also has XSS.
  - **DVNA** (`git clone --depth 1 https://github.com/appsecco/dvna.git /tmp/dvna`, tested at `9ba473a`) — small, plain JS.
  - SQLi results: **3/3 known injections found** (`juice-shop/routes/login.ts:34`, `juice-shop/routes/search.ts:23`, `dvna/core/appHandler.js:10`); static query at `search.ts:47` correctly not flagged.
- [x] **Route handlers in separate modules aren't recognized.** Fixed — `ROUTE_HANDLER` (now shared in `file-utils.js`) also matches a `(req, res` signature, including typed `(req: Request, res: Response)`. `juice-shop/routes/login.ts:34` and `dvna/core/appHandler.js:10` are now CRITICAL. `search.ts:23` stays HIGH because `req.query.q` passes through a `criteria` variable (only `req.*` on the query line escalates to critical).
- [x] **Juice Shop training snippets add noise.** Decided (session 4): tag, don't exclude. Files under `codefixes/`, `snippets/`, `fixtures/` get a "⚠ Non-executed code snippet" factor, severity capped at LOW, confidence capped at 0.3 (`nonProductionContext()` in `file-utils.js`). Juice Shop: 11 SQLi + 6 XSS snippet findings are now low.
- [x] **XSS: test-suite noise on Express.** Decided (session 4): test/example files are also capped at LOW severity (confidence −0.15) in both SQLi and XSS. Express XSS: 54 findings, all low (was 40 critical).
- [ ] **XSS: template injection not detected.** Juice Shop "CSP Bypass" (`routes/userProfile.ts:73`) splices user input into a Pug template string before `pug.compile`. Needs a "template compiled from a dynamic string" pattern (really SSTI, arguably its own scanner).
- [ ] **XSS: sinks inside string literals are matched.** e.g. Express `test/res.redirect.js:115` — `'javascript:eval(document.body.innerHTML=...)'` is a string, not code.
- [ ] **XSS: not covered yet** — `javascript:` URLs (`location.href = value`, `<a href>`), `eval`/`setTimeout(string)`, `res.render` with unescaped locals passed from routes (only the template side is checked).
- [x] **Run tests before PRs can be merged.** Done (session 4): `npm test` runs every `src/scanner/__tests__/*.test.js` via `node --test`; `.github/workflows/test.yml` runs it on Node 24 for PRs and pushes to `main`. A ruleset on `main` (enforced since the repo went public) requires a PR (0 approvals, squash only) and a passing `test` check, and blocks force pushes and deletion. New test files just need the `.test.js` suffix and a non-zero exit on failure.
- [ ] **Secret finding ids aren't unique.** Ids are built from the matched text (e.g. `secret-token = "$`), so they collide and contain spaces. The dashboard works around it (keys on type+file+line+index), but ids should be `secret-<file>-<line>` like SQLi/XSS.
- [ ] **Dependency findings show `@undefined` version.** Context reads "Vulnerable dependency detected: <pkg>@undefined" — the installed version isn't read from npm audit output.
- [ ] **Secret findings have 1 context factor** (schema wants 3+), and flag Terraform interpolations like `creation_token = "${var.project_name}-…"` as API tokens.
- [ ] **`npm run lint` is broken** — ESLint 9 needs an `eslint.config.js`; none exists. Add a flat config (React + hooks plugins), then a lint step in CI.
- [ ] **Deploy needs committed demo data.** `scanner-output.json` is gitignored (any path). For Vercel, commit a demo report under `public/` with a non-ignored name. Juice Shop's report includes snippets of its planted private keys — check GitHub secret scanning won't flag it, or use the DVNA/Express report.
- [ ] **Hardcoded-secret noise on Juice Shop.** 41 findings, 30 of them "Database Password" in `data/static/` seed data. `lib/insecurity.ts` private key is a real (planted) true positive. Review when tuning false positives.

---

---

## How the Pattern Scanners Work (copy this shape for crypto / async)

Each scanner in `src/scanner/patterns/` exports `async scanForX(targetPath)` returning findings matching the schema in PRD.md §3:

1. `walkDir(targetPath)` → skip `shouldSkipFile` / non-`isSourceFile` files
2. `toStatements(lines)` → iterate logical statements (multi-line safe); skip statements starting with `//` or `*`
3. `PATTERNS` array: `{ name, regex (global), sqlText/extractor, detected, description }`; reset `regex.lastIndex` before each use
4. Filter matches with a "does this really look like X" check (SQL: `looksLikeSql`) to keep false positives down
5. `assessContext(lines, statement, …)` → `{ factors, severity, confidence }`; look back `CONTEXT_WINDOW = 15` lines for user input / route handlers / mitigations; shift severity along `['low','medium','high','critical']`
6. Finding fields: `id`, `type` (`'xss'` for XSS — already counted in `index.js` coverage), `title`, `severity`, `confidence` (0.1–0.95), `description`, `file`, `line` (1-based statement start), `snippet` (whitespace-collapsed, ≤120 chars), `context` (3+ factors, ✓/⚠/? prefixes), `remediation` (actionable, with example), `references` (OWASP), `tags`
7. Wire into `src/scanner/pattern-scanner.js` inside its own try/catch

Tests: plain Node scripts (no framework), run with `node src/scanner/__tests__/<name>.test.js`; each writes fixtures to a tmp dir, prints ✓/✗, exits non-zero on failure. Note `.test.` files are skipped by the walker, so fixtures must use other names.

---

## Context for Next Agent/Session

### Core Loop (Protected)
```
Scanner → JSON → Dashboard
```
Don't add features that break this. This is the heart.

### Interview Story (30 seconds)
> "I built a real security scanner with contextual scoring. Not just 'vuln found'—I score exploitability based on multiple factors (input sanitized? endpoint public?). This shows threat modeling. I scanned Express.js, found actual CVEs, built an intuitive dashboard."

### Tech Stack
- **Scanner:** Node.js + npm audit API + pattern regex
- **Dashboard:** React + Vite + Tailwind
- **Deploy:** Vercel
- **Data:** JSON files (scanner-output.json)

### Trade-offs Made (No Redo)
1. **Contextual scoring** = differentiator (not generic pattern matching)
2. **Node.js only (Phase 1)** = faster, Express.js is target
3. **Real repo (Express.js)** = more credible than toy data
4. **High FP tolerance (Phase 1)** = better to flag than miss; Phase 2 tunes

### Risks Tracked
- npm audit API rate limits → cache locally
- Large repos (10k files) → filter to src/
- False positives > 50% → document and whitelist
- No package.json → graceful skip

See **PRD.md Section 5** for full edge case list.

---

---

## Files in Project (scanner)

```
src/scanner/
├── index.js                  ← CLI: node src/scanner/index.js <repo> → scanner-output.json
├── dependency-scanner.js     ← Task #1
├── npm-audit-client.js       ← Task #1
├── pattern-scanner.js        ← runs each pattern scanner (crypto/async TODOs here)
├── file-utils.js             ← shared: walkDir, skip rules, toStatements, USER_INPUT, ROUTE_HANDLER
├── patterns/
│   ├── hardcoded-secrets.js  ← Task #2.1
│   ├── sql-injection.js      ← Task #2.2
│   └── xss.js                ← Task #2.3
└── __tests__/
    ├── dependency-scanner.test.js
    ├── hardcoded-secrets.test.js
    ├── sql-injection.test.js
    └── xss.test.js
```
Dashboard skeleton (Week 2, untouched): `src/App.jsx`, `src/pages/Dashboard.jsx`.

## Key Documents

| Document | Purpose |
|----------|---------|
| **PRD.md** | Requirements, output schema (§3), edge cases (§5) |
| **DESIGN.md** | Contextual scoring model, per-scanner context ideas |
| **CONTRIBUTING.md** | Git flow, PR template, commit format |
| **STATUS.md** | Dashboard + interview pitch |
| **FUTURE_IDEAS.md** | Phase 2+ (don't build now) |

---

## What's NOT Done (And Shouldn't Be)

❌ **Python/Ruby scanners** — Node.js only for MVP (Phase 2)  
❌ **CI/CD integration** — Not needed for portfolio (Phase 2)  
❌ **Database** — JSON files sufficient (Phase 2+)  
❌ **Authentication** — Solo project (Phase 2)  
❌ **Compliance mapping** — CIS/PCI (Phase 2)  

These are documented in **FUTURE_IDEAS.md** for later.

---

---

## Questions to Ask Before Starting

1. **Is the core loop (scanner → JSON → dashboard) intact?** (Should always be yes)
2. **Can I explain this in 3 minutes to an interviewer?** (Check before shipping)
3. **Is the code clean + understandable?** (No hacky workarounds)
4. **Did I test the happy path AND the unhappy path?** (Edge cases matter)
5. **Am I on pace for the timeline?** (Week 1 = scanner, Week 2 = dashboard, Week 3 = deploy)

If any is "no," flag it. That's what the TPM is for.

---
