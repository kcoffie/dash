# Project Status Dashboard

**Last Updated:** 2026-10-09 (session 12)  
**Status:** Scanners + dashboard merged (PRs #7, #9) · demo data + picker merged (PR #10) · secret scanning on · **live at https://dash-jade-nine.vercel.app/** · Task #7 docs merged (PR #13) · scanner accuracy merged (PR #14) · ESLint + lint in CI merged (PR #16) · insecure-crypto scanner merged (PR #17) · async-footgun scanner merged (PR #19) · team gates: mutation testing + reviewer/architect agents merged (PRs #21, #22; score 56.89% → 60.55%, CI 60.58%, ratchet 60; CI 69.30% after PR #31) · passport-local credentials → high merged (PR #25) · answer-key regression test: keys for all 3 targets + per-type recall merged (PRs #27–#29), CI job `answer-keys` merged (PR #31; first Linux run 0 differences vs `public/demo`, 2 m 48 s): answer-key plan complete; repo now at `~/projs/dash`

---

## Overall Progress

```
Phase 1 (MVP)      ██████████ 100% (7 of 7 tasks)
Phase 2 (Depth)    ░░░░░░░░░░  0%  (PRD §6 Phase 2 — PDF export, FP tuning, 3+ repos; dark mode + chart pulled into #5)
Phase 3+ (Future)  ░░░░░░░░░░  0%  (Documented in FUTURE_IDEAS.md)
```

---

## What's DONE (Design Phase)

✅ **Strategy & Vision**
- [x] PRD.md (6 core requirements with acceptance criteria)
- [x] DESIGN.md (contextual scoring architecture)
- [x] TechPM.md (partnership framework)
- [x] TPM_STRATEGY.md (how we'll work together)
- [x] FUTURE_IDEAS.md (Phase 2+ ideas)

✅ **Project Setup**
- [x] Git repo initialized
- [x] Folder structure created (src/scanner, src/components, src/pages, src/utils)
- [x] package.json configured (React, Vite, Tailwind)
- [x] Dashboard skeleton (App.jsx, Dashboard.jsx, index.html), since replaced by the full dashboard (#4, #5)

✅ **Task Tracking**
- [x] 7 Phase-1 tasks created with DOD (Definition of Done)
- [x] Task dependencies mapped (Week 1 → Week 2 → Week 3)

---

## Phase 1 Tasks

### Week 1: Build Scanners

| Task | Status | DOD Checklist |
|------|--------|---------------|
| **#1: Dependency Scanner** | ✅ Merged | Parse JSON, query npm audit API, output CVE findings |
| **#2: Pattern Scanners (Secrets + SQL)** | ✅ Merged (PR #2) | Regex for hardcoded secrets, SQL patterns, 3+ context factors |
| **#3: Pattern Scanners (XSS, Crypto, Async)** | 🟡 XSS ✅ merged (PR #2); crypto ✅ merged (PR #17); async ✅ PR open (session 7) | XSS, MD5/SHA1, async footguns, integrated output |

**Deliverable:** `scanner-output.json` with 5 finding types + context factors — 6 of 6 shipped (dependency CVEs, secrets, SQLi, XSS, insecure crypto, async footguns). Validated against OWASP Juice Shop + DVNA answer keys: SQLi 3/3, XSS 8/9 Juice Shop challenges + 3/3 DVNA, crypto 5/6 Juice Shop challenges + 1/1 DVNA, async: DVNA 15 hand-checked, 0 false positives on Juice Shop's 21 wrapped handlers. Accuracy pass (session 6, PR #14 merged): dependency scan no longer reads npm audit failures as clean (DVNA 0 → 58 CVEs), dev-only advisories → low, secrets 41 → 27 on Juice Shop with fewer misses. Details in HANDOFF.md.

### Week 2: Build Dashboard

| Task | Status | DOD Checklist |
|------|--------|---------------|
| **#4: Dashboard Core** | ✅ Merged (PR #7) | Table, filters, search, coverage report, expandable rows |
| **#5: Dashboard Polish** | ✅ Merged (PR #9) | Dark mode ✅, findings-by-type chart ✅ (stacked bars instead of a pie), remediation links ✅ (shipped in #4), responsive ✅ |

**Deliverable:** Working React app at `npm run dev`

### Week 3: Deploy + Interview Prep

| Task | Status | DOD Checklist |
|------|--------|---------------|
| **#6: Deploy to Vercel** | ✅ Live at https://dash-jade-nine.vercel.app/ (2026-10-05). Demo data + picker (PR #10); production branch `main` | Live URL, tested on 3+ repos (Express, Juice Shop, DVNA ✅), edge cases handled |
| **#7: Documentation** | ✅ Merged (PR #13): README screenshots (light, dark, finding details, phone), how it works, measured results, limitations, talking points; `npm run screenshots` | README, talking points, git history, portfolio-ready |

**Deliverable:** Live demo + interview story

---

## Key Decisions Made (No Redo)

1. **Contextual Scoring** = Differentiator (not just "vuln found")
2. **Node.js Only (Phase 1)** = Faster, simpler, Express.js is target
3. **Real Repo (Express.js)** = More credible than toy data
4. **3-4 Context Factors** = Defensible + explainable
5. **High FP Tolerance (Phase 1)** = Better to flag than miss; Phase 2 tunes

---

## Known Risks & Mitigations

| Risk | Mitigation | Priority |
|------|-----------|----------|
| npm audit API rate limit | Cache results locally | High |
| Repo too large (10k files) | Filter to `src/` only | High |
| False positive rate > 50% | Document FP list, whitelist patterns | High |
| No package.json → crash | Graceful failure, continue with patterns | High |
| Async footgun detection is noisy | Start simple (missing `await`), refine Phase 2 | Medium |

---

## Trade-offs Accepted

| Trade-off | Decision | Why |
|-----------|----------|-----|
| Accuracy vs Coverage | Favor Coverage (MVP) | Interviews reward "I checked for X" |
| Multi-language vs Node.js | Node.js only | Faster; Python Phase 2 |
| Real code vs synthetic data | Real (Express.js) | More credible |
| Contextual complexity | Start at 3-4 factors | Defensible; 10 factors = overwhelming |

---

## Interview Story (TL;DR)

**The Pitch (30 seconds):**
> "I built a real security vulnerability scanner that audits codebases and displays findings with contextual scoring. The differentiator: I don't just flag patterns—I score exploitability based on multiple factors (is input sanitized? is endpoint public?). This shows threat modeling, not just regex matching. I checked it against two intentionally vulnerable apps with known answers (SQL injection 3/3, XSS 8/9 + 3/3), and built a dashboard that explains risk to non-technical people."

**The Demo (3 minutes):**
1. Show scanner output (Juice Shop: the login SQLi scored CRITICAL; the same pattern in training snippets scored LOW)
2. Explain contextual scoring (why HIGH not CRITICAL? why is the same pattern LOW in a training snippet?)
3. Walk dashboard (severity cards, findings-by-type chart, filters, search, "Why this severity", remediation links)
4. Explain trade-offs (why Node.js only? why contextual? why this approach?)

**The Code (5 minutes):**
1. Scanner architecture (dependency + pattern detection)
2. Dashboard UX (coverage report, expandable findings)
3. How I'd scale it (Phase 2 ideas in FUTURE_IDEAS.md)

---

## Success Criteria (Interview Readiness)

When Phase 1 is DONE, you should be able to:

- ✅ Show live scanner + dashboard (working demo)
- ✅ Explain findings in security terms (CWE/CVSS)
- ✅ Defend contextual scoring (why it matters)
- ✅ Discuss trade-offs (Node.js only, coverage over accuracy)
- ✅ Walk through code (clean, understandable)
- ✅ Talk about Phase 2 ideas (scale, depth, compliance)

---

## How to Use This Dashboard

- **Check current Phase:** Look at overall progress bar
- **See what's next:** Find first 🔵 Pending task
- **Verify DOD:** Click task, read checklist before marking done
- **Adjust timeline:** If blocked, ref "Known Risks & Mitigations"
- **Remind yourself of story:** Read "Interview Story (TL;DR)" before demos

---

## Questions to Ask Yourself Weekly

1. **Is the core loop (scanner → JSON → dashboard) still intact?**
2. **Can I explain this in 3 minutes to an interviewer?**
3. **Is the code clean + understandable?**
4. **Are there any edge cases I haven't thought of?**
5. **Am I on pace for Phase 1 by end of Week 3?** (deploy slipped from Week 2 to Week 3)

If any answer is "no," flag it. That's what I'm here for.

---

**Next Step:** `main` run for PR #31 checked (`mutation-full` 69.30%, 47 m of a 60 m limit); required checks made (user); actions v4 → v7 merged (PR #33, `main` run verified); `mutation-full` skip on Markdown-only pushes after a passing run + timeout 90 in PR #34 (CI green); next: verify #34's `main` run and the first live skip. Details: HANDOFF "▶ START HERE". Every PR must pass `npm test` + `npm run lint` + `npm run build`, and `mutate:changed` ≥ 80%.
