# Security Audit Platform — Build Overview

> **This is the original project brief, kept for reference.** What's actually built and planned now is in STATUS.md, PRD.md, and DESIGN.md (updated 2026-10-02). Main differences from this brief:
> - **Node.js only.** No `requirements.txt` / `go.mod`, Python, or Ruby (Phase 2).
> - **Scanners built:** dependency CVEs, hardcoded secrets, SQL injection, XSS. Insecure crypto is deferred. CORS is not planned for Phase 1.
> - **JavaScript, not TypeScript**, for the dashboard. **No Recharts:** the chart is a plain HTML/CSS stacked bar per finding type, not a pie.
> - **Dark mode and responsive layout** shipped in Week 2 (Task #5), not Phase 2.
> - **Not built yet:** PDF export, compliance mapping / CVSS scores, dynamic analysis.
> - **Scan targets:** Express.js plus OWASP Juice Shop and DVNA (known answer keys).

**Portfolio Project for Senior Eng + Solutions Engineering Interviews**

---

## PROJECT GOAL

Build a **real, working security vulnerability scanner** that audits actual codebases and displays findings in an interactive dashboard. Demonstrates technical depth (SYO-701 knowledge), architectural thinking, communication of complex risk, and ability to solve real problems.

---

## SCOPE & ARCHITECTURE

### Phase 1: MVP (Weeks 1-2)

**Scanner Backend (Node.js + CLI)**

- Dependency scanning: Parse `package.json`, `requirements.txt`, `go.mod` → check against known CVE database
- Pattern-based detection: Grep for common security anti-patterns
  - Hardcoded secrets (AWS keys, API tokens, DB passwords)
  - SQL injection patterns
  - XSS vulnerabilities
  - Insecure crypto usage
  - CORS misconfiguration
- Output: JSON report with findings + severity + remediation

**Frontend Dashboard (React)**

- Parse scanner JSON → interactive table
- Findings grouped by severity (Critical → Info)
- Expandable rows: full vulnerability details, attack path, fix steps
- Search/filter by type, severity, file
- Visual risk summary (pie chart of severities)

### Phase 2: Polish (Week 3)

- Add dynamic analysis (basic: run against live app, test for XSS/CSRF if applicable)
- Compliance mapping (CWE/CVSS scores)
- Export report as PDF
- Dark mode + responsive design

---

## STARTING POINT

**Scan a real, popular open-source project:**

1. Pick a well-known repo (Express.js, lodash, React, etc.)
2. Clone it
3. Run your scanner
4. Show actual vulnerabilities found (known CVEs, security misconfigs)
5. Demo the dashboard with real results

**Why this matters:** Interviewers will see you found *actual* bugs in *real* code. That's credible.

---

## TECH STACK

- **Scanner:** Node.js + shell utilities (parse manifests, run patterns)
- **CVE Database:** Use free source:
  - npm: `npm audit` API
  - Python: `pip check` or Safety API
  - Ruby: Bundler Audit
  - Or: GitHub Advisory Database (free, public API)
- **Frontend:** React + TypeScript + Tailwind
- **Visualization:** Recharts for severity breakdown
- **Deployment:** Vercel or Netlify (free tier)

---

## NEXT STEPS (In Order)

1. **Pick the target repo** (public, medium size: 50-200 dependencies)
   - Reason: Large enough to have real vulns, small enough to scan fast
   - Example: Express.js, Koa, request library, etc.
2. **Build dependency scanner first** (1-2 days)
   - Parse `package.json`
   - Query npm audit API for each dependency
   - Store results locally
3. **Build pattern scanner** (1-2 days)
   - Hardcoded secrets regex
   - SQL injection patterns
   - Crypto misuse patterns
   - Run against codebase
4. **Build React dashboard** (2-3 days)
   - Load JSON from scanner
   - Display in sortable table
   - Add filters + search
5. **Polish & deploy** (1 day)
   - Dark mode
   - Severity pie chart
   - Export as PDF
   - Deploy to Vercel

---

## THINGS TO LOOK OUT FOR (Pitfalls)

### ❌ False Positives

- Your patterns will trigger on harmless code
- **Fix:** Add whitelist/comments to skip certain findings
- **Talking point:** "I had to distinguish real vulns from FPs — here's how I tuned detection"

### ❌ Incomplete Coverage

- Not all vulnerability types are easy to detect statically
- **Acceptable:** Dependency vulns + hardcoded secrets + obvious patterns
- **Skip:** Logic flaws, authentication bypasses (hard to detect without running code)

### ❌ Performance Bottleneck

- Scanning large repos can be slow
- **Fix:** Cache results, run async, show progress
- **Talking point:** "I had to optimize scanning for large monorepos"

### ❌ Boring Dashboard

- Tables are boring. Add:
  - Severity breakdown (pie/bar chart)
  - Risk score (business-focused)
  - "Top 10 findings" summary card
  - Remediation roadmap

### ❌ Not Showing Business Context

- "This is a security tool" is obvious
- **Better:** Explain impact in business terms
  - "This vulnerability affects X% of your dependencies"
  - "Estimated effort to fix: Y hours"
  - "Compliance risk: PCI-DSS, HIPAA, etc."

---

## THINGS TO BE IMPRESSIVE

### ✅ Real Findings in Real Code

- Show it working on an actual popular repo
- Screenshot actual CVEs it found
- Reference the GitHub Advisory or NVD

### ✅ Clean, Intuitive UX

- Not a wall of red text
- Visual hierarchy (critical on top, grouped by category)
- Interviewers should understand findings in 30 seconds

### ✅ Thoughtful Severity Scoring

- Don't just copy CVSS
- Layer in business context: "Critical if exposed to internet, Low if internal only"
- Show you understand risk, not just vulns

### ✅ Remediation Guidance

- "Here's what's wrong" is table stakes
- "Here's how to fix it" gets you the job
- Link to relevant docs (OWASP, npm advisory, etc.)

### ✅ Export/Share Capability

- Generate a PDF report
- Anyone can download findings
- Looks professional in interviews

### ✅ Git History Shows Evolution

- Commit early and often
- Show architectural decisions in commit messages
- Interviewers read your git log

---

## TALKING POINTS FOR INTERVIEWS

### Senior Eng / Leadership

- "I had to make trade-offs: accuracy vs. speed vs. complexity"
- "I designed the scanner to be modular so it's easy to add new detectors"
- "Here's how I scaled it to handle large repos"
- "I prioritized maintainability over premature optimization"

### Solutions Eng

- "This solves a real customer problem: they don't know what's in their dependencies"
- "I explained the findings in business terms, not just CVE numbers"
- "Here's how I'd present this to a CTO or security officer"
- "The dashboard makes it easy for non-technical people to understand risk"

### Both

- "I built this to be real, not fake. I ran it against \[Repo\]. Here are the actual findings"
- "I used SYO-701 knowledge (CVE scoring, threat modeling) to guide the feature set"
- "This is a portfolio piece, but it's genuinely useful — I'd use this at a real company"

---

## MILESTONES / WEEKLY BREAKDOWN

**Week 1:**

- Days 1-2: Set up repo, pick target codebase, build dependency scanner
- Days 3-4: Add pattern scanner (hardcoded secrets, basic SQL injection)
- Days 5: Get actual findings, make sure scanner runs without errors

**Week 2:**

- Days 1-3: Build React dashboard, load scanner output, basic table
- Days 4-5: Add filtering, search, severity pie chart

**Week 3:**

- Days 1-2: Polish UX, add export to PDF
- Days 3: Deploy to Vercel, test end-to-end
- Days 4-5: Document, write a killer README, record a 2-min demo

---

## README ESSENTIALS (For GitHub)

````
# Security Audit Platform

Real vulnerability scanner + interactive dashboard.

## Features
- Dependency scanning (CVE detection)
- Pattern-based code analysis (hardcoded secrets, XSS, SQL injection)
- Interactive dashboard with severity breakdown
- Exportable findings report
- Business-focused risk scoring

## Demo

[Screenshot of dashboard]
[Link to live demo or video]

## Run It

```bash
git clone ...
npm install
npm run scan <repo-path>
npm run start  # Start React app
````

## Example Findings

Ran against \[Popular Repo\]. Found:

- 5 Critical CVEs in dependencies
- 12 hardcoded secrets
- 3 SQL injection patterns

\[Show a few findings here\]

## Architecture

Scanner → JSON → Dashboard

## Interview Talking Points

- Real findings in real code
- How I made severity scoring business-relevant
- Trade-offs I made (accuracy vs speed)

```

---

## SUCCESS CRITERIA

When you're done, you should be able to:

✅ Show interviewers a live, working scanner  
✅ Demonstrate actual vulnerabilities it found  
✅ Explain findings in 2 minutes (senior eng) or sell the value (solutions eng)  
✅ Walk through the code and architecture  
✅ Talk about trade-offs and what you'd do differently  
✅ Use security concepts from SYO-701 to guide the feature set  

---

## DON'T FORGET

- Make commits regularly (git history = portfolio)
- Document as you go
- Record a 2-minute video walkthrough
- Test against 2-3 different repos to show it works generally
- Have a README that explains what this is for (interviews)
- Deploy somewhere (Vercel, GitHub Pages, AWS)

---

Good luck. Build something real. Go get those interviews.
```