# Security Audit Platform

Real vulnerability scanner + interactive dashboard for portfolio. It scores findings by exploitability, not just pattern matches.

## Features

- **Dependency Scanning**: Parse `package.json` → npm audit advisories with the patched version (Node.js only for now)
- **Pattern Detection**: hardcoded secrets, SQL injection, XSS. Insecure crypto and async footguns are planned.
- **Contextual Scoring**: Not just "vuln found" → "exploitable if X AND Y AND Z". Each finding lists the ✓ / ⚠ / ? factors that moved its severity (user input on the line, route handler, escaping nearby, test or training code).
- **Coverage Report**: Shows what was checked *and* what isn't supported yet, so 0 findings means "clean", not "never looked"
- **Interactive Dashboard**: Severity cards, a findings-by-type chart, search, severity and type filters, expandable rows explaining each score. Dark mode follows the system setting, and the layout works on phones.
- **Remediation Guidance**: Fix steps with before/after code, plus OWASP / GitHub advisory links

Validated against intentionally vulnerable apps with known answers: SQL injection 3/3, XSS 8/9 OWASP Juice Shop challenges + 3/3 DVNA.

## Architecture

```
Scanner (Node.js) → JSON Output → React Dashboard
```

## Demo

The deployed dashboard opens a committed scan of **OWASP Juice Shop**. Use the "Demo scan" picker to switch to **DVNA** or **Express**. Secret values are redacted in the demo data. *(Live URL: coming with the Vercel deploy.)*

## Getting Started

```bash
npm ci
npm run scan <target-repo-path>  # writes scanner-output.json to the current directory
npm run dev                       # dashboard at http://localhost:5173 (loads scanner-output.json)
npm test                          # scanner + dashboard helper tests
npm run demo:export               # regenerate public/demo/ (needs the three targets cloned under /tmp)
npm run build                     # production build
```

Try it on a known-vulnerable app: `git clone --depth 1 https://github.com/juice-shop/juice-shop.git /tmp/juice-shop && npm run scan /tmp/juice-shop`.

## Project Structure

```
src/
├── scanner/       # CLI, dependency + pattern scanners, shared file helpers, tests
├── components/    # Dashboard components (cards, chart, coverage, filters, table)
├── pages/         # Dashboard page
└── utils/         # Pure dashboard logic (filter/sort/count/chart rows), unit-tested
```

## Milestones

- [x] Week 1: Dependency scanner (npm audit integration)
- [x] Week 1: Pattern scanner (hardcoded secrets, SQL injection, XSS)
- [ ] Deferred: Pattern scanner (insecure crypto, async footguns)
- [x] Week 2: React dashboard with table, search, filtering, coverage report
- [x] Week 2: Severity visualization, dark mode, phone layout
- [x] Week 3: Demo data for three scans with a picker
- [ ] Week 3: Deploy (Vercel), README screenshots
- [ ] Later: PDF export, false-positive tuning

Status and docs: [STATUS.md](STATUS.md) · [PRD.md](PRD.md) · [DESIGN.md](DESIGN.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
