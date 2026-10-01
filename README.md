# Security Audit Platform

Real vulnerability scanner + interactive dashboard for portfolio.

## Features

- **Dependency Scanning**: Parse package.json, requirements.txt, go.mod → check against CVE database
- **Pattern Detection**: Grep for hardcoded secrets, SQL injection, XSS, insecure crypto, CORS misconfig, async footguns, permission creep
- **Contextual Scoring**: Not just "vuln found" → "exploitable if X AND Y AND Z" (reduces noise, increases signal)
- **Coverage Report**: Show what was checked *and* what was found (demonstrates thoroughness)
- **Interactive Dashboard**: Findings grouped by exploitability + context, search/filter by type and severity
- **Remediation Guidance**: Business impact and fix steps for each finding
- **AI/Modern Code Focus**: Catch pitfalls common in AI-generated code (copy-paste vulns, async issues, type assumptions)

## Architecture

```
Scanner (Node.js) → JSON Output → React Dashboard
```

## Getting Started

```bash
npm install
npm run scan <target-repo-path>  # Run vulnerability scanner
npm run dev                       # Start React dev server
npm run build                     # Build for production
```

## Project Structure

```
src/
├── scanner/       # Dependency & pattern scanning logic
├── components/    # React components for dashboard
├── pages/         # Page layouts
└── utils/         # Helper functions
```

## Milestones

- [x] Week 1: Dependency scanner (npm audit integration)
- [x] Week 1: Pattern scanner (hardcoded secrets, SQL injection, XSS)
- [ ] Week 1 (deferred): Pattern scanner (insecure crypto, async footguns)
- [ ] Week 2: React dashboard with table & filtering
- [ ] Week 2: Severity visualization & search
- [ ] Week 3: Polish, export to PDF, deploy
