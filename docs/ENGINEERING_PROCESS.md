# Engineering process: team gates

dash is built by one person directing an AI coding agent. A persona prompt ("you are a senior security engineer") doesn't add expertise. A team works because the reviewer didn't write the code, checks happen at fixed moments, and rules are enforced by machines. dash copies that structure. Each role is a **gate**: a moment, a mechanism, and what it blocks.

| Role | Gate (when) | Mechanism | Blocks |
|---|---|---|---|
| TPM | Start of every session | `HANDOFF.md` ("▶ START HERE"), `STATUS.md`, `PRD.md` | Scope creep, lost decisions, starting on a stale baseline |
| Architect | Before a new scanner, a new data source, or a report-format change | A design note (below), then the `architect` agent (`.claude/agents/architect.md`) challenges it with fresh context | Choices that are expensive to undo; scanners with no answer key |
| Reviewer | Before every PR is opened | The `reviewer` agent (fresh context, didn't write the code): correctness against the PRD, DESIGN scoring model and answer keys, then a **separate test audit** | Bugs, and tests that test nothing |
| QA | Every push and PR | CI `test`: `npm test`, `npm run lint`, `npm run build`. On PRs, `mutation-changed`: changed lines must catch 80% of planted bugs, and the ratchet can't drop (below). `answer-keys`: fresh scans of Juice Shop, DVNA and Express at the pinned commits must match `answer-keys/*.json` (design: `docs/design-notes/answer-key-test.md`) | Regressions, weak tests, lost recall or moved severities |
| Security | Before anything is published | Demo export redacts secrets and refuses key formats; secret scanning + push protection on the repo; no local paths in reports or docs | Leaked keys or paths on a public repo and live site |
| The user | Every severity/scoring rule, and every merge | Decides each scoring trade-off from real counts; reads the test **names** (`npm test` prints them as rules) | A scanner that's correct in code but wrong about risk |

**What blocks a merge.** `main` has a ruleset: a PR is required (squash only), and the `test` check must pass. The mutation job runs on every PR and `answer-keys` on every PR and push to `main`; neither is a required check yet (adding them is a repo-settings change the user makes).

## Design note (architect gate)
Half a page, in the PR description or `docs/`: **problem → options (2–3) → choice and why → how recall and noise will be measured on the three targets → what breaks → what could leak**. The `architect` agent reviews it before code is written.

## Good tests, not just tests
Tests are only worth relying on if a broken rule makes one fail. These rules make that checkable:

1. **Expected values come from the spec, not the code.** Work the answer out from PRD/DESIGN or the answer key by hand ("`req.body` on the query line inside a route handler → CRITICAL"). Never run the scanner and paste its output into the assertion. That just records today's behavior, bugs included.
2. **Every test is seen failing once.** Break the rule in the code, watch the test go red, then put the code back. The mutation run does this at scale.
3. **Assert the exact value.** The severity, the factor text, the line number. Not "found something".
4. **One rule per test, named as the rule** ("Constant interpolation → low"). The test list then reads as the scoring model, so it can be reviewed without reading code.
5. **No snapshots.** Never compare a whole report or findings array against pasted output: it kills mutants (raising the score) while locking in today's bugs. Assert the one value the rule is about.
6. **Fake only the boundaries.** The npm registry gets a recorded real response. Never mock the scanner, the scoring helpers, or the file walker under test.
7. **Isolated.** Each test run gets its own temp folder (`fs.mkdtempSync`). Mutation testing runs the suite in parallel in one directory, so shared paths turn into random failures (see the score log).

### The machine check: mutation testing
`npm run mutate` (Stryker, command runner over `npm test`) plants thousands of small bugs in `src/scanner/` and `src/utils/` (flips `>` to `>=`, drops a regex anchor, empties a string, forces a condition true), one at a time, and runs the tests against each. A bug that no test catches **survives**. The **mutation score** is the share caught. Line coverage only says code *ran*. This says the tests would *notice* if it broke. For a scanner this matters more than usual: a detection regex that quietly stops matching doesn't crash anything, it just reports fewer findings, and a lower count looks like a cleaner codebase.

- Scope: `src/scanner/**` and `src/utils/**`, minus tests. `src/scanner/index.js` is excluded: it's the CLI wrapper (argument check, write the file, print the summary), and the logic it calls is in `report.js`.
- Report: `out/mutation.html` (survivors shown inline in the code). Run time: about 20 minutes locally with 8 workers.
- **New code bar:** `npm run mutate:changed` mutates only the `src/scanner/` and `src/utils/` lines the branch changed. CI fails the PR if **under 80%** of those planted bugs are caught. A changed line counts in full, so touching a weakly tested line means owning its old gaps too.
- **Ratchet:** the whole-project run is slow, so it runs after merge, on `main`, and turns `main` red if the score drops below `thresholds.break` in `stryker.config.json`. PRs stay fast: they only mutate changed lines. Raise it when the score goes up. Never lower it to make a PR pass. CI fails any PR that lowers it.
- **Survivors that change nothing:** skip them in the code with `// Stryker disable next-line <Mutator>: <reason>`. The reviewer checks every reason.
- Not every survivor is a real gap (emptying a description string changes nothing a test should care about). The reviewer decides which survivors matter.
- **Running it locally:** keep the machine awake (`caffeinate -dims` on macOS, lid open). A sleep mid-run turns in-flight test runs into timeouts, and Stryker counts timeouts as caught. For the same reason `timeoutMS` is 20 s: a test run slowed by load must not count as a caught bug. Read every Timeout before trusting a score: emptying a label or message string can't loop forever, but emptying a regex source or its `'g'` flag inside a `while (re.exec(...))` loop can (7 of the 38 timeouts on 2026-10-07 were that, all genuine). Plant any timeout you can't explain and run `npm test` with a time limit.
- **No network in `npm test`:** the npm registry is a recorded boundary (`src/scanner/__tests__/helpers/`). A live-registry check runs only with `LIVE_NPM=1`.

### Proof the gate works (2026-10-06)
A deliberately weak change: a new rule treating `config.UPPER_CASE` values as SQL constants, with no test. `npm run mutate:changed` scored the changed line **50.0%** (9 of 18) and failed. Then a test written from the rule (7 inputs, expected severities worked out by hand) was added; it failed without the rule (21/22) and passed with it. The gate then scored **94.4%** (17 of 18) and passed. A comment-only change has no mutants and passes. Both files were restored afterwards; the rule was only a demo.

## Score log

| Date | Score | Note |
|---|---|---|
| 2026-10-06 | ~~95.5%~~ | **Invalid.** The Mac slept mid-run: 138 timeouts bunched in three consecutive files, all 42 `index.js` mutants "timed out" although no test loads `index.js` |
| 2026-10-06 | ~~96.8%~~ | **Invalid.** Kept awake, but 38 `index.js` mutants were "killed". Cause: seven test files shared fixed temp folders, and Stryker's workers share one sandbox, so parallel runs deleted each other's fixtures. 8 concurrent `npm test` runs: 8/8 failed. Fixed in PR #20 (unique temp dirs; 24/24 parallel runs pass) |
| 2026-10-06 | 56.3% (2210 / 3927) | First valid baseline, `index.js` included. All 185 mutants in the three untested files survived, as they should. `report.js`, `pattern-scanner.js` 0% (no tests); the five pattern scanners 53–59%; in them, 467 of 730 regex mutants (64%) survive |
| 2026-10-06 | **56.9% (2210 / 3885)** | Same run with the committed config (`index.js` excluded). Per-file counts identical to the previous row, so runs are deterministic now. Ratchet (`thresholds.break`) set to 56 |
| 2026-10-06 | 56.91% (2211 / 3885) | First `mutation-full` on `main` in CI (4 workers, 44 m 57 s). One mutant differs from the local run; not identified yet |
| 2026-10-06 | ~~61.1%~~ | **Invalid.** After the report tests (B1): timeouts 37 → 89, and some can't be real (an emptied label string "timed out"; `npm test` passes with it in 1.7 s). Slow runs under 8 workers hit Stryker's ~8 s limit, and timeouts count as caught. A hand check also found one false kill in the baseline (live registry test). Fixed: recorded npm instead of the live registry; `timeoutMS: 20000`. Before and after re-measured with the same settings on 2026-10-07 (below) |
| 2026-10-07 | 56.89% (2210 / 3885) | **Before**, re-measured at `53a1708` (main before the report tests) with `timeoutMS` 20000: 2174 killed / 36 timeout / 1675 survived, 8 workers, 19 m 20 s. The `npm-audit-client.js:153` false kill seen in the earlier baseline did not recur (it survives here, as it does when planted by hand) |
| 2026-10-07 | **60.55% (2350 / 3881)** | **After** the report and pattern-scanner tests plus the recorded npm (PR #22, `2ae40a6`), same settings: 2312 killed / 38 timeout / 1531 survived / 15 ignored, 13 m 16 s. `report.js` 0% → 96.6%, `pattern-scanner.js` 0% → 73.7%, `npm-audit-client.js` 62.5% → 64.3%. No mutant went from killed to survived. The 15 ignored are the `// Stryker disable` lines (8 of them survived before); counted as survivors the score is 60.32% (2350 / 3896). All 38 timeouts checked: 35 read by hand as genuine infinite loops, the other 3 (`xss.js:85`, two at `xss.js:115`) planted by hand, and `npm test` was still running at 60 s (normally about 2 s). Ratchet raised to 60 |
| 2026-10-07 | 60.58% (2351 / 3881) | `mutation-full` on `main` in CI after PR #22 (4 workers, **23 m 15 s**, down from 44 m 57 s: no network in `npm test` any more): 2313 killed / 38 timeout / 1530 survived / 15 ignored. Passes the ratchet (60). Differs from the local run by 1 mutant, identified from the uploaded JSON: `npm-audit-client.js:63` `'scan-audit-'` → `""`. With an empty prefix `mkdtemp` creates a folder next to the temp dir rather than inside it: on macOS that succeeds (checked), on the Linux runner it means `/tmpXXXXXX` in `/`, which a non-root user can't create, so the scan fails and the mutant counts as killed. A platform difference, not flakiness; no test checks where the temp folder goes. The 1-mutant gap at `53a1708` is probably the same mutant (it survived locally there too), but that CI run uploaded no JSON to confirm |
