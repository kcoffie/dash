# Project Handoff — Security Audit Platform

**Last updated:** 2026-10-02 (session 5)
**Branch:** `feature/deploy`. PR #10 is open (Task #6, demo data + picker) and **waiting for the user to merge**. `main` @ `cd52fc1` has everything through PR #9.
**Status:** Week 1 scanners ✅ (deps, secrets, SQLi, XSS) · CI gate ✅ · Week 2 Dashboard ✅ (PRs #7, #9) · Deploy prep 🟡 (PR #10) · repo public, `main` protected
**Next step:** after PR #10 merges, the **user** imports the repo in Vercel (needs their login; steps in START HERE step 5). Then add the live URL to README/STATUS, and start Task #7 (README screenshots, talking points).

---

## ▶ START HERE (Next Agent)

### Where we are
The core loop works end to end: `npm run scan <repo>` → `scanner-output.json` → React dashboard (`npm run dev`). Scanners for dependency CVEs, hardcoded secrets, SQL injection, and XSS are merged and validated against OWASP Juice Shop + DVNA answer keys. The dashboard core (summary cards, coverage report, search/filters, expandable findings with "why this severity") is merged (PR #7). Dashboard polish (dark mode, findings-by-type chart, phone layout) is in PR #9. CI (`test` job: `npm ci` → `npm test` → `npm run build`) must pass before anything merges to `main`. Crypto (#2.4) and async (#2.5) scanners are deferred until after the dashboard and deploy (user's call).

### Do these, in order
1. **Setup** (if PR #10 is still open, check with the user before starting new work)
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
   npm test                                 # 6 suites: demo export 5/5, dependency 3/3, secrets 5/5, SQLi 21/21, XSS 22/22, dashboard helpers 14/14
   npm run build                            # must succeed (CI runs it)
   ```
   Scanner counts (run from a scratch dir — `index.js` writes `scanner-output.json` to the cwd):
   Juice Shop 13 SQLi / 19 XSS / 138 total · DVNA 1 SQLi / 10 XSS · Express 0 SQLi / 54 XSS (all low).
3. **See the dashboard**: from the repo root, `npm run scan /tmp/juice-shop` (writes the gitignored `scanner-output.json` the dev server serves), then `npm run dev` → http://localhost:5173. Without a local report, the dashboard opens the committed Juice Shop demo. The "Demo scan" picker switches demos; "Load scan file…" loads any other report.
4. **Task #5: Dashboard Polish**: ✅ merged (PR #9). Don't merge PRs yourself; the user does.
5. **Week 3: Deploy (Task #6)**. Demo data and picker are in PR #10 (user's decision: all three scans). What's left needs the **user's** Vercel login, so don't try it yourself:
   - vercel.com → Add New → Project → import `kcoffie/dash`. Vite is auto-detected (build `npm run build`, output `dist`); no `vercel.json` or env vars needed.
   - Production branch `main`; each merge then redeploys, and PRs get preview URLs.
   - After the first deploy, check: the Juice Shop demo opens, the picker switches to DVNA / Express, dark mode works, and `/scanner-output.json` 404s (expected; the app falls back to the demo).
   - Then put the live URL in README.md and STATUS.md.
   - **Regenerating demo data:** re-clone the targets (step 1), run `npm run demo:export`, review the diff, and commit `public/demo/`. The export redacts secret snippets and ids and **fails** if any finding still contains an AWS key, private-key header, GitHub/GitLab token, or Slack/Discord webhook.
6. **Later:** fix the scanner TODOs (secret ids, `@undefined` dep versions, secret context factors, ESLint config), then #2.4 crypto / #2.5 async.

### Dashboard map
- `src/App.jsx`: loads `/scanner-output.json` first, otherwise the first scan in `/demo/index.json`. A non-JSON response means "not there" (Vite and static hosts answer missing files with `index.html` + 200). "Demo scan" picker (manifest validated by `normalizeDemoManifest()`), file picker via `normalizeReport()`, target linked to the scanned commit via `sourceLink()`.
- `src/pages/Dashboard.jsx` — sorts once, assigns stable row keys on the unfiltered list (so expanded rows survive filtering), filters, composes components.
- `src/components/` — `SummaryCards` (click = severity filter; empty Info card hidden, 3+2 on phones when all 5 show), `TypeChart` (findings by type split by severity; click a type or segment = filter, hover/focus = tooltip), `CoverageReport` (`coverage.checked` / `notYetChecked` / `errors`), `FilterBar`, `FindingsTable` (expand/collapse, responsive columns), `FindingDetails` (snippet, ✓/⚠/? factors, fix, links — only `http(s)` URLs are linked), `SeverityBadge` (`SEVERITY_STYLES` for badges/cards, `SEVERITY_FILLS` for chart marks).
- `src/utils/findings.js` — filter/search/sort/count, `severityByType` (chart rows), `summarySeverities` (which cards to show), `parseFactor`, `findingKey` (scanner ids aren't unique), `isSafeUrl`, `CATEGORY_TYPES`.
- **Dark mode** — Tailwind v4's default `dark:` variant (`prefers-color-scheme`), no toggle. `color-scheme: light dark` in `src/index.css` + `index.html` so native controls match. Every new color class needs a `dark:` partner. Measured contrast (Juice Shop): severity cards ≥ 6.4:1 light, ≥ 10:1 dark.
- **Chart colors** — `SEVERITY_FILLS` were checked with the dataviz skill's `validate_palette.js` (adjacent pairs, CVD + normal vision) against white and gray-900. Light uses red-700 / orange-500 / amber-400 / sky-600 / gray-400 (red-600 and sky-500 failed the normal-vision floor next to orange / gray). Amber and orange sit below 3:1 on white, so the chart must keep its legend + value labels.
- Manual-testing tips: Claude-in-Chrome's `resize_window` didn't change the viewport here — test phone width by injecting `<iframe src="/" style="width:390px">` via the JS tool. **Use `npm run build && cp scanner-output.json dist/ && npx vite preview`** for that: the dev server's HMR reloads the page (and drops the iframes) on every file edit, and `SeverityBadge.jsx` exporting constants forces full reloads. To check light mode on a dark-mode machine (or vice versa), rewrite `prefers-color-scheme: dark` in the page's stylesheets via the JS tool; iframes inherit the parent's `color-scheme`. Load a modified report through the file input with a `DataTransfer`. Close tabs and stop servers when done.

### Working agreements with the user
- **Commit and push right away** after each logical chunk — user wants to be aggressive about pushing so no work is lost.
- Commit style: separate `feat:` / `test:` / `docs:` commits, task ref like `(#2)` (these are plan task numbers — there are no GitHub issues, so don't write `Closes #N`). Never commit `.obsidian/workspace.json`.
- **No `Co-Authored-By:` or other AI attribution lines** in commits (or PR descriptions). History was rewritten once to remove them.
- Work on a branch, open PRs with the CONTRIBUTING.md template, **squash merge only when the user says so**. Delete merged branches. `main` is protected — direct pushes and force pushes are rejected.
- **The repo is public** (since 2026-10-01). Commits in this repo use the GitHub noreply email (`git config user.email` is set locally); don't put personal info in commits, docs, or PRs.
- Track limitations as checkboxes in **Open TODOs** below, and check them off when fixed — user wants limitations visible until they're gone.
- Confirm a new test actually fails against the old code before calling a fix done.

---

## What We Did in Session 5 (2026-10-02)

- ✅ Baseline matched session 4 exactly (tests, build, Juice Shop 13 SQLi / 19 XSS / 138, DVNA 1 / 10, Express 0 / 54).
- 🟡 **Dashboard Polish (Task #5, PR #9, awaiting merge)** on `feature/dashboard-polish`:
  - **Dark mode** following the system preference, all components, contrast measured in-browser.
  - **Findings-by-type chart** (`TypeChart.jsx`, plain HTML/CSS) — one bar per type, segmented by severity, legend + totals, hover/focus tooltip, click to filter. Chose stacked bars over the planned pie: the cards already give severity totals, and bars compare better.
  - **Phone layout** — empty Info card hidden (2×2 grid), 3+2 when all five show; severity/type selects side by side; file name no longer breaks mid-word.
  - Tests: `severityByType`, `summarySeverities` (12/12; both checked to fail against broken code).
  - Verified in Chrome on a Juice Shop scan: light + dark × desktop + 390px, no horizontal scroll, keyboard focus shows tooltips.
- ✅ STATUS.md Overall Progress corrected (said 65% for Phase 1; by tasks it was ~48% before this PR, 62% once it merges).
- ✅ Docs refresh (in PR #9): PRD, DESIGN, README, CONTRIBUTING, STATUS, TPM_STRATEGY, FUTURE_IDEAS now match the build. **PR #9 merged** by the user.
- 🟡 **Deploy prep (Task #6, PR #10, awaiting merge)** on `feature/deploy`:
  - `scanTarget()` (`src/scanner/report.js`) split out of the CLI. Reports were identical before and after for all three targets.
  - `toDemoReport()` (`src/scanner/demo-export.js`) redacts secret snippets and ids, replaces the `/tmp` path with the repo name, records `source: { repo, commit }`, and throws on leftover key formats. 5 tests, each mutation-checked.
  - `npm run demo:export` → `public/demo/{juice-shop,dvna,express}.json` + `index.json` (≈235 KB). Committed at juice-shop `1618a61`, dvna `9ba473a`, express `7ef9844`. Checked by hand for local paths, personal info, and key formats before committing.
  - Dashboard: a "Demo scan" picker; deployed builds open Juice Shop. Verified in a `vite preview` build for the deploy case, the local-report case, no manifest, and nothing at all, plus 390px.
  - GitHub settings: the user's **account-level "Push protection for yourself" is on**, so pushes the user makes to public repos are blocked if they contain secrets GitHub recognizes (the demo-data push passed it). **Repo-level** secret scanning (alerts across all history) and repo push protection are **off** (`gh api repos/kcoffie/dash --jq .security_and_analysis`). Suggested to the user: turn on repo-level secret scanning in the repo's Settings → Advanced Security. The user decides; don't change repo settings.

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
Week 2 Dashboard ████████████████████████████████ 100% ✅  (core ✅ PR #7 | polish ✅ PR #9)
Week 3 Deploy    ████████████░░░░░░░░░░░░░░░░░░░░  40% 🟡  (demo data + picker 🟡 PR #10 | Vercel import ⏳ user | README/demo ⏳)
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
| #5 Dashboard Polish | ✅ Merged to `main` (PR #9) | `src/components/TypeChart.jsx`, `SummaryCards.jsx`, `dark:` variants throughout |
| #6 Deploy (Vercel) | 🟡 PR #10 (demo data + picker) → user imports in Vercel | `scripts/export-demo.js`, `src/scanner/demo-export.js`, `public/demo/` |
| #7 Documentation | ⏳ After the live URL exists | README screenshots, talking points |

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
- [x] **Deploy needs committed demo data.** Done in PR #10: all three scans under `public/demo/`, generated by `npm run demo:export` with secret snippets redacted, and a picker in the dashboard.
- [ ] **Demo data is a snapshot.** It's pinned to the target commits above, so it won't change when the scanners improve. Re-run `npm run demo:export` after scanner changes (e.g. the secret-noise or `@undefined` fixes) and commit the diff.
- [x] **PRD.md / DESIGN.md were partly stale.** Fixed in session 5 (PR #9). PRD checkboxes now match the build, with italic notes where it differs; DESIGN describes the scoring model and dashboard as built and marks *(not built)* ideas; README, CONTRIBUTING (everything goes through PRs; task numbers, not issues), TPM_STRATEGY, and FUTURE_IDEAS refreshed; the original brief (`security-audit-platform-overview.md`) is kept as-is with a "what changed" note.
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
├── report.js                 ← scanTarget(): runs every scanner, builds the report (CLI + demo export)
├── demo-export.js            ← toDemoReport(): redact secrets, record source, refuse key material
├── dependency-scanner.js     ← Task #1
├── npm-audit-client.js       ← Task #1
├── pattern-scanner.js        ← runs each pattern scanner (crypto/async TODOs here)
├── file-utils.js             ← shared: walkDir, skip rules, toStatements, USER_INPUT, ROUTE_HANDLER
├── patterns/
│   ├── hardcoded-secrets.js  ← Task #2.1
│   ├── sql-injection.js      ← Task #2.2
│   └── xss.js                ← Task #2.3
└── __tests__/
    ├── demo-export.test.js
    ├── dependency-scanner.test.js
    ├── hardcoded-secrets.test.js
    ├── sql-injection.test.js
    └── xss.test.js
```
`scripts/export-demo.js` (`npm run demo:export`) regenerates `public/demo/`. Dashboard files: see "Dashboard map" in START HERE.

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
