# Contributing Guidelines

## Branch Strategy (Git Flow Lite)

### Main Branches
- **`main`** — Production-ready, always deployable. Protected: changes land only through PRs (see Branch Protection).
  - Receives PRs from `feature/*` (code) and `docs/*` (docs-only) branches
  - All commits are tagged with a plan task number like `(#4)`
  - Vercel auto-deploy on merge is planned (Task #6), not set up yet

### Feature Branches
- **`feature/scanner-deps`** — Dependency scanner (Task #1)
- **`feature/scanner-patterns`** — Pattern scanners (Tasks #2-3)
- **`feature/dashboard-core`** — Dashboard core (Task #4)
- **`feature/dashboard-polish`** — Dashboard polish (Task #5)
- **`feature/deploy`**: demo data + Vercel deploy setup (Task #6)
- **`docs/<topic>`**: docs-only changes (e.g. `docs/session-4-handoff`)

**Naming pattern:** `feature/<task-short-name>` or `docs/<topic>`

---

## Commit Message Format

### All Commits (Docs + Code)

```
<type>: <description> (#task)

<optional detailed body>
```

`#task` is the plan task number (STATUS.md), not a GitHub issue; the repo doesn't use issues. No `Co-Authored-By:` or other AI attribution lines in commits or PR descriptions.

**Types:**
- `feat:` — New feature (scanner, dashboard component)
- `fix:` — Bug fix
- `refactor:` — Code restructuring (no new feature)
- `test:` — Test additions/changes
- `docs:` — Documentation only
- `chore:` — Maintenance, deps, config

**Examples:**

```
feat: implement npm audit dependency scanner (#1)

Query npm audit API for each dependency in package.json.
Returns advisory findings with severity and patched versions.

Handles edge cases:
- Missing packages (skip gracefully)
- Network timeouts (fallback to cached results)
- Malformed JSON (error + continue)

Tests:
- Express.js repo (finds 3+ real CVEs)
- Repo with no package.json (graceful skip)
```

```
docs: add PRD with requirements and trade-offs (#1)
```

```
fix: handle missing package.json gracefully (#1)

Previously crashed on repos without package.json.
Now skips dependency scan and continues with pattern scanner.
```

---

## Workflow: Everything Through PRs

`main` is protected, so direct pushes are rejected, docs included. Docs-only changes go on a `docs/*` branch, or ride along in the feature PR they describe.

### For Code Changes (scanner, dashboard, tests) and Docs
**Create PR, self-review, wait for the `test` check, then squash-merge:**

```bash
# 1. Create feature branch
git checkout -b feature/scanner-deps

# 2. Make commits (each references its task number)
git commit -m "feat: parse package.json (#1)"
git commit -m "feat: query npm audit API (#1)"
git commit -m "test: add npm audit integration tests (#1)"

# 3. Push to remote
git push -u origin feature/scanner-deps

# 4. Create PR on GitHub
# Title: Phase 1 Week 1: Dependency Scanner (#1)
# Description: (see PR template below)

# 5. Self-review on GitHub (diff view catches things commits don't)
# Look for: error handling, edge cases, code style

# 6. Squash-merge once the `test` check passes (the only merge method allowed)
# 7. Delete the branch (GitHub button), then locally: git fetch --prune && git branch -D feature/scanner-deps
```

---

## PR Template

Use this template when creating a PR:

```markdown
## What
Implement npm audit integration for dependency scanning.

## Why
80% of vulnerabilities are in dependencies, not custom code.
This is the first scanner module.

## How
- Parse package.json and extract dependencies + versions
- Query npm audit API for each dependency
- Output findings to scanner-output.json in required format
- Handle edge cases: missing packages, network timeouts, malformed JSON

## Testing
- [x] `npm test`, `npm run lint`, and `npm run build` pass (CI runs all three)
- [x] `npm run mutate:changed` ≥ 80% on changed scanner/utils lines (CI runs it on PRs)
- [x] `reviewer` agent run before opening the PR (`.claude/agents/reviewer.md`)
- [x] Tested on Express.js repo (finds 3+ real CVEs)
- [x] Tested on repo with no package.json (graceful skip)

## Definition of Done
- [x] Parses package.json correctly
- [x] Queries npm audit API reliably
- [x] Returns findings with severity + patched version
- [x] Handles edge cases gracefully
- [x] Output matches scanner-output.json schema (PRD.md §3)
- [x] No console.log() or debug code left

## Notes
- Uses npm audit API (free, no auth required)
- Squash merge per CONTRIBUTING.md
```

(No `Closes #N`, because there are no GitHub issues. Reference the task number in the title instead.)

---

## Merging Strategy

### Squash Commit (Recommended for this project)
```bash
# GitHub UI: "Squash and merge"
# This collapses all feature branch commits into 1 clean commit
```

**Why squash?**
- Keeps main history clean (1 commit per feature)
- Easier to revert if needed
- Smaller git log (easier to read)

**Example:**
```
Before squash (5 commits on feature/scanner-deps):
- feat: parse package.json (#1)
- fix: handle missing dependencies (#1)
- test: add npm audit tests (#1)
- refactor: extract helper function (#1)
- docs: add comments (#1)

After squash (1 commit on main):
- feat: implement npm audit dependency scanner (#1)
```

---

## Task Linking

Every commit references its plan task number (see STATUS.md):

```bash
git commit -m "feat: parse package.json (#1)"
```

**Why?**
- Connects code to requirements (traceability)
- Git log tells the story ("what changed and why")

---

## Deployment Flow

```
Code commit → PR → `test` check (npm ci, npm test, npm run lint, npm run build) → Self-review → Squash-merge to main → Auto-deploy to Vercel (after Task #6)
```

---

## Branch Protection

**Active ruleset on `main`** (Settings → Rules → Rulesets; enforced since the repo went public):
- Require a pull request before merging — **0 approvals** (GitHub doesn't let you approve your own PR, so solo work self-reviews in the diff view)
- Squash is the only allowed merge method
- Require status checks: the `test` job from `.github/workflows/test.yml` (run locally with `npm test && npm run lint && npm run build`)
- Block force pushes and branch deletion

Not required (yet), but runs on every PR: the `mutation-changed` job (`npm run mutate:changed`). At least 80% of the planted bugs in the `src/scanner/` and `src/utils/` lines a PR changes must be caught, and `thresholds.break` in `stryker.config.json` can't go down. See [docs/ENGINEERING_PROCESS.md](docs/ENGINEERING_PROCESS.md).

Head branches are not auto-deleted on merge — delete them after merging (GitHub's "Delete branch" button, then `git fetch --prune` and `git branch -D <branch>` locally).

---

## When Code Review Matters Most

For **this project**, focus review on:
1. **Edge cases** — Does it crash on weird input?
2. **Error messages** — Are they helpful?
3. **Code clarity** — Would someone else understand this?
4. **Test coverage** — Did I test the happy path AND the unhappy path?

(Not: "indentation is wrong" or "variable name could be better" — minor stuff)

---

## Quick Reference

| What | Where | How |
|------|-------|-----|
| Docs change | PR | `git checkout -b docs/...` → PR → squash-merge |
| Code feature | PR | `git checkout -b feature/...` → PR → squash-merge |
| Bug fix | PR | `git checkout -b feature/...` → PR → squash-merge |
| Chore | PR | branch → PR → squash-merge |

---

## Example Session (Task #1: Dependency Scanner)

```bash
# Start
git checkout -b feature/scanner-deps

# Work
echo "// npm audit code" > src/scanner/deps.js
git add src/scanner/deps.js
git commit -m "feat: parse package.json (#1)"

echo "// query api" >> src/scanner/deps.js
git commit -am "feat: query npm audit API (#1)"

git push -u origin feature/scanner-deps

# On GitHub: Create PR
# Title: Phase 1 Week 1: Dependency Scanner (#1)
# Link PR template above

# Self-review: Check diff on GitHub
# Make sure: no console.log, error handling, tests pass

# Merge: "Squash and merge" after the `test` check passes, then delete the branch
```

Done. Clean, traceable history. Ready for interviews.
