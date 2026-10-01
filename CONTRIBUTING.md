# Contributing Guidelines

## Branch Strategy (Git Flow Lite)

### Main Branches
- **`main`** — Production-ready, always deployable
  - Only receives PRs from `feature/*` branches
  - All commits are tagged with issue numbers
  - All commits trigger deploy to Vercel

### Feature Branches
- **`feature/scanner-deps`** — Dependency scanner (Task #1)
- **`feature/scanner-patterns`** — Pattern scanners (Tasks #2-3)
- **`feature/dashboard-core`** — Dashboard core (Task #4)
- **`feature/dashboard-polish`** — Dashboard polish (Task #5)
- **`feature/deploy`** — Vercel deploy setup (Task #6)

**Naming pattern:** `feature/<task-short-name>`

---

## Commit Message Format

### All Commits (Docs + Code)

```
<type>: <description> (#issue)

<optional detailed body>
```

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
Returns CVE findings with CVSS scores and patched versions.

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

## Workflow: Option C (Docs → Direct Commits | Code → PRs)

### For Docs/Chores (README, DESIGN.md, etc.)
**Direct commit to main:**
```bash
git commit -m "docs: update README with scanner usage (#1)"
```

### For Code Changes (scanner, dashboard, tests)
**Create PR, self-review, then merge:**

```bash
# 1. Create feature branch
git checkout -b feature/scanner-deps

# 2. Make commits (each references issue)
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

# 6. Merge PR (squash or merge commit, your choice)
# Closes #1
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
- [x] Tested on Express.js repo (finds 3+ real CVEs)
- [x] Tested on repo with no package.json (graceful skip)
- [x] Tested network timeout (fallback to cache)

## Definition of Done
- [x] Parses package.json correctly
- [x] Queries npm audit API reliably
- [x] Returns findings with CVSS score + CVE ID
- [x] Handles edge cases gracefully
- [x] Output matches scanner-output.json schema
- [x] No console.log() or debug code left

## Notes
- Uses npm audit API (free, no auth required)
- Falls back to cached results on network timeout
- Skips private packages gracefully

Closes #1
```

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

## Issue Linking

Every commit must reference an issue:

```bash
git commit -m "feat: parse package.json (#1)"
```

**Why?**
- Connects code to requirements (traceability)
- Closes issues automatically when PR merges
- Git log tells the story ("what changed and why")

---

## Deployment Flow

```
Code commit → PR → Self-review → Merge to main → Auto-deploy to Vercel
```

---

## Branch Protection (If Using GitHub)

**Recommended settings for `main`:**
- Require PR reviews (1 approval minimum)
  - *For solo: approve your own PR after self-review*
- Require status checks (tests: the `test` job from `.github/workflows/test.yml`; run locally with `npm test`)
- Dismiss stale reviews (if you push new commits)
- Delete head branch on merge (keeps repo clean)

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
| Docs change | Direct | `git commit -m "docs: ... (#N)"` → `git push` |
| Code feature | PR | `git checkout -b feature/...` → PR → merge |
| Bug fix | PR | `git checkout -b feature/...` → PR → merge |
| Chore | Direct | `git commit -m "chore: ... (#N)"` → `git push` |

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

# Merge: "Squash and merge"
# → Closes #1 automatically
```

Done. Clean, traceable history. Ready for interviews.
