# Security Audit Platform — Product Requirements Document (PRD)

**Version:** 1.1  
**Last Updated:** 2026-10-02  
**Status:** Phase 1 in progress: scanners and dashboard built, deploy (Week 3) next. Live progress is in STATUS.md.

Checkboxes below show what's built. Notes in *italics* mark where the build differs from the original requirement.

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
**What:** Parse package.json → query CVE database (*requirements.txt / go.mod are Phase 2; Node.js only for MVP*)  
**Why:** 80% of vulnerabilities are in dependencies, not custom code  
**Acceptance Criteria:**
- [x] Parses package.json and extracts dependencies + versions (*installed versions come from the lockfile; without one, from a lockfile resolved at scan time*)
- [x] Queries npm audit API (or GitHub Advisory Database)
- [ ] Returns findings with CVSS score, CVE ID, patched version (*patched version ✅ when the advisory range has a strict upper bound; the id is npm's advisory number and the GHSA link is in `references`. No CVSS score or CVE ID yet*)
- [x] Handles missing/non-existent packages gracefully (no package.json → dependency scan skipped, pattern scan continues)

**Interview Talking Point:** "I started with dependency scanning because that's where the low-hanging fruit is. 80% of security debt comes from outdated packages."

---

### Req 2: Pattern-Based Code Scanning
**What:** Grep + regex patterns for anti-patterns  
**Why:** Catches local code issues (hardcoded secrets, basic XSS, SQL injection)  
**Acceptance Criteria:**
- [x] Detects hardcoded secrets (AWS keys, API tokens, DB passwords)
- [x] Detects SQL injection patterns (string concatenation and template literals, multi-line). Recall 3/3 on Juice Shop + DVNA
- [x] Detects XSS patterns (DOM sinks, Angular/React bypasses, unescaped template output, `res.send` of HTML). Recall 8/9 Juice Shop challenges, 3/3 DVNA
- [x] Detects insecure crypto (MD5/SHA1 for passwords incl. through a helper, hardcoded keys, broken ciphers, `Math.random()` for secrets, JWT without an algorithm allowlist, Hashids salts). Recall 5/6 Juice Shop code-level challenges, 1/1 DVNA
- [x] Detects async footguns (promise chains with no `.catch()`, async Express 4 handlers not wrapped, async callbacks in forEach / Promise executors / timers / event listeners). DVNA 15 (all checked by hand); 0 false positives on Juice Shop's 21 wrapped handlers
- [ ] False positive rate < 40% (tolerable for MVP) (*not measured yet. Juice Shop secrets are noisy: 30 of 41 are seed-data "passwords"*)

**Interview Talking Point:** "Pattern detection is noisy, so I focused on high-confidence patterns and added contextual factors to reduce false positives."

---

### Req 3: Contextual Scoring (Differentiator)
**What:** Score exploitability = pattern + multiple context factors  
**Why:** Reduces false positives, shows threat modeling knowledge  
**Acceptance Criteria:**
- [ ] Each finding includes 3+ context factors (*SQLi, XSS, dependencies ✅ (4+); secrets have 1, an open TODO*)
- [x] Severity can be adjusted (MEDIUM → HIGH if context confirms) (*SQLi and XSS. Secret and dependency severity is fixed by pattern / npm audit*)
- [x] Factors are readable + defensible ("Why is this HIGH not CRITICAL?")
- [x] Dashboard explains factors to non-technical audience (expanded row → "Why this severity", ✓ evidence / ⚠ note / ? unknown)

**Interview Talking Point:** "I implemented contextual scoring because real exploits need multiple conditions. This shows I understand threat modeling, not just pattern matching."

---

### Req 4: Coverage Report
**What:** Show what was checked, even if nothing found  
**Why:** Demonstrates thoroughness, builds confidence  
**Acceptance Criteria:**
- [x] Dashboard shows all 9 check categories (hardcoded secrets, SQL injection, XSS, crypto, CORS, async, permissions, logging PII, CVEs) (*6 as "checked", 3 as "not yet checked", so a 0 never pretends to be "clean"*)
- [x] Collapsible section (doesn't clutter main view)
- [x] Shows # of findings per category

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
- [x] Findings-by-type chart split by severity (Task #5; replaces the planned pie chart)
- [x] Dark mode (bonus, shows attention to detail) — follows the system preference (Task #5)

**Interview Talking Point:** "The dashboard is designed to let non-technical people understand security findings in 30 seconds."

---

### Req 6: Remediation Guidance
**What:** For each finding, explain how to fix it  
**Why:** "Here's the problem" is table stakes; "here's how to fix it" gets the job  
**Acceptance Criteria:**
- [x] Each finding has a remediation section
- [x] Remediation is actionable (not just "use parameterized queries" — show example) (*SQLi/XSS show before/after code; dependencies say which version to upgrade to*)
- [x] Includes link to OWASP / CVE reference (OWASP for patterns, GitHub advisory for dependencies; only http(s) links are rendered)

---

## 3. Data Schema (Scanner Output)

This is the canonical schema; DESIGN.md points here. Notes:
- Dependency findings also carry `package`, `packageVersion` (from the lockfile; `null` if unknown), `affectedVersions`, `patchedVersions` (`null` when the advisory range doesn't name one), `advisorySeverity`, and `devOnly` (`true` / `false` / `null` = couldn't tell). They use npm's numeric advisory id as `id` and have `"line": null`.
- `errors` (array of strings) is present only when a scanner failed. The dashboard shows it in the coverage panel.
- Pattern-finding ids are one per file and line: `sqli-<file>-<line>` and `xss-<file>-<line>` (those scanners report at most one finding per line), and `secret-<file>-<line>`, with `-2`, `-3`… when one line holds several secrets. Dependency ids are npm advisory numbers. The dashboard keys rows on type + file + line + index, not on id.
- **Demo reports** (`public/demo/*.json`, from `npm run demo:export`) add `"source": { "repo": "<GitHub URL>", "commit": "<short sha>" }`, use the repo name as `targetPath`, and replace secret snippets with `"[redacted in demo report]"` and secret ids with `secret-<file>-<line>`. `public/demo/index.json` lists them: `{ "scans": [{ "id", "label", "description", "file", "repo", "commit", "total" }] }`.

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
    "checked": ["Dependency CVEs", "Hardcoded Secrets", "SQL Injection Patterns", "XSS Vulnerabilities", "Insecure Crypto Usage", "Async Footguns"],
    "checkedCount": 6,
    "notYetChecked": ["CORS Misconfiguration", "Permission Creep", "Logging PII"],
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
**Decision:** **Node.js only** (MVP phase)  
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

### Phase 1: MVP (Weeks 1-3)
**Goal:** Functioning scanner + dashboard, deployed. (*Originally Weeks 1-2. Deploy moved to Week 3, and dashboard polish (dark mode, chart) moved up from Phase 2 into Week 2.*)

**Week 1:**
- [x] Dependency scanner (parse + npm audit API)
- [x] Pattern scanners: hardcoded secrets, SQL injection, XSS
- [x] Pattern scanner: insecure crypto (session 7)
- [x] Pattern scanner: async (session 7)
- [x] JSON output generation
- [x] Test on 1 real repo (Express.js) — plus OWASP Juice Shop + DVNA as known answer keys

**Week 2:**
- [x] React dashboard (table, filters, search) (Task #4, PR #7)
- [x] Coverage report
- [x] Remediation sections
- [x] Dashboard polish: dark mode, findings-by-type chart, phone layout (Task #5, PR #9)

**Week 3:**
- [ ] Deploy to Vercel with committed demo data (Task #6). Demo data for Juice Shop, DVNA, and Express + picker ✅ (PR #10, merged); Vercel import pending
- [ ] README, talking points, demo (Task #7)

**Definition of Done (Phase 1):**
- [x] Scanner runs without errors on Express.js repo (also Juice Shop and DVNA)
- [x] Dashboard displays findings accurately
- [x] Findings have context factors + remediation
- [x] Code is readable + documented
- [ ] Deployed (live URL)
- [ ] Can explain findings in 3 minutes (rehearse with the live demo)

---

### Phase 2: Polish & Depth (after deploy)
**Goal:** Production-quality, interview-ready

- [ ] Export findings as PDF
- [x] Add dark mode (done early, Task #5)
- [ ] Fix false positives based on Phase 1 testing (open TODOs in HANDOFF.md)
- [x] Add severity chart (done early, Task #5, as a findings-by-type bar chart split by severity, since bars compare better than pie slices)
- [x] Test on 3+ different repos (Express, Juice Shop, DVNA)
- [ ] Write README with screenshots
- [x] Insecure crypto scanner (deferred from Week 1; session 7)
- [x] Async footgun scanner (deferred from Week 1; session 7)

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
- End of Week 1: Dependency scanner + pattern scanners working on real repo ✅
- End of Week 2: Dashboard functional and polished ✅ (deploy moved to Week 3)
- End of Week 3: Deployed, documented, ready for interviews

**If Stuck:**
- Reassess scope (cut features, don't extend timeline)
- Trade off accuracy for speed (Phase 1 MVP doesn't need perfection)
- Focus on the "core loop" (scanner → dashboard) before polish
