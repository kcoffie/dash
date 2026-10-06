# Project Handoff — Security Audit Platform

**Last updated:** 2026-10-06 (session 7)
**Branch:** `main` @ `2ede14b` has everything through PR #18. The async-footgun scanner is on `feature/async-scanner` (PR open, user merges). After it merges, Phase 1 is complete.
**Status:** Week 1 scanners ✅ (deps, secrets, SQLi, XSS, crypto; async ✅ PR open) · CI gate ✅ (test + lint) · Week 2 Dashboard ✅ (PRs #7, #9) · **Deployed ✅ https://dash-jade-nine.vercel.app/** (Vercel, production branch `main`) · Task #7 docs ✅ (PR #13) · scanner accuracy ✅ (PR #14) · ESLint ✅ (PR #16) · crypto scanner ✅ (PR #17; live demo now Juice Shop 144 / DVNA 72 / Express 65, verified on the live `/demo/*.json`) · repo public, `main` protected, secret scanning + push protection on (0 alerts)
**Next step:** after the async PR merges, ask the user what's next. Candidates: the team-gates port (mutation-testing gate in CI; see the user's memory note and `~/Documents/projs/dos/TEAM.md`; ask before changing repo settings), template injection (XSS TODO), Phase 2.

---

## ▶ START HERE (Next Agent)

### Where we are
**Session 8 (2026-10-06), in progress: team-gates port** (the user picked it). PR #19 merged; every Phase 1 scanner is built; live totals verified 160 / 87 / 65. Baseline matched (10 suites / 153 tests, lint, build; fresh scans at the pinned commits identical to `public/demo` except timestamps, no dependency drift). 0 secret-scanning and 0 Dependabot alerts. Stale branches `docs/session-7-wrap` (local) and `feature/async-scanner` (remote) deleted after checking each tip matched its squash merge.
**Team-gates port, user-approved plan** (A gates → B tests → C talk track → D required check):
- ✅ PR #20 merged: unique temp dir per test run (the first two mutation baselines were invalid, see Session 8).
- **A. Gates (`chore/team-gates`, PR open):** Stryker 10 (`stryker.config.json`, `npm run mutate`, `npm run mutate:changed` = `scripts/mutate-changed.js`), CI jobs `mutation-changed` (PRs: ≥ 80% on changed `src/scanner`/`src/utils` lines, ratchet can't drop) and `mutation-full` (push to `main`), ratchet `break` 56, dash-specific `.claude/agents/reviewer.md` + `architect.md`, `docs/ENGINEERING_PROCESS.md` (method, proof the gate works, score log). `qs` overridden to ^6.16.0 (user decision: Stryker's `typed-rest-client` pins a vulnerable 6.15.1).
- **B. Tests (next, worst first):** `report.js` + `pattern-scanner.js` tests from PRD §3 (both 0%); dependency test → recorded `npm audit` response + one live test behind an opt-in env var (user decision); then each scanner's survivors triaged against the answer keys / DESIGN scoring model, tests named as rules. Raise the ratchet after each PR and log the score in `docs/ENGINEERING_PROCESS.md`.
- **C.** Talk track ("how to talk about it") in `docs/ENGINEERING_PROCESS.md`, from the measured before/after numbers only.
- **D.** Ask the user before adding `mutation-changed` to the `main` ruleset's required checks (repo setting).
- Every PR from now: run the `reviewer` agent before opening it, and `npm run mutate:changed` when scanner/utils code changed. Mutation runs: `caffeinate -dims`, lid open.

**Then ask the user which of these is next** (no default; they choose):
1. **Team-gates port** (from the user's memory note `team-gates-port`): read `~/Documents/projs/dos/TEAM.md`, `.claude/agents/reviewer.md`, `.claude/agents/architect.md`, `scripts/mutate-changed.js`, `.github/workflows/ci.yml` in dos. Measure a Stryker mutation baseline over `src/scanner/` first (command runner over `npm test`; the tests are plain Node scripts, not a framework), adapt the agents to dash's PRD/DESIGN, add a changed-lines mutation job to `.github/workflows/test.yml` (≥ 80% killed on changed lines + a ratchet), and write `docs/ENGINEERING_PROCESS.md` with the talk track from real before/after numbers. **Ask before changing branch protection / required checks** (repo setting).
2. **Template injection** (open XSS TODO: Juice Shop CSP Bypass, `routes/userProfile.ts:73`).
3. **Async TODO:** unawaited calls to local async functions (`basketItems.ts:75`). Needs a severity call.
4. Phase 2 items (PRD §6).

The core loop works end to end: `npm run scan <repo>` → `scanner-output.json` → React dashboard (`npm run dev`). Scanners for dependency CVEs, hardcoded secrets, SQL injection, and XSS are merged and validated against OWASP Juice Shop + DVNA answer keys. The dashboard core (summary cards, coverage report, search/filters, expandable findings with "why this severity") is merged (PR #7). Dashboard polish (dark mode, findings-by-type chart, phone layout) is merged (PR #9). Demo data for all three scan targets (redacted) plus a "Demo scan" picker is merged (PR #10), so a static deploy has something to show. **It's live at https://dash-jade-nine.vercel.app/** (Vercel; every merge to `main` redeploys, PRs get preview URLs). The README has screenshots, how it works, measured results, and talking points (Task #7). CI (`test` job: `npm ci` → `npm test` → `npm run lint` → `npm run build`) must pass before anything merges to `main`. Crypto (#2.4, PR #17) and async (#2.5, PR #19) scanners were built in session 7.

### Do these, in order
1. **Setup** (if a PR is still open, check with the user before starting new work)
   ```bash
   git checkout main && git pull
   # Note: in this shell `gh` is aliased to `history | grep`; use `command gh …`.
   # Scan targets: macOS prunes /tmp. Session 7 cloned them into the agent's scratchpad at the pinned commits instead (see step 2 for the exact commands).
   npm ci                                   # node_modules isn't committed; needed for dev/build
   # Scan targets live outside the repo — re-clone if /tmp was wiped:
   # macOS prunes old files in /tmp: if `git -C /tmp/juice-shop status` says "not a git repository", delete and re-clone.
   # A partial clone scans "fine" but gives junk counts (session 6 saw Juice Shop 42 findings instead of 138).
   git clone --depth 1 https://github.com/expressjs/express.git /tmp/express
   git clone --depth 1 https://github.com/juice-shop/juice-shop.git /tmp/juice-shop
   git clone --depth 1 https://github.com/appsecco/dvna.git /tmp/dvna
   ```
   `npm ci` warns that esbuild's install script wasn't approved — harmless (the build works; CI is green).
2. **Verify baseline**
   ```bash
   npm test                                 # 10 suites, 153 tests: async 24/24, crypto 26/26, demo export 6/6, dependency 4/4, file utils 4/4, secrets 19/19, npm audit client 13/13, SQLi 21/21, XSS 22/22, dashboard helpers 14/14
   npm run lint                             # must be clean (CI runs it, session 7)
   npm run build                            # must succeed (CI runs it)
   ```
   Scanner counts (run from a scratch dir — `index.js` writes `scanner-output.json` to the cwd):
   Juice Shop 67 deps / 27 secrets / 13 SQLi / 19 XSS / 18 crypto / 16 async = 160 · DVNA 58 / 1 / 1 / 10 / 2 / 15 = 87 · Express 5 / 6 / 0 / 54 / 0 / 0 = 65 (all low). (Session 7, at the demo commits; dependency counts include a `sprintf-js` advisory published after session 6.)
   To check out the demo commits exactly: `git clone --filter=blob:none <url> <dir> && git -C <dir> checkout <commit> && git -C <dir> config core.abbrev 7` (commits are in `public/demo/index.json`; `core.abbrev` keeps `demo:export`'s short SHA at 7 chars).
   **Dependency counts drift:** none of the three targets commits a lockfile, so npm resolves versions at scan time and advisories change. Pattern counts (secrets/SQLi/XSS/crypto) are stable at a pinned commit.
3. **See the dashboard**: from the repo root, `npm run scan /tmp/juice-shop` (writes the gitignored `scanner-output.json` the dev server serves), then `npm run dev` → http://localhost:5173. Without a local report, the dashboard opens the committed Juice Shop demo. The "Demo scan" picker switches demos; "Load scan file…" loads any other report.
4. **Check secret scanning** (enabled by the user at the end of session 5; the first scan of history can take a while):
   ```bash
   gh api repos/kcoffie/dash --jq .security_and_analysis        # secret_scanning + push_protection: enabled
   gh api repos/kcoffie/dash/secret-scanning/alerts --jq 'length' # was 0 at end of session 5
   ```
   If alerts show up, list them (`--jq '.[] | {number, secret_type_display_name, state, path: .first_location_detected.path}'`) and tell the user before doing anything. They're most likely the fake keys in test fixtures (`src/scanner/__tests__/hardcoded-secrets.test.js` uses AWS's documented example key). The demo files were checked and contain no key formats. Don't dismiss alerts yourself; that's the user's call.
5. **Deploy (Task #6) ✅** — https://dash-jade-nine.vercel.app/. Imported by the user (Vite auto-detected, no `vercel.json`, production branch `main`). Verified in session 6: Juice Shop opens by default, picker switches to DVNA / Express (totals now 125 / 70 / 64 after PR #14; checked live via `/demo/index.json`), light + dark, 390px with no horizontal scroll, no console errors, `/scanner-output.json` 404s (expected).
   - **README screenshots:** `npm run screenshots [-- <url>]` (`scripts/screenshots.js`) drives headless Chrome over the DevTools protocol and rewrites `docs/screenshots/` (light, dark, expanded login SQLi finding, phone). Defaults to the live URL; set `CHROME` if Chrome isn't at the macOS path. Re-run after visible dashboard or demo-data changes.
   - **Regenerating demo data:** re-clone the targets (step 1), run `npm run demo:export`, review the diff, and commit `public/demo/`. The export redacts secret snippets and ids and **fails** if any finding still contains an AWS key, private-key header, GitHub/GitLab token, or Slack/Discord webhook.
6. **Next, in order** (each its own branch + PR; ask the user before any scoring/severity judgment call — they've made every one so far):
   - **a. ✅ ESLint (session 7, `chore/eslint`).** Done as described below; see "What We Did in Session 7". Original plan: ESLint 9 is a devDependency but there's no `eslint.config.js`. Add a flat config: `@eslint/js` recommended + `globals` (browser for `src/` except `src/scanner/`, node for `src/scanner/`, `scripts/`, tests), `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` for the JSX (those two need adding as devDependencies; check the current versions on npm, don't guess). Ignore `dist/`, `public/demo/`, `.test-tmp*`. Run it, fix real findings in small commits (don't blanket-disable rules), then add `npm run lint` to `.github/workflows/test.yml` before the build step. CI must stay green.
   - **b. ✅ #2.4 Insecure crypto scanner** (session 7, `feature/crypto-scanner`): see "Insecure crypto answer key + recall" below and Session 7.
   - **c. ✅ #2.5 Async footguns** (session 7, `feature/async-scanner`): see "Async footgun ground truth" below.
   - After any scanner change: re-clone targets if needed (step 1), `npm run demo:export -- <targets-dir>`, review the diff (no local paths, snippets redacted), `npm run build && npx vite preview`, check the dashboard, `npm run screenshots -- http://localhost:4173/`, update README results table + HANDOFF snapshot. The live site only updates after merge.

### Dashboard map
- `src/App.jsx`: loads `/scanner-output.json` first, otherwise the first scan in `/demo/index.json`. A non-JSON response means "not there" (Vite and static hosts answer missing files with `index.html` + 200). "Demo scan" picker (manifest validated by `normalizeDemoManifest()`), file picker via `normalizeReport()`, target linked to the scanned commit via `sourceLink()`.
- `src/pages/Dashboard.jsx` — sorts once, assigns stable row keys on the unfiltered list (so expanded rows survive filtering), filters, composes components.
- `src/components/` — `severity-styles.js` (`SEVERITY_STYLES` for badges/cards, `SEVERITY_FILLS` for chart marks; kept out of the `.jsx` files so Fast Refresh works), `SummaryCards` (click = severity filter; empty Info card hidden, 3+2 on phones when all 5 show), `TypeChart` (findings by type split by severity; click a type or segment = filter, hover/focus = tooltip), `CoverageReport` (`coverage.checked` / `notYetChecked` / `errors`), `FilterBar`, `FindingsTable` (expand/collapse, responsive columns), `FindingDetails` (snippet, ✓/⚠/? factors, fix, links — only `http(s)` URLs are linked), `SeverityBadge`.
- `src/utils/findings.js` — filter/search/sort/count, `severityByType` (chart rows), `summarySeverities` (which cards to show), `parseFactor`, `findingKey` (scanner ids aren't unique), `isSafeUrl`, `CATEGORY_TYPES`.
- **Dark mode** — Tailwind v4's default `dark:` variant (`prefers-color-scheme`), no toggle. `color-scheme: light dark` in `src/index.css` + `index.html` so native controls match. Every new color class needs a `dark:` partner. Measured contrast (Juice Shop): severity cards ≥ 6.4:1 light, ≥ 10:1 dark.
- **Chart colors** — `SEVERITY_FILLS` were checked with the dataviz skill's `validate_palette.js` (adjacent pairs, CVD + normal vision) against white and gray-900. Light uses red-700 / orange-500 / amber-400 / sky-600 / gray-400 (red-600 and sky-500 failed the normal-vision floor next to orange / gray). Amber and orange sit below 3:1 on white, so the chart must keep its legend + value labels.
- Manual-testing tips: Claude-in-Chrome's `resize_window` didn't change the viewport here — test phone width by injecting `<iframe src="/" style="width:390px">` via the JS tool. For light mode in an iframe, just set `style.colorScheme = 'light'` on the `<iframe>` element and reload it: the iframe's `prefers-color-scheme` follows that (don't also rewrite media rules — that flips it back). **Use `npm run build && cp scanner-output.json dist/ && npx vite preview`** for that: the dev server's HMR reloads the page (and drops the iframes) on every file edit, (`SeverityBadge.jsx` exporting constants used to force full reloads too; fixed in session 7). To check light mode on a dark-mode machine (or vice versa), rewrite `prefers-color-scheme: dark` in the page's stylesheets via the JS tool; iframes inherit the parent's `color-scheme`. Load a modified report through the file input with a `DataTransfer`. Close tabs and stop servers when done.

### Working agreements with the user
- **Commit and push right away** after each logical chunk — user wants to be aggressive about pushing so no work is lost.
- Commit style: separate `feat:` / `test:` / `docs:` commits, task ref like `(#2)` (these are plan task numbers — there are no GitHub issues, so don't write `Closes #N`). Never commit `.obsidian/workspace.json`.
- **No `Co-Authored-By:` or other AI attribution lines** in commits (or PR descriptions). History was rewritten once to remove them.
- Work on a branch, open PRs with the CONTRIBUTING.md template, **squash merge only when the user says so**. Delete merged branches. `main` is protected — direct pushes and force pushes are rejected.
- **The repo is public** (since 2026-10-01). Commits in this repo use the GitHub noreply email (`git config user.email` is set locally); don't put personal info in commits, docs, or PRs.
- Track limitations as checkboxes in **Open TODOs** below, and check them off when fixed — user wants limitations visible until they're gone.
- Confirm a new test actually fails against the old code before calling a fix done (`git stash` the source change, run the test, `git stash pop`).
- **Measure, don't assume:** before changing a scanner, read the actual findings on all three targets; after, diff against `public/demo/` finding by finding. Every number in README/docs must come from data you just looked at.
- **Scoring/severity rules are the user's call.** Present the trade-off with real counts (AskUserQuestion) instead of picking one.
- Don't let local paths leak into anything published (demo reports, errors, docs). npm's debug-log path lives in the home directory.

---

## What We Did in Session 8 (2026-10-06)
- ✅ START HERE steps 1–3 (see "Where we are"). No files changed by those steps.
- ⚠ **First two Stryker baselines were invalid.** Run 1 (95.47%) overlapped a lid-closed sleep: 138 timeouts bunched in three consecutive files, all 42 `src/scanner/index.js` mutants "timed out" though no test loads `index.js`. Run 2 (96.79%, Mac kept awake with `caffeinate`) still "killed" 38 `index.js` mutants. Cause: seven test files used a fixed fixture folder in the repo root and `rm -rf` it; Stryker's workers share one sandbox, so parallel `npm test` runs deleted each other's fixtures and random failures counted as kills. Proof: 8 concurrent `npm test` in one directory, 8/8 failed.
- ✅ **Fix (`fix/test-temp-dirs`):** `fs.mkdtempSync(...)` per test file, same location, no assertions changed. After: 3 rounds × 8 concurrent runs, 24/24 passed; 153 tests serially; no leftover `.test-tmp*` folders.
- ✅ **Valid baseline: 56.3% (2210 / 3927)** at `bc19ae6`, 8 workers, 20 m 25 s. `report.js` / `pattern-scanner.js` / `index.js` 0% (no tests; all 185 survived, which is how we know runs are isolated now). Pattern scanners 53–59%; 467 of 730 regex mutants survive. All 37 timeouts read by hand: genuine infinite loops. With the committed config (`index.js` excluded): **56.9% (2210 / 3885)**, per-file counts identical to the run above (deterministic). Ratchet 56.
- ✅ Gate proven both ways: an untested planted rule scored 50.0% on its changed line and failed; with a test written from the rule (which failed without the rule, 21/22) it scored 94.4% and passed. Demo files restored.
- Lessons for mutation runs: keep the Mac awake (`caffeinate -dims`, lid open), add the `progress-append-only` reporter (the default progress bar needs a TTY), and treat any "killed" mutant in a file no test loads as a sign the runs aren't isolated.

## What We Did in Session 7 (2026-10-06)

- ✅ PR #15 merged by the user. Baseline: 8 suites / 102 tests, build OK (`npm ci` was blocked by the agent's permission mode, so this ran on the existing `node_modules`, which contains Finder duplicate folders like `@babel/code-frame 3`; harmless, a clean `npm ci` removes them).
- ✅ `/tmp` targets had been pruned by macOS again; re-cloned into a scratch dir at the demo commits (upstream HEADs are still those commits). Pattern counts matched `public/demo/` exactly. Dependency drift: one new `sprintf-js` advisory (Juice Shop +1 medium production, Express +1 low dev-only).
- ✅ Secret scanning + push protection on, **0 alerts**; Dependabot security updates also enabled, 0 alerts.
- ✅ **ESLint (PR #16, merged by the user):** `eslint.config.js` with `@eslint/js` recommended, `globals` (browser for the dashboard, node for scanner/scripts/tests/configs), `eslint-plugin-react-hooks` 7 (`recommended-latest`), `eslint-plugin-react-refresh` 0.5 (`vite`), plus `eslint-plugin-react` for `jsx-uses-vars` only. Without it, 13 of 17 first-run errors were JSX components reported as unused. Vite's template hides those with `varsIgnorePattern: '^[A-Z_]'`, which would hide real unused capitals too. Stayed on ESLint 9 (10 is out; TODO).
  - Real findings fixed, no rules disabled: severity color constants moved to `severity-styles.js` (Fast Refresh; built CSS byte-identical); dependency-scanner tests now assert error paths return no findings (mutation-checked: fail when an error path returns a finding); unused `catch (error)` bindings in SQLi/XSS (surfaced the silent-skip TODO).
  - CI: `npm run lint` between test and build. Checked it exits 1 on an error.
- ✅ **Insecure crypto scanner (PR #17, merged by the user; live site verified: 18 / 2 / 0 crypto findings, 5 categories checked, HMAC key redacted)**: answer key + candidate counts measured first, then 7 scoring decisions by the user (see the answer-key section). 26 tests, mutation-checked (a stub fails 21/26; each removed rule fails a test). Demo export now also redacts hardcoded-key crypto snippets (test failed against the old export). `Insecure Crypto Usage` moved to `coverage.checked`. Demo data regenerated (Juice Shop 125 → 144, DVNA 70 → 72, Express 64 → 65; nothing removed), screenshots retaken from a local build and checked (light, dark, phone).

- ✅ **Async footgun scanner (`feature/async-scanner`, PR for the user to merge)**: measured first (ground truth above), then 4 scoring decisions by the user. 24 tests: a stub fails 16 of the first 21, 13 mutations each fail a test, and 3 regression tests (chain continued on a new line, deep route context, helpers with extra params) failed against the first implementation, which had a phantom chain in Juice Shop's `datacreator.ts`, a false positive on `basketItems.ts:85`, and DVNA `appHandler.js:175` as low instead of medium. Demo data regenerated (Juice Shop 144 → 160, DVNA 72 → 87, Express 65; only async findings added), screenshots retaken and checked.

## What We Did in Session 6 (2026-10-05)

**Part 3: wrap-up.** PR #14 merged by the user; live site verified serving the new demo totals (125 / 70 / 64). This doc + STATUS refreshed (PR #15).

**Part 2: scanner accuracy (`fix/scanner-accuracy`, PR for the user to merge).** Every fix has tests that were run against the old code first and failed.
- 🔴 **Silent failure fixed:** `npm audit` needs a lockfile. DVNA has none, so audit failed with ENOLOCK, and `{ "error": … }` parsed as "no vulnerabilities" with no error. The demo said DVNA had 0 dependency CVEs; it has **58 (15 critical)**. Express and Juice Shop only worked because their `.npmrc` sets `package-lock=false`. Now: lockfile → audit as is; no lockfile → resolve into a temp dir (target untouched); npm errors → `coverage.errors`.
- **Dependency findings:** installed version from the lockfile (was `@undefined`, a field npm doesn't emit); dev-only (second `--omit=dev` audit) capped at LOW (**user decision**); "Pulled in by <direct dep>"; fix text names the package npm says to change (was "update serialize-javascript to 12.0.3", mocha's version) and says **downgrade** when npm's fix is older (`sequelize` 6 → 3, `csurf` 1.11 → 1.2); cross-major changes flagged even when npm's `isSemVerMajor` is false.
- **Secrets** (Juice Shop 41 → 27; **user decisions** on scoring):
  - Not findings: templated values (`${…}`, `{{ }}`: 14 on Juice Shop), generic matches in translation files (`i18n/`, 513 once JSON keys were matched).
  - Provider formats keep severity anywhere; generic values → LOW for placeholders / low-entropy tokens / test-example-snippet files, → MEDIUM in seed data (`users.yml`: 23).
  - `.test.`/`.spec.` files now scanned for provider formats only (generic there = 162 test passwords on Juice Shop; user chose not to report them).
  - Misses fixed: PKCS#8/encrypted private keys, `glpat-` (pattern had `glpat_`), `gho_`/`ghs_`/`github_pat_`, `ASIA` keys, discord.com webhooks, JSON-quoted keys, new **Secret Key** pattern (DVNA `server.js:24` session secret).
  - `.env` files: unquoted `KEY=value` (key must end in PASSWORD/SECRET/TOKEN/API_KEY…; commented lines count); `.env.example` etc. score as examples. None of the three targets has one.
  - npm errors report code + reason (`code E404 · 404 Not Found …`), never npm's debug-log path (it's in the home directory and would have been published in a demo report's errors).
  - Ids `secret-<file>-<line>[-n]`; entropy/placeholder checks on the value (every password match used to be "likely fake" because the match included the word "password"); `//` in a URL isn't a comment; factors name the whole identifier and never the value.
- **Walker:** skip rules ran on absolute paths (a target under `build/`, `dist/`, or `*.test.*` was skipped entirely) and `/\.git/` also skipped `.github/`. Now target-relative; no change on the three targets.
- Demo data regenerated at the same commits (Juice Shop 138 → 125, DVNA 11 → 70, Express 59 → 64); README/DESIGN/PRD/STATUS updated; screenshots retaken from a local build.

**Part 1: deploy + docs (PR #13, merged).**

- ✅ Baseline matched: 6 suites (5/5, 3/3, 5/5, 21/21, 22/22, 14/14), build OK. Scanner counts match except Juice Shop total 139 vs 138 (see START HERE step 2). The `/tmp` targets had been partly pruned by macOS; re-cloned to get real numbers.
- ✅ Secret scanning + push protection enabled, **0 alerts**.
- ✅ PR #12 merged by the user. **Vercel imported by the user → https://dash-jade-nine.vercel.app/.** Verified live (see step 5). URL added to README + STATUS (Task #6 done).
- ✅ **Task #7 (docs)** on `docs/deploy-readme`: README now has screenshots of the live site (light, dark, expanded finding, phone), "How it works", a results table built from the committed demo data, recall vs the answer keys, known limitations, and talking points. `npm run screenshots` added to regenerate the images.
- ✅ **Corrected an overclaim:** the old pitch said "scanned Express.js, found actual CVEs". Express's 4 advisories are in `diff`, `serialize-javascript`, `uuid`, none of them a direct Express dependency (they come through dev/test tooling). README, STATUS, and the story below now say what was measured; added a TODO for dev vs runtime deps.

## What We Did in Session 5 (2026-10-02)

- **Session 5 in one line:** Task #5 (dashboard polish) shipped, all docs brought up to date, Task #6 deploy prep shipped (redacted demo data for three scans + picker). The user turned on repo secret scanning. PRs #9, #10, #11 were merged by the user; #12 is this wrap-up.
- ✅ Baseline matched session 4 exactly (tests, build, Juice Shop 13 SQLi / 19 XSS / 138, DVNA 1 / 10, Express 0 / 54).
- ✅ **Dashboard Polish (Task #5, PR #9, merged by the user)**:
  - **Dark mode** following the system preference, all components, contrast measured in-browser.
  - **Findings-by-type chart** (`TypeChart.jsx`, plain HTML/CSS) — one bar per type, segmented by severity, legend + totals, hover/focus tooltip, click to filter. Chose stacked bars over the planned pie: the cards already give severity totals, and bars compare better.
  - **Phone layout** — empty Info card hidden (2×2 grid), 3+2 when all five show; severity/type selects side by side; file name no longer breaks mid-word.
  - Tests: `severityByType`, `summarySeverities` (12/12; both checked to fail against broken code).
  - Verified in Chrome on a Juice Shop scan: light + dark × desktop + 390px, no horizontal scroll, keyboard focus shows tooltips.
- ✅ PR #11 (docs): corrected the secret-scanning note. It had been pushed to `feature/deploy` after #10 merged, so it was carried over on a new branch. **Lesson: run `gh pr view <n> --json state` before pushing more to a PR branch.**
- ✅ STATUS.md Overall Progress corrected (said 65% for Phase 1; by tasks it was ~48% before this PR, 62% once it merges).
- ✅ Docs refresh (in PR #9): PRD, DESIGN, README, CONTRIBUTING, STATUS, TPM_STRATEGY, FUTURE_IDEAS now match the build. **PR #9 merged** by the user.
- ✅ **Deploy prep (Task #6, PR #10, merged by the user)**:
  - `scanTarget()` (`src/scanner/report.js`) split out of the CLI. Reports were identical before and after for all three targets.
  - `toDemoReport()` (`src/scanner/demo-export.js`) redacts secret snippets and ids, replaces the `/tmp` path with the repo name, records `source: { repo, commit }`, and throws on leftover key formats. 5 tests, each mutation-checked.
  - `npm run demo:export` → `public/demo/{juice-shop,dvna,express}.json` + `index.json` (≈235 KB). Committed at juice-shop `1618a61`, dvna `9ba473a`, express `7ef9844`. Checked by hand for local paths, personal info, and key formats before committing.
  - Dashboard: a "Demo scan" picker; deployed builds open Juice Shop. Verified in a `vite preview` build for the deploy case, the local-report case, no manifest, and nothing at all, plus 390px.
  - GitHub settings: the user's account-level "Push protection for yourself" was already on. After PR #11, the user also turned on **repo-level secret scanning + push protection** for `dash` (verified via the API; 0 alerts at end of session). Validity checks and non-provider patterns are still off.

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

| Target | Dependency CVEs | Secrets | SQL injection | XSS | Insecure crypto | Async |
|---|---|---|---|---|---|---|
| Express (`/tmp/express`) | 5 (all dev-only → low) | 6 (all `examples/`, low) | 0 (correct — no SQL) | 54 (all low — all in `test/` + `examples/`) | 0 (no crypto sinks) | 0 |
| Juice Shop (`/tmp/juice-shop`) | 67 (3 dev-only → low) | 27 (3 private keys critical, 1 high, 23 seed medium) | 13 (1 critical, 1 high + 11 low snippets) | 19 (5 high, 8 medium + 6 low snippets) | 18 (5 high, 7 medium, 6 low) | 16 (1 medium, 15 low) |
| DVNA (`/tmp/dvna`) | 58 (15 critical; all runtime) | 1 (session secret, high) | 1 (critical) | 10 (medium) | 2 (high) | 15 (8 high, 7 medium) |

*(Updated session 7 with the crypto + async scanners; dependency counts drift because no target commits a lockfile.)*

### Async footgun ground truth (session 7)

Neither target publishes async bugs as challenges, so every hit was read by hand at the demo commits.

| Target | What's there | Scanner |
|---|---|---|
| DVNA (Express 4, `node:carbon`) | 15 Sequelize promise chains with no `.catch()`: 11 in route handlers (`core/appHandler.js`, `core/authHandler.js`), 4 in passport callbacks. A DB error or a `TypeError` inside `.then` (e.g. `user` null in `userEditSubmit`) is unhandled. Node ≥ 15 exits; Node 8 hangs the request. | 15: 8 high (`req.*` feeds the query), 7 medium |
| Juice Shop (Express 4, Node 22–26) | 45 async `(req, res)` handlers; 21 have an `await` outside try/catch, **all 21 registered via `utils.asyncHandler()`** in `server.ts` (`Promise.resolve(fn(…)).catch(next)`), checked one by one | 0 (a rule ignoring the wrapper: 21 false positives) |
| Juice Shop | `async function quantityCheck(req, res, next, id, quantity)` (`basketItems.ts:85`) is a helper, not a handler | 0 (only `(req, res[, next])` signatures count) |
| Juice Shop | Chains with no `.catch()`: 10 browser (`import('…').then`, `firstValueFrom(…).then`, `timeout().then`), `routes/search.ts:47` (`void` query in a route handler, medium), `routes/verify.ts:218` (`void osaft.reload().then`, challenge check, low), 4 in `test/cypress/support/commands.ts` (low; `cy.request().then` isn't a real promise, so these are noise) | 16: 1 medium, 15 low |
| Express | none | 0 |
| All | `forEach(async)`, `new Promise(async)`, async timers, async `.on()` listeners: 0 hits | unit tests only |

**User decisions (session 7):** chains → medium in route handlers / auth callbacks, high when `req.*` feeds the promise, low elsewhere and in the browser; `void` / `import()` still reported with a "looks deliberate" factor; unwrapped async handler → high (suppressed when wrapped, Express 5, or `express-async-errors`); the 0-hit callback patterns → medium server / low browser.
**Agent choices (tell the user if challenged):** a handler whose registration can't be found is still reported high, at confidence 0.5, with a factor saying so; any wrapper call at registration counts as wrapping (not just names like `asyncHandler`).

### Insecure crypto answer key + recall (session 7)

Measured at the demo commits with a prototype run through the scanner's own walker (`walkDir` + `toStatements`, comments skipped). Juice Shop's crypto challenges come from `data/static/challenges.yml`; DVNA's from `docs/solution/a2-broken-auth.md`.

| Challenge | Sink | Found | Severity |
|---|---|---|---|
| Password Strength (`weakPasswordChallenge`) + Weird Crypto ("md5") | `lib/insecurity.ts:41` `hash = createHash('md5')`; vuln-line `models/user.ts:73` `security.hash(clearTextPassword)` | ✅ at the helper (factor lists the 6 password callers: `user.ts:73`, `login.ts:34`, `changePassword.ts:39`, `:54`, `2fa.ts:107`, `:152`) | high |
| Imaginary Challenge + Weird Crypto ("hashids") | `routes/continueCode.ts:13/25/38`, `routes/restoreProgress.ts:18/42/62` | ✅ 6 | medium |
| Unsigned JWT, Forged Signed JWT | vulnerable `jsonwebtoken` 0.4.0 / `express-jwt` 0.1.3 / `jws` (dependency scanner) + `lib/insecurity.ts:52` `expressJwt({ secret: publicKey })`, `:189` `jwt.verify(token, publicKey, cb)` | ✅ | high |
| Forged Coupon + Weird Crypto ("z85") | `lib/insecurity.ts:99/106` z85 coupon encode/decode | ❌ by choice (user decision: an encoder alone doesn't say it protects anything) | — |
| (no challenge) security-answer HMAC with a literal key | `lib/insecurity.ts:42` — the secrets scanner misses it | ✅ | high |
| Nested Easter Egg, Premium Paywall | ciphertext / key files, not code | out of scope | — |
| DVNA reset token = `md5(login)` | `core/authHandler.js:49`, `:78` | ✅ 2 | high |

**Recall: 5/6 code-level Juice Shop challenges, DVNA 1/1. Express: 0 crypto sinks, 0 findings** (`examples/auth` uses `pbkdf2-password`, correctly not flagged).
Other Juice Shop findings: `insecurity.ts:53` `denyAll` (`expressJwt({ secret: '' + Math.random() })`, one merged finding, medium), `routes/verify.ts:125` (challenge-check `jwt.verify` with the public key, high), `routes/captcha.ts:14-19` (5 × low: captcha operands), `scripts/package.mjs:121` (MD5 release checksum, low).
Not reported (by rule): 15 other `Math.random()` hits (9 vendored `three.js`, 4 seed data, shuffle / UI ids), `utils.ts:80` HMAC-SHA1 (not broken), 7 non-password `security.hash()` callers (order ids, email hashes).

**User decisions (session 7):** weak-hash helpers scored by tracing callers (one finding at the helper); `Math.random()` only in security context (medium when the line names a secret/token/…, low when only the function or file name does); JWT without `algorithms` → medium, high with a public key; Hashids literal salt → medium, z85 not flagged; literal HMAC/cipher key → high; `createCipher` and DES/RC4/ECB → high; one finding per line (merged, highest severity).
**Extrapolated by the agent (0 hits on the targets; tell the user if challenged):** `jwt.sign` with algorithm `none` / `algorithms` allowing `none` → high; a literal secret passed to `jwt.sign`/`jwt.verify`/express-jwt → high (same rule as the literal HMAC key).

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
Week 1 Scanner   █████████████████████████████░░░  90% ✅  (deps ✅ secrets ✅ SQLi ✅ XSS ✅ merged | crypto ✅ PR #17 | async ✅ PR open)
Week 2 Dashboard ████████████████████████████████ 100% ✅  (core ✅ PR #7 | polish ✅ PR #9)
Week 3 Deploy    ████████████████░░░░░░░░░░░░░░░░  50% 🟡  (demo data + picker ✅ PR #10 | Vercel import ⏳ user | README/demo ⏳)
```

| Task | Status | Where |
|---|---|---|
| #1 Dependency scanner | ✅ Merged to `main` (PR #1) | `src/scanner/dependency-scanner.js`, `npm-audit-client.js` |
| #2.1 Hardcoded secrets | ✅ Merged to `main` (PR #2) | `src/scanner/patterns/hardcoded-secrets.js` |
| #2.2 SQL injection | ✅ Merged to `main` (PR #2) | `src/scanner/patterns/sql-injection.js` |
| #2.3 XSS | ✅ Merged to `main` (PR #2) — see TODOs | `src/scanner/patterns/xss.js` |
| #2.4 Insecure crypto | ✅ Merged to `main` (PR #17) | `src/scanner/patterns/insecure-crypto.js` |
| #2.5 Async footguns | ✅ PR open (session 7) | `src/scanner/patterns/async-footguns.js` |
| #4 Dashboard Core | ✅ Merged to `main` (PR #7) | `src/App.jsx`, `src/pages/Dashboard.jsx`, `src/components/`, `src/utils/findings.js` |
| #5 Dashboard Polish | ✅ Merged to `main` (PR #9) | `src/components/TypeChart.jsx`, `SummaryCards.jsx`, `dark:` variants throughout |
| #6 Deploy (Vercel) | 🟡 Demo data + picker merged (PR #10) → user imports in Vercel | `scripts/export-demo.js`, `src/scanner/demo-export.js`, `public/demo/` |
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
- [x] **Secret finding ids aren't unique.** Fixed (session 6): `secret-<file>-<line>`, `-2`… for more on one line.
- [x] **Dependency findings don't separate dev from runtime dependencies.** Fixed (session 6): second `npm audit --omit=dev`; dev-only capped at LOW (user decision). Express's 4 are all dev-only.
- [x] **Dependency findings show `@undefined` version.** Fixed (session 6): versions from the lockfile (v1–v3).
- [x] **Secret findings have 1 context factor**, and flag Terraform interpolations. Fixed (session 6): 3–5 factors, templated values skipped.
- [x] **`npm audit` failures read as zero findings.** Fixed (session 6): DVNA showed 0 dependency CVEs (ENOLOCK); errors now reported, no-lockfile targets resolved in a temp dir.
- [ ] **Dependency results drift without a lockfile.** None of the three targets commits one, so each scan resolves today's versions. The factor says so; nothing else to do unless we pin by committing resolved lockfiles for the demo targets.
- [ ] **The dependency-scanner test calls the real npm registry, and passes when it's offline** ("skipped, npm registry unreachable"). A green run can mean the test never checked anything, and every mutation-test run hits the registry (~4,000 times per baseline). Should use a recorded `npm audit` response (fake only the boundary).
- [ ] **Dependencies: yarn.lock / pnpm-lock.yaml targets** are audited from a freshly resolved npm lockfile (with a factor saying so), not their real lockfile.
- [x] **`npm run lint` is broken.** Fixed (session 7): `eslint.config.js` (flat), lint step in CI.
- [ ] **Pattern scanners skip unreadable files silently** (secrets, SQLi, XSS, crypto, async: `catch { continue }`). Coverage claims the file was checked. Should go to `coverage.errors` like npm failures. Found via ESLint's unused `error` bindings.
- [ ] **ESLint 10 is out** (10.12.0 on 2026-10-06). We stay on 9 for now; 10 tracks JSX references in core `no-unused-vars`, so `eslint-plugin-react` (used only for `jsx-uses-vars`) could be dropped after upgrading.
- [ ] **Crypto: z85 / base64 "encryption" not detected** (Juice Shop Forged Coupon). Left out by user decision; revisit if a generic signal appears (e.g. an encoded value compared for authorization).
- [ ] **Crypto: hardcoded IVs aren't flagged** (`createCipheriv(alg, key, 'literal')`). Only literal keys are. Needs a severity call from the user.
- [ ] **Crypto: "enclosing function" is the nearest named function within 15 lines above**, not a parsed scope. Fine on the three targets (three.js `generateUUID` is out of reach, as intended), but a sibling function's name can leak into the next one.
- [ ] **Async: unawaited calls to local async functions aren't detected.** Juice Shop `routes/basketItems.ts:75` `void quantityCheck(...)` has no `.catch()` (line 60 does). Needs a "call to a known-async function as a statement" rule plus a severity call.
- [ ] **Async: Cypress `cy.*().then()` chains are reported** (4 low in Juice Shop `test/cypress/`). Cypress chainables aren't promises. Could skip `cy.` heads.
- [ ] **Async: wrapper detection accepts any call around the handler at registration** (`rateLimit(handler())` would count as wrapped), and follows names, not imports.
- [ ] **Crypto: helper tracing matches callers by name in files that import the helper's module** (basename match). A re-export through an index file isn't followed.
- [x] **Deploy needs committed demo data.** Done (PR #10, merged): all three scans under `public/demo/`, generated by `npm run demo:export` with secret snippets redacted, and a picker in the dashboard.
- [ ] **Demo data is a snapshot.** It's pinned to the target commits above, so it won't change when the scanners improve. Re-run `npm run demo:export` after scanner changes and commit the diff (last regenerated session 6, after the accuracy fixes).
- [x] **PRD.md / DESIGN.md were partly stale.** Fixed in session 5 (PR #9). PRD checkboxes now match the build, with italic notes where it differs; DESIGN describes the scoring model and dashboard as built and marks *(not built)* ideas; README, CONTRIBUTING (everything goes through PRs; task numbers, not issues), TPM_STRATEGY, and FUTURE_IDEAS refreshed; the original brief (`security-audit-platform-overview.md`) is kept as-is with a "what changed" note.
- [x] **Hardcoded-secret noise on Juice Shop.** Fixed (session 6): 41 → 27. The 23 left in `data/static/users.yml` are real seed passwords, now MEDIUM; `lib/insecurity.ts` private key is a real (planted) true positive.

---

---

## How the Pattern Scanners Work (copy this shape for crypto / async)

Each scanner in `src/scanner/patterns/` exports `async scanForX(targetPath)` returning findings matching the schema in PRD.md §3:

1. `walkDir(targetPath)` returns files already filtered by `shouldSkipFile` (target-relative; `{ includeTests: true }` to keep `.test.`/`.spec.` files) → skip non-`isSourceFile` files
2. `toStatements(lines)` → iterate logical statements (multi-line safe); skip statements starting with `//` or `*`
3. `PATTERNS` array: `{ name, regex (global), sqlText/extractor, detected, description }`; reset `regex.lastIndex` before each use
4. Filter matches with a "does this really look like X" check (SQL: `looksLikeSql`) to keep false positives down
5. `assessContext(lines, statement, …)` → `{ factors, severity, confidence }`; look back `CONTEXT_WINDOW = 15` lines for user input / route handlers / mitigations; shift severity along `['low','medium','high','critical']`
6. Finding fields: `id`, `type` (`'xss'` for XSS — already counted in `index.js` coverage), `title`, `severity`, `confidence` (0.1–0.95), `description`, `file`, `line` (1-based statement start), `snippet` (whitespace-collapsed, ≤120 chars), `context` (3+ factors, ✓/⚠/? prefixes), `remediation` (actionable, with example), `references` (OWASP), `tags`
7. Wire into `src/scanner/pattern-scanner.js` inside its own try/catch

Tests: plain Node scripts (no framework), run with `node src/scanner/__tests__/<name>.test.js`; each writes fixtures to a tmp dir, prints ✓/✗, exits non-zero on failure. Note `.test.`/`.spec.` files are skipped by the walker (except for the secrets scanner, provider formats only), so SQLi/XSS fixtures must use other names.

---

## Context for Next Agent/Session

### Core Loop (Protected)
```
Scanner → JSON → Dashboard
```
Don't add features that break this. This is the heart.

### Interview Story (30 seconds)
> "I built a real security scanner with contextual scoring. Not just 'vuln found'—I score exploitability based on multiple factors (input sanitized? endpoint public?). This shows threat modeling. I checked it against two intentionally vulnerable apps with known answers (SQL injection 3/3, XSS 8/9 + 3/3) and built a dashboard that explains each score."

Fuller talking points are in README.md → Talking Points.

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
├── dependency-scanner.js     ← Task #1: package.json checks, then runNpmAudit + parseAuditResults
├── npm-audit-client.js       ← Task #1: lockfile or temp-resolved audit, --omit=dev pass, versions, fix text
├── pattern-scanner.js        ← runs each pattern scanner
├── file-utils.js             ← shared: walkDir, skip rules, toStatements, USER_INPUT, ROUTE_HANDLER
├── patterns/
│   ├── hardcoded-secrets.js  ← Task #2.1
│   ├── sql-injection.js      ← Task #2.2
│   ├── xss.js                ← Task #2.3
│   ├── insecure-crypto.js    ← Task #2.4 (two passes: sites, then weak-hash helpers scored by their callers)
│   └── async-footguns.js     ← Task #2.5 (masks strings/comments; chains, handlers + their registrations, dropped callbacks)
└── __tests__/
    ├── demo-export.test.js
    ├── dependency-scanner.test.js   (no-lockfile case needs the npm registry)
    ├── file-utils.test.js
    ├── hardcoded-secrets.test.js
    ├── npm-audit-client.test.js     (fixtures copied from real npm 11 output)
    ├── sql-injection.test.js
    ├── xss.test.js
    ├── insecure-crypto.test.js
    └── async-footguns.test.js
```
`scripts/export-demo.js` (`npm run demo:export`) regenerates `public/demo/`. Dashboard files: see "Dashboard map" in START HERE.

## Key Documents

| Document | Purpose |
|----------|---------|
| `docs/ENGINEERING_PROCESS.md` | Team gates, test rules, mutation testing, score log (session 8) |
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
