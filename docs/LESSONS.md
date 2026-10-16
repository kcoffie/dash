# Lessons learned: AI-built code with machine-enforced gates

Portable. Copy this file into another project next to its engineering rules. Every lesson is a rule plus the incident that taught it (from `dash`, 18 sessions, 2026-09/10). Tool names are examples: the failure modes apply to any mutation tester, CI system or agent setup.

## 1. Measuring whether tests test anything

1. **Line coverage isn't evidence; mutation score is.** Plant small bugs (flip `>`, empty a string, force a condition) and count how many a test catches. Claude-written tests in a sister project caught 49.6% of planted bugs while "covering" the code. For a detector (scanner, validator, linter), weak tests mean silent regressions: a broken rule doesn't crash, it just reports fewer findings, which looks like a cleaner codebase.
2. **Distrust a score until you've explained it.** Three early scores here were invalid, each higher than the truth:
   - the machine slept mid-run, so in-flight test runs timed out, and timeouts count as caught (95.5%);
   - test files shared fixed temp folders, and parallel workers deleted each other's fixtures, so unrelated mutants were "killed" (96.8%);
   - load made slow runs hit the timeout (61.1%).
   Real baseline: 56.9%. Rules that came from this: keep the machine awake, unique temp dirs per test, a generous per-test timeout, and **read every timeout** (most are fake; a few are genuine infinite loops).
3. **No network in the test suite.** A test against a live registry gave a false kill and passes "skipped" when offline. Record the boundary (fixtures, a fake binary) and keep live checks behind an opt-in flag.
4. **Compare runs mutant by mutant, not by total.** When changing the test runner, the score stayed equal while 2 mutants changed status; only a per-mutant diff (file + start + end + mutator + replacement) found them, and each was planted by hand to explain it.
5. **One CI run is not a trend.** The same code took 10 m 50 s to 24 m 52 s on hosted runners. A 2× local speed-up never showed on CI. Record every run's time; claim nothing from one.
6. **Gate new code, ratchet the total.** PRs must catch ≥ 80% of planted bugs *on the lines they change* (fast); the whole-project score runs after merge and may never drop below a threshold that only goes up. A changed line counts in full, so touching weakly tested code means owning its gaps.

## 2. Gates fail open in surprising ways: make every one fail closed

Each item below is a real way a passing check meant nothing.

1. **"Nothing to check" must not mean "pass".** The mutation tool scores NaN and exits 0 when its file patterns match nothing (glob characters in a path, an ignored folder). Fix: compare its own "found N files" line with what you expected, and fail on any mismatch.
2. **A missing or unreadable input is a failure, never a default.** A ratchet that couldn't read the base config, or read `null`, passed. Fail when either side can't be read or parsed.
3. **Resolve refs exactly.** `origin/main` can resolve to a *tag* named `origin/main` (git checks tags first). Use `git show-ref --verify refs/remotes/origin/main`.
4. **Name config files explicitly.** With no file named, the tool picked `stryker.conf.json` before `stryker.config.json`, so a PR could add a second config with a lower threshold that the ratchet never read.
5. **Never launch tools through a registry fallback.** `npx tool` installs and runs whatever package has that name when the local binary is missing, with no prompt in CI. Run `node_modules/.bin/tool` and fail if it's absent.
6. **The PR controls its own config and arguments.** Allowlist what a PR may change (reporters, concurrency, raising thresholds) and fail anything else. `dryRunOnly: true` or `--dryRunOnly` passed with zero mutants tested. Check the tool's source before calling a key harmless: two "output file name" options were actually ignore globs.
7. **On `pull_request`, CI runs the PR's own workflow and scripts.** A PR can weaken its gate by editing the gate. Running base-branch copies from inside that workflow doesn't help (the PR edits the workflow too). `pull_request_target` reads the workflow from the **default branch** (measured: on any other base branch it never runs), so it can run main's gate scripts against the PR checkout. It's a known footgun, so:
   - read-only token, no secrets, no cache, `persist-credentials: false`, install with scripts off, no `npm run` (the PR's `package.json`/`.npmrc` would apply);
   - on a public repo it runs **fork PRs without approval**: fail forks on the first step, before fetching their code;
   - **fail, don't skip**: a job skipped by `if:` counts as *passed* for a required check;
   - install the PR's dependencies **before** the gate's (a PR's `node_modules` symlink emptied the gate's install);
   - the PR's tests still run with full access to the runner: test-level cheating stays a reviewer job.
8. **Verify required checks in the settings API, not the docs.** Docs said three checks were required; the ruleset required one. Check `gh api repos/<o>/<r>/rules/branches/main` after every change.
9. **For security-critical config, test the exact text.** Rule-by-rule tests of a workflow file missed 10 plausible unsafe edits. Compare the whole file with a reviewed copy instead, and require plain ASCII: YAML also breaks lines at a bare CR, so a CR inside a "comment" hid a real `continue-on-error: true`.
10. **Re-check a skip rule's precondition.** Skipping the slow job on docs-only pushes also requires the previous run to have *passed*, or a red score turns green on the next docs commit. A crash or hang of the decision step must mean "run".

## 3. Working with AI agents

1. **Acceptance criteria before code, approved by a human.** Draft Given/When/Then, list out-of-scope items, ask. Several designs changed at this step (staging, fail vs skip for forks).
2. **See every new test fail first, for the right reason.** Record the failing counts in the commit message ("e2e 36/54, all from the PR's binary being used").
3. **A fresh-context reviewer before every PR, in a detached worktree.** It didn't write the code, so it reviews against the spec. It found real holes in almost every PR here, including in the gates themselves. **Reproduce each finding yourself before fixing it**, and plant regressions to prove the new tests catch them.
4. **Sandbox the reviewer.** Agents make mistakes too: one cleared the user's real package cache with a global clean command. Give it a scratch dir and say what's off-limits.
5. **Humans make the judgment calls.** Severity, scoring thresholds, repo settings, account actions, merges: the agent asks, every time; approval doesn't carry over to the next action.
6. **Real numbers or no numbers.** Every count in docs or a recommendation comes from data just checked (re-count before offering options). One line per option with its count, then a recommendation; the human picks.
7. **Report honestly, including your own mistakes.** Say what was run, what passed, what wasn't verified, and what went wrong (e.g. a pushed commit with conflict markers, fixed forward, not force-pushed).
8. **Experiments before designs.** A 10-minute throwaway PR settled a question (where `pull_request_target` reads its workflow) that would otherwise have shipped as an assumption. Close it, delete its branches.

## 4. Session handoff for agents

- Keep a `HANDOFF.md` with a **START HERE** section: where we are, a numbered **NEXT** list, the rescan/setup recipe, and per-session **gotchas**. The next agent starts cold; this is its memory.
- A `STATUS.md` one-screen summary and a score log table (date, score, counts, run id, what changed, run time).
- Put docs-only edits (TODO ticks, NEXT lists, score rows) on a separate session-docs branch: feature PRs editing the same lines conflict.
- Commit and push after each step.

## 5. Tooling traps (macOS + zsh + GitHub, each cost real time)

- Git worktrees share refs with the main checkout: an experiment that set `refs/remotes/origin/main` in a worktree moved the real one. Use a scratch `git clone --no-hardlinks` for anything that sets refs.
- A command after a heredoc runs even if the steps before failed (separate statement): chain dependent steps with `&&` after the heredoc's terminator.
- Piping a test into `| head` can kill it on a broken pipe before its cleanup runs. Redirect to a file and read that; save every test run's output.
- Check `uptime` and `ps` before timing anything: orphaned test processes burned cores for days; Spotlight indexing a fresh `node_modules` pushed load to 24.
- macOS prunes old files in `/tmp`: a half-pruned clone scans "fine" with junk counts. Re-clone pinned commits into a scratch dir.
- zsh doesn't word-split `$var` and aborts on unmatched globs; BSD `sed -i ''`, `seq -f` and friends differ from GNU. Use `bash -c` for loops written for bash.
- `gh api …/jobs/<id>/logs` needs `--allow-escape-sequences`; strip ANSI codes before comparing tables.
