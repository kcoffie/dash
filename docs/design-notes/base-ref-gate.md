# Design note: the mutation gate runs main's gate code (base-ref gate)

Status: PR 1 of 2 (informational check `mutation-gate`). User decisions 2026-10-16 (session 18): approach A, staging, acceptance criteria below.

## Problem
`mutation-changed` runs on `pull_request`, and GitHub runs the PR's own copy of the workflow for that event. The job then runs the PR's `scripts/ratchet-check.js`, `scripts/mutate-changed.js` (`BAR = 80`) and, through Stryker, the PR's `scripts/run-tests.js`. A PR can weaken its own gate by editing any of them (or the workflow). It shows in the diff; nothing stops it. PR #47 closed the config and pass-through-args routes; this is the route left (Open TODO "A PR's gates run the PR's own gate code").

Running base-ref copies from inside `test.yml` doesn't help: the PR can edit `test.yml` too.

## Decision
A second workflow, `.github/workflows/gate.yml`, on `pull_request_target`. GitHub reads that workflow from the **default branch** whatever the PR changes or targets (measured on throwaway PR #49: a `pull_request_target` workflow on a non-default base branch never ran; GitHub change of 2025-11-07). It checks out main into `gate/` and the PR head into `pr/`, and runs `gate/`'s scripts with `pr/` as the working directory:
- `mutate-changed.js` launches Stryker from its own install (`<gate>/node_modules/.bin/stryker`), not the working directory's, since the PR controls `pr/`'s lockfile.
- The generated Stryker config's `commandRunner.command` is `node '<gate>/scripts/run-tests.js'` (shell-quoted; Stryker runs it with `/bin/sh`).
- Locally (`npm run mutate:changed`) gate and checkout are the same repo: same Stryker, same runner, same result.

The PR's code still runs (its src and tests are what's measured), so the job is built for untrusted code: `permissions: contents: read`, no secrets, no setup-node cache (`package-manager-cache: false`), `persist-credentials: false`, `npm ci --ignore-scripts` (no lifecycle scripts), a PR `.npmrc` moved aside, no `npm run`. The PR's install runs **before** main's: a PR whose `node_modules` is a symlink to `../gate/node_modules`, or whose `package.json` has a `../gate` workspace, made its `npm ci` empty the gate's install (reviewer; reproduced with npm 11.19.1), so main's runs last and wins.

**PRs from forks fail on the first step**, before any PR code is fetched (user decision 2026-10-16). The repo is public, and GitHub runs `pull_request_target` "regardless of approval settings", so without it any fork could run its test code here unapproved. Fail, not skip: a skipped job counts as passed for a required check. The head repo reaches the shell through `env`, not `${{ }}` in `run`.

Every line of `gate.yml` (comments aside) must equal a reviewed copy in `scripts/__tests__/gate-workflow.test.js`: rule-by-rule text checks missed plausible unsafe edits (reviewer: a fork `repository:`, a command after `||`, `continue-on-error`, a quoted `uses:`, `secrets[...]`, `${{ }}` in `run`). The file must also be plain printable ASCII: YAML breaks lines at a bare CR (YAML 1.1 also at NEL, LS, PS), so a CR inside a comment line hid a real `continue-on-error: true` from the comparison (reviewer, reproduced). That test runs in the PR's own `test` job, so it makes a change visible and reviewed; it doesn't enforce anything alone.

## Not building
- Making `mutation-gate` required and removing `mutation-changed`: PR 2, after measuring on `main` (ruleset change, user's OK).
- Ruleset "required workflows": documented for org/enterprise rulesets only.
- Stopping the PR's tests from cheating: mutation testing must run the PR's tests, and they run as the runner user (with sudo), so they can do anything on the runner: fail only while `__STRYKER_ACTIVE_MUTANT__` is set, or overwrite main's files in `gate/` (e.g. `gate/scripts/run-tests.js`, which later mutant runs start from). "A PR's `run-tests.js` never runs" means it is never invoked, not that PR code can't change main's copy. That stays with the reviewer.
- `test` and `answer-keys` (they test the PR's code by design).

## Risks
- **Same-name forgery:** anyone with push access can add a `pull_request` job named `mutation-gate` that passes. All checks come from the GitHub Actions app, so pinning the check's source doesn't separate them. To measure on `main` (PR 2). Even if it works, weakening the gate then needs a conspicuous forged job, not a quiet script edit.
- **Check attachment:** if a `pull_request_target` check doesn't attach to the PR head commit, it can't be required. Fallback: a second job (no PR code) posts a commit status, which needs `statuses: write`; back to the user.
- **The gate can't test itself before merge:** `gate.yml` runs only once it's on `main`; a PR changing gate code is judged by main's version. Its new code is covered by `npm test` and goes live on merge. Before PR 1, the workflow's steps are simulated locally.
- `pull_request_target` with PR code is a known footgun when the job holds a write token, secrets or a writable cache. Here: read-only token, 0 repository secrets (2026-10-16; re-check this job if one is ever added), no cache use; GitHub's docs say `pull_request_target` runs get read-only access to the default branch's cache ("Securely using pull_request_target"). Not verified: whether that holds against code reading the runner's runtime token from memory (published research did that before the change); forks are refused, which leaves same-repo PRs, i.e. people with push access.
