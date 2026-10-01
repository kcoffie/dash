# Project Handoff — Security Audit Platform

**Last updated:** 2026-10-01 (session 4)
**Branch:** `feature/scanner-patterns` (pushed, in sync with origin — not yet merged to `main`)
**Status:** Week 1 scanners in progress — Option B chosen (Secrets ✅, SQL Injection ✅, XSS ✅)
**Next step:** Open the PR `feature/scanner-patterns` → `main`, then Week 2 dashboard

---

## ▶ START HERE (Next Agent)

### Where we are
Option B was chosen (secrets + SQL injection + XSS before merging, then dashboard). Secrets, SQL injection, route-handler fix, and XSS are done, tested, and pushed. Non-production-code decision is made and implemented. Remaining: open a PR for `feature/scanner-patterns` → `main`.

### Do these, in order
1. **Setup** — clone scan targets if `/tmp` was wiped (they live outside the repo):
   ```bash
   git clone --depth 1 https://github.com/expressjs/express.git /tmp/express
   git clone --depth 1 https://github.com/juice-shop/juice-shop.git /tmp/juice-shop
   git clone --depth 1 https://github.com/appsecco/dvna.git /tmp/dvna
   ```
2. **Verify baseline** — all should pass / match:
   ```bash
   node src/scanner/__tests__/hardcoded-secrets.test.js   # 5/5
   node src/scanner/__tests__/sql-injection.test.js       # 21/21
   node src/scanner/__tests__/xss.test.js                 # 22/22
   node src/scanner/index.js /tmp/juice-shop              # 13 sql-injection, 19 xss
   node src/scanner/index.js /tmp/dvna                    # 1 sql-injection, 10 xss
   node src/scanner/index.js /tmp/express                 # 0 sql-injection, 54 xss
   ```
3. ✅ **Fix route-handler detection (~15 min)** — in `src/scanner/patterns/sql-injection.js`, `ROUTE_HANDLER` only matches `app.get(` / `router.post(` etc. Also treat a `(req, res` function signature as a route handler (Juice Shop + DVNA define handlers as `module.exports = function (req, res) {…}`). Expected result: `juice-shop/routes/login.ts:34` and `dvna/core/appHandler.js:10` become **critical**. Add a test. Consider moving the regex to `file-utils.js` so XSS reuses it.
4. ✅ **Build XSS scanner (Task #2.3)** — done; answer key + recall below. — `src/scanner/patterns/xss.js` + `src/scanner/__tests__/xss.test.js`, wire into `src/scanner/pattern-scanner.js` (replace the `// TODO: XSS patterns` line). Follow the SQL injection scanner's structure exactly (see "How the pattern scanners work" below). Use Juice Shop as the answer key: find its known XSS sinks first (grep `bypassSecurityTrustHtml`, `innerHTML`, `res.send(` with user input; `data/static/codefixes/*Xss*` lists the challenges), then measure recall.
5. ✅ **Ask the user** how to handle Juice Shop's `data/static/codefixes/` training snippets (exclude folder vs. low-confidence tag) — open decision, see Open TODOs.
6. **Open PR** `feature/scanner-patterns` → `main` once XSS is in (use PR template in CONTRIBUTING.md; squash merge). Then Week 2: dashboard.

### Working agreements with the user
- **Commit and push right away** after each logical chunk — user wants to be aggressive about pushing so no work is lost.
- Commit style: separate `feat:` / `test:` / `docs:` commits, issue ref `(#2)`. Never commit `.obsidian/workspace.json`.
- Track limitations as checkboxes in **Open TODOs** below, and check them off when fixed — user wants limitations visible until they're gone.
- Confirm a new test actually fails against the old code before calling a fix done.

---

## What We Did This Session (2026-09-30, session 3)

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
Week 1 Scanner   ████████████████████░░░░░░░░░░░░  65% 🔵  (deps ✅ secrets ✅ SQLi ✅ XSS ✅ | crypto ⏳ async ⏳)
Week 2 Dashboard ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0% ⏳
Week 3 Deploy    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0% ⏳
```

| Task | Status | Where |
|---|---|---|
| #1 Dependency scanner | ✅ Merged to `main` (PR #1) | `src/scanner/dependency-scanner.js`, `npm-audit-client.js` |
| #2.1 Hardcoded secrets | ✅ Done, on branch | `src/scanner/patterns/hardcoded-secrets.js` |
| #2.2 SQL injection | ✅ Done, on branch (1 small TODO) | `src/scanner/patterns/sql-injection.js` |
| #2.3 XSS | ✅ Done, on branch (see TODOs) | `src/scanner/patterns/xss.js` |
| #2.4 Insecure crypto | ⏳ After merge (Option B scope stops at XSS) | — |
| #2.5 Async footguns | ⏳ After merge | — |

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
- [ ] **Hardcoded-secret noise on Juice Shop.** 41 findings, 30 of them "Database Password" in `data/static/` seed data. `lib/insecurity.ts` private key is a real (planted) true positive. Review when tuning false positives.

---

---

## How the Pattern Scanners Work (copy this shape for XSS)

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
