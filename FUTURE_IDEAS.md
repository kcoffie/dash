# Security Audit Platform — Future Ideas (Phase 2+)

These are stretch ideas to explore after MVP. Save for later iterations.

Deferred Phase 1 / Phase 2 work (insecure crypto + async scanners, PDF export, false-positive tuning, template-injection detection) is tracked in PRD.md §6 and the Open TODOs in HANDOFF.md, not here.

## 2. AI Code Detector
Flag likely AI-generated sections by detecting:
- Unusual variable naming patterns
- Boilerplate code density
- Comment-to-code ratio anomalies
- Repetitive function signatures

**Why later:** Requires training data / heuristics. MVP can just flag findings.

---

## 3. Trend Report
Compare this codebase against baseline:
- "This codebase has 3x more async footguns than typical Node.js projects"
- Show percentile ranking (top 10% security vs bottom 10%)
- Benchmark against similar-sized repos

**Why later:** Needs historical data / database of scanned repos.

---

## 4. Comparison View
Show diffs across scans or between repos:
- "Similar codebases have X vulns; this has Y — we're 30% better/worse"
- Track improvement over time

**Why later:** Requires multi-repo dataset + versioning.

---

## 5. Fix Templates
Go beyond "here's the problem" → "run this refactor":
- Suggest specific code changes
- Generate patches
- Verify fixes with test running

**Why later:** Hard to automate safely. Requires AST manipulation + domain knowledge.

---

## Priority for Next Iteration (After Phase 1 MVP)

1. ✅ **Contextual scoring** (Phase 1, built for SQLi + XSS)
2. ✅ **Coverage report** (Phase 1, built)
3. **AI code detector** (Phase 2)
4. **Trend report** (Phase 3)
5. **Fix templates** (Phase 3+)
