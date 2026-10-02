# Security Audit Platform — Product Requirements Document (PRD)

**Version:** 1.0  
**Last Updated:** 2026-10-01  
**Status:** In Design (Ready for Phase 1)

---

## 1. Vision & Goals

### Vision Statement
Build a **real, working security vulnerability scanner** that demonstrates technical depth, architectural thinking, and ability to solve real security problems for portfolio/interview impact.

### Success Criteria
- ✅ Scans a real open-source repo (Express.js, Koa, etc.)
- ✅ Finds actual CVEs + code anti-patterns
- ✅ Displays findings with **contextual scoring** (exploitability based on multiple factors)
- ✅ Dashboard is intuitive enough for 30-second interview explanation
- ✅ Code is clean, maintainable, understandable

### Non-Goals (Explicitly Out of Scope)
- ❌ Real-time CI/CD integration (Phase 2+)
- ❌ Multi-user collaboration features
- ❌ Compliance export (CIS benchmarks, etc.) — Phase 2
- ❌ Machine learning-based pattern discovery

---

## 2. Core Requirements

### Req 1: Dependency Vulnerability Scanning
**What:** Parse package.json/requirements.txt/go.mod → query CVE database  
**Why:** 80% of vulnerabilities are in dependencies, not custom code  
**Acceptance Criteria:**
- [ ] Parses package.json and extracts dependencies + versions
- [ ] Queries npm audit API (or GitHub Advisory Database)
- [ ] Returns findings with CVSS score, CVE ID, patched version
- [ ] Handles missing/non-existent packages gracefully

**Interview Talking Point:** "I started with dependency scanning because that's where the low-hanging fruit is. 80% of security debt comes from outdated packages."

---

### Req 2: Pattern-Based Code Scanning
**What:** Grep + regex patterns for anti-patterns  
**Why:** Catches local code issues (hardcoded secrets, basic XSS, SQL injection)  
**Acceptance Criteria:**
- [ ] Detects hardcoded secrets (AWS keys, API tokens, DB passwords)
- [ ] Detects SQL injection patterns (string concatenation in queries)
- [ ] Detects XSS patterns (unsanitized DOM manipulation)
- [ ] Detects insecure crypto (MD5/SHA1 for passwords, hardcoded keys)
- [ ] Detects async footguns (unhandled promises, fire-and-forget fetch)
- [ ] False positive rate < 40% (tolerable for MVP)

**Interview Talking Point:** "Pattern detection is noisy, so I focused on high-confidence patterns and added contextual factors to reduce false positives."

---

### Req 3: Contextual Scoring (Differentiator)
**What:** Score exploitability = pattern + multiple context factors  
**Why:** Reduces false positives, shows threat modeling knowledge  
**Acceptance Criteria:**
- [ ] Each finding includes 3+ context factors
- [ ] Severity can be adjusted (MEDIUM → HIGH if context confirms)
- [ ] Factors are readable + defensible ("Why is this HIGH not CRITICAL?")
- [ ] Dashboard explains factors to non-technical audience

**Interview Talking Point:** "I implemented contextual scoring because real exploits need multiple conditions. This shows I understand threat modeling, not just pattern matching."

---

### Req 4: Coverage Report
**What:** Show what was checked, even if nothing found  
**Why:** Demonstrates thoroughness, builds confidence  
**Acceptance Criteria:**
- [ ] Dashboard shows all 9 check categories (hardcoded secrets, SQL injection, XSS, crypto, CORS, async, permissions, logging PII, CVEs)
- [ ] Collapsible section (doesn't clutter main view)
- [ ] Shows # of findings per category

**Interview Talking Point:** "Coverage report shows I think about security as a checklist, not just a bug hunt."

---

### Req 5: Interactive Dashboard
**What:** React app that displays scanner JSON findings  
**Why:** Makes output human-readable, shows UX design thinking  
**Acceptance Criteria:**
- [x] Loads scanner-output.json and renders findings
- [x] Filter by severity (Critical → Info)
- [x] Search by keyword / file / type
- [x] Expandable rows show context factors + remediation
- [x] Responsive (works on mobile, tablet, desktop)
- [x] Dark mode (bonus, shows attention to detail) — follows the system preference (Task #5)

**Interview Talking Point:** "The dashboard is designed to let non-technical people understand security findings in 30 seconds."

---

### Req 6: Remediation Guidance
**What:** For each finding, explain how to fix it  
**Why:** "Here's the problem" is table stakes; "here's how to fix it" gets the job  
**Acceptance Criteria:**
- [ ] Each finding has a remediation section
- [ ] Remediation is actionable (not just "use parameterized queries" — show example)
- [ ] Includes link to OWASP / CVE reference

---

## 3. Data Schema (Scanner Output)

```json
{
  "timestamp": "2026-09-30T15:45:00Z",
  "targetPath": "/path/to/repo",
  "findings": [
    {
      "id": "CVE-2023-1234",
      "type": "dependency-cve" | "hardcoded-secret" | "sql-injection" | "xss" | "crypto-misuse" | "async-footgun",
      "title": "SQL Injection in user query",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "confidence": 0.85,
      "description": "String concatenation in database query",
      "file": "src/db.js",
      "line": 42,
      "snippet": "const query = 'SELECT * FROM users WHERE id = ' + userId",
      "context": [
        "✓ String concatenation pattern detected",
        "⚠ No parameterized query visible",
        "✓ User input flows to this code",
        "? Endpoint auth check unclear"
      ],
      "remediation": "Use db.query('SELECT * FROM users WHERE id = ?', [userId])",
      "references": ["https://owasp.org/www-community/attacks/SQL_Injection"],
      "tags": ["ai-risk", "copy-paste-vulnerable"]
    }
  ],
  "coverage": {
    "checked": ["Dependency CVEs", "Hardcoded Secrets", "SQL Injection Patterns", "XSS Vulnerabilities"],
    "checkedCount": 4,
    "notYetChecked": ["Insecure Crypto Usage", "CORS Misconfiguration", "Async Footguns", "Permission Creep", "Logging PII"],
    "findingsByType": {
      "dependency-cve": 3,
      "hardcoded-secret": 2,
      "sql-injection": 1,
      "xss": 0,
      "crypto-misuse": 0,
      "async-footgun": 0
    }
  },
  "summary": {
    "total": 6,
    "critical": 1,
    "high": 2,
    "medium": 2,
    "low": 1,
    "info": 0
  }
}
```

---

## 4. Trade-offs & Decisions

### Trade-off 1: Accuracy vs. Coverage
**Decision:** Favor **Coverage** (MVP phase)  
**Reasoning:** 
- Interviews reward "I checked for X" even if not found
- False positives are better than false negatives (show more, let interviewer filter)
- Fine-tune accuracy in Phase 2

---

### Trade-off 2: Multiple Languages vs. Node.js Only
**Decision:** **Node.js + minimal Python/Ruby** (MVP phase)  
**Reasoning:**
- Node.js dependency scanning is easiest (npm audit API)
- Adding Python/Ruby adds 2-3 days of complexity
- MVP targets JavaScript codebases (Express, Koa, etc.)
- Phase 2: Add Python/Ruby scanners

---

### Trade-off 3: Real Codebase vs. Synthetic Test Data
**Decision:** **Real codebase** (Express.js or similar)  
**Reasoning:**
- Interviews want real findings, not fake data
- Forces you to handle real edge cases (messy code, false positives)
- More credible story: "I scanned Express.js and found..."

---

### Trade-off 4: Contextual Scoring Complexity
**Decision:** **Start simple** (3-4 context factors per finding type)  
**Reasoning:**
- 10 factors = overwhelming, hard to explain
- 3-4 factors = defensible, easy to walk through
- Phase 2: Add data-flow analysis for deeper context

---

## 5. Edge Cases & Mitigation

| Edge Case | Mitigation | Priority |
|-----------|-----------|----------|
| **No package.json found** | Gracefully skip dependency scan, continue with pattern scan | High |
| **Huge repo (10k files)** | Implement file/directory filters, scan only `src/` + `lib/` | High |
| **False positive rate > 50%** | Add whitelist/ignore patterns, document known FPs | High |
| **Repo has no actual vulnerabilities** | Demo with multiple repos, show clean findings too | Medium |
| **Package.json with malformed JSON** | Error handling + graceful failure, log to stderr | Medium |
| **Regex patterns are too slow** | Implement file exclusions (.test.js, node_modules, dist/) | Medium |
| **Network timeout querying CVE DB** | Fallback to cached results, warn user | Low |

---

## 6. Milestones & Phases

### Phase 1: MVP (Weeks 1-2, ~8 days)
**Goal:** Functioning scanner + basic dashboard

**Week 1:**
- [x] Dependency scanner (parse + npm audit API)
- [x] Pattern scanners: hardcoded secrets, SQL injection, XSS
- [ ] Pattern scanners: insecure crypto, async (deferred until after dashboard)
- [x] JSON output generation
- [x] Test on 1 real repo (Express.js) — plus OWASP Juice Shop + DVNA as known answer keys

**Week 2:**
- [ ] React dashboard (table, filters, search)
- [ ] Coverage report
- [ ] Remediation sections
- [ ] Deploy to Vercel

**Definition of Done (Phase 1):**
- ✅ Scanner runs without errors on Express.js repo
- ✅ Dashboard displays findings accurately
- ✅ Findings have context factors + remediation
- ✅ Code is readable + documented
- ✅ Can explain findings in 3 minutes

---

### Phase 2: Polish & Depth (Week 3, ~3 days)
**Goal:** Production-quality, interview-ready

- [ ] Export findings as PDF
- [x] Add dark mode — done early in Task #5
- [ ] Fix false positives based on Phase 1 testing
- [x] Add severity chart — done early in Task #5 as a findings-by-type bar chart split by severity (bars compare better than pie slices)
- [ ] Test on 3+ different repos
- [ ] Write README with screenshots

**Definition of Done (Phase 2):**
- ✅ No obvious UX friction
- ✅ Works on mobile/tablet
- ✅ Handled edge cases (large repos, malformed JSON, no vulns)
- ✅ Can explain trade-offs I made
- ✅ Ready for live demo in interviews

---

### Phase 3+: Future Ideas (Save for Later)
See `FUTURE_IDEAS.md`

---

## 7. Definition of "Done" (By Component)

### Scanner Component
- [x] Parses real manifests without crashing
- [x] Queries CVE DB reliably (with error handling)
- [x] Outputs JSON that dashboard can parse
- [x] Fast enough (scans Express.js in < 10 seconds)
- [x] Handles edge cases (no package.json, huge repos, timeouts)

### Dashboard Component
- [x] Loads JSON without errors
- [x] Renders all finding types correctly
- [x] Filters work (severity, type, search)
- [x] Expandable sections don't break on edge cases
- [x] Responsive design (works on mobile)

### Code Quality (All)
- [x] No dead code or commented-out sections
- [x] Function names are self-documenting
- [x] Error messages are helpful (not "Error: failed")
- [x] Someone else could read & understand without comments

---

## 8. Success Metrics (Interview)

- "This is real code, not toy code" → Scanned actual Express.js repo
- "They understand risk, not just vulnerabilities" → Explained context factors
- "They can communicate complex ideas simply" → Dashboard is intuitive
- "They make thoughtful trade-offs" → Can explain why contextual scoring matters

---

## 9. What Will NOT Be Included (Scope Boundaries)

- Real-time CI/CD pipeline integration
- Multi-user collaboration or authentication
- Compliance reporting (CIS, PCI-DSS, HIPAA mappings)
- Machine learning-based anomaly detection
- Network/dynamic vulnerability testing
- Database of historical scans

**Why:** These are Phase 2+ nice-to-haves. Phase 1 = lean, focused, deployable.

---

## 10. Communication & Updates

**Weekly Sync Points:**
- End of Week 1: Dependency scanner + pattern scanners working on real repo
- End of Week 2: Dashboard functional, deployed to Vercel
- End of Week 3: Polished, ready for interviews

**If Stuck:**
- Reassess scope (cut features, don't extend timeline)
- Trade off accuracy for speed (Phase 1 MVP doesn't need perfection)
- Focus on the "core loop" (scanner → dashboard) before polish
