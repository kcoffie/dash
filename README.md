# Security Audit Platform

Real vulnerability scanner + interactive dashboard for portfolio.

## Features

- **Dependency Scanning**: Parse package.json, requirements.txt, go.mod → check against CVE database
- **Pattern Detection**: Grep for hardcoded secrets, SQL injection, XSS, insecure crypto, CORS misconfig
- **Interactive Dashboard**: Findings grouped by severity with filtering, search, and visualization
- **Remediation Guidance**: Business context and fix steps for each finding
- **Export Reports**: Generate PDF reports of audit findings

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

- [ ] Week 1: Dependency scanner (npm audit integration)
- [ ] Week 1: Pattern scanner (hardcoded secrets, SQL injection)
- [ ] Week 2: React dashboard with table & filtering
- [ ] Week 2: Severity visualization & search
- [ ] Week 3: Polish, export to PDF, deploy
