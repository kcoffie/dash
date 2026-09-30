# Project Status Dashboard

**Last Updated:** 2026-09-30  
**Status:** Design Phase Complete → Week 1 Ready to Start

---

## Overall Progress

```
Phase 1 (MVP)      ████░░░░░░ 20%  (Planning done, coding starts)
Phase 2 (Polish)   ░░░░░░░░░░  0%  (Queued for Week 3)
Phase 3+ (Future)  ░░░░░░░░░░  0%  (Documented in FUTURE_IDEAS.md)
```

---

## What's DONE (Design Phase)

✅ **Strategy & Vision**
- [x] PRD.md (10 core requirements with acceptance criteria)
- [x] DESIGN.md (contextual scoring architecture)
- [x] TechPM.md (partnership framework)
- [x] TPM_STRATEGY.md (how we'll work together)
- [x] FUTURE_IDEAS.md (Phase 2+ ideas)

✅ **Project Setup**
- [x] Git repo initialized
- [x] Folder structure created (src/scanner, src/components, src/pages, src/utils)
- [x] package.json configured (React, Vite, Tailwind)
- [x] Dashboard skeleton (App.jsx, Dashboard.jsx, index.html)

✅ **Task Tracking**
- [x] 7 Phase-1 tasks created with DOD (Definition of Done)
- [x] Task dependencies mapped (Week 1 → Week 2 → Week 3)

---

## What's TBD (Week 1 - Coding Phase)

### Week 1: Build Scanners

| Task | Status | DOD Checklist |
|------|--------|---------------|
| **#1: Dependency Scanner** | 🔵 Pending | Parse JSON, query npm audit API, output CVE findings |
| **#2: Pattern Scanners (Secrets + SQL)** | 🔵 Pending | Regex for hardcoded secrets, SQL patterns, 3+ context factors |
| **#3: Pattern Scanners (XSS, Crypto, Async)** | 🔵 Pending | XSS, MD5/SHA1, async footguns, integrated output |

**Deliverable:** `scanner-output.json` with 5 finding types + context factors

### Week 2: Build Dashboard

| Task | Status | DOD Checklist |
|------|--------|---------------|
| **#4: Dashboard Core** | 🔵 Pending | Table, filters, search, coverage report, expandable rows |
| **#5: Dashboard Polish** | 🔵 Pending | Dark mode, pie chart, remediation links, responsive |

**Deliverable:** Working React app at `npm run dev`

### Week 3: Deploy + Interview Prep

| Task | Status | DOD Checklist |
|------|--------|---------------|
| **#6: Deploy to Vercel** | 🔵 Pending | Live URL, tested on 3+ repos, edge cases handled |
| **#7: Documentation** | 🔵 Pending | README, talking points, git history, portfolio-ready |

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
> "I built a real security vulnerability scanner that audits codebases and displays findings with contextual scoring. The differentiator: I don't just flag patterns—I score exploitability based on multiple factors (is input sanitized? is endpoint public?). This shows threat modeling, not just regex matching. I scanned Express.js, found actual CVEs, and built a dashboard that explains risk to non-technical people."

**The Demo (3 minutes):**
1. Show scanner output (Express.js findings)
2. Explain contextual scoring (why HIGH not CRITICAL?)
3. Walk dashboard (filters, search, remediation links)
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
5. **Am I on pace for Phase 1 by end of Week 2?**

If any answer is "no," flag it. That's what I'm here for.

---

**Next Step:** Start Task #1 (Dependency Scanner). Let's go.
