# Security Audit Platform

Real vulnerability scanner + interactive dashboard for portfolio. It scores findings by exploitability, not just pattern matches.

**Live demo:** https://dash-jade-nine.vercel.app/

![Dashboard, light mode: severity cards, findings-by-type chart, coverage report, and findings table for OWASP Juice Shop](docs/screenshots/dashboard-light.png)

<table>
  <tr>
    <td width="72%"><img src="docs/screenshots/dashboard-dark.png" alt="The same dashboard in dark mode"></td>
    <td><img src="docs/screenshots/phone-dark.png" alt="Phone layout at 390px wide, dark mode"></td>
  </tr>
  <tr>
    <td align="center">Dark mode (follows the system setting)</td>
    <td align="center">Phone, 390px</td>
  </tr>
</table>

## Features

- **Dependency Scanning**: Parse `package.json` → npm audit advisories with the patched version (Node.js only for now)
- **Pattern Detection**: hardcoded secrets, SQL injection, XSS. Insecure crypto and async footguns are planned.
- **Contextual Scoring**: Not just "vuln found" → "exploitable if X AND Y AND Z". Each finding lists the ✓ / ⚠ / ? factors that moved its severity (user input on the line, route handler, escaping nearby, test or training code).
- **Coverage Report**: Shows what was checked *and* what isn't supported yet, so 0 findings means "clean", not "never looked"
- **Interactive Dashboard**: Severity cards, a findings-by-type chart, search, severity and type filters, expandable rows explaining each score. Dark mode follows the system setting, and the layout works on phones.
- **Remediation Guidance**: Fix steps with before/after code, plus OWASP / GitHub advisory links

Validated against intentionally vulnerable apps with known answers: SQL injection 3/3, XSS 8/9 OWASP Juice Shop challenges + 3/3 DVNA.

## How It Works

```
Scanner (Node.js) → JSON Output → React Dashboard
```

1. **Scan.** `npm run scan <repo>` walks the target's source files and runs four checks:
   - **Dependency CVEs:** runs `npm audit` in the target. Severity is the advisory's own.
   - **Hardcoded secrets:** regexes for known key formats (AWS, private keys, tokens) and password/token assignments.
   - **SQL injection and XSS:** regexes find risky constructs, such as SQL built with `+` or `${}`, `innerHTML`, `bypassSecurityTrust*`, and unescaped template output. Multi-line statements are joined first, so a query split across lines still matches.
2. **Score.** For SQL injection and XSS, a match starts at **medium** and moves up or down based on what's in the 15 lines around it:
   - **Up:** request data (`req.body`, `req.query`, …) on the same line or nearby, URL or storage values read in browser code (XSS), or code inside a route handler, which makes it reachable over HTTP.
   - **Down:** escaping, a sanitizer, or a numeric cast nearby, or a value that looks like a constant.
   - **Capped at low:** test, example, and training-snippet files.

   Every adjustment is recorded as a ✓ / ⚠ / ? factor, so the dashboard can show *why*.
3. **Report.** Findings, factors, remediation, and a coverage list (what was checked, what isn't supported yet, and any errors) go to `scanner-output.json`.
4. **Explore.** The React dashboard loads that file, or a committed demo scan, and lets you filter, search, and expand each finding.

Example: Juice Shop's login query (`routes/login.ts:34`) is **critical**. It interpolates `req.body.email` straight into SQL inside a route handler, and the dashboard lists each of those reasons:

![Expanded finding: SQL injection in routes/login.ts:34, with the "Why this severity" factors and how to fix it](docs/screenshots/finding-details.png)

The same construct in Juice Shop's `data/static/codefixes/` training snippets never runs, so those findings are capped at **low**. That's 11 of Juice Shop's 13 SQL injection findings.

## Results on the Demo Targets

The live demo shows these scans. Each one is committed under `public/demo/` with secrets redacted and pinned to the commit shown.

| Target | Dependency CVEs | Secrets | SQL injection | XSS | Total |
|---|---|---|---|---|---|
| [OWASP Juice Shop](https://github.com/juice-shop/juice-shop) @ `1618a61` | 65 | 41 | 13 (1 critical, 1 high, 11 low snippets) | 19 (5 high, 8 medium, 6 low snippets) | 138 |
| [DVNA](https://github.com/appsecco/dvna) @ `9ba473a` | 0 | 0 | 1 (critical) | 10 (medium) | 11 |
| [Express](https://github.com/expressjs/express) @ `7ef9844` | 4 | 1 | 0 (it has no SQL) | 54 (all low: `test/`, `examples/`) | 59 |

**Recall against known answers.** Juice Shop and DVNA document their intended vulnerabilities, which gives an answer key:
- **SQL injection:** 3/3 found (`juice-shop/routes/login.ts:34`, `juice-shop/routes/search.ts:23`, `dvna/core/appHandler.js:10`). Juice Shop's static query and its "correct fix" files are not flagged.
- **XSS:** 8 of 9 Juice Shop challenges and 3/3 DVNA. The miss is Juice Shop's CSP Bypass: user input is spliced into a Pug template string that is then compiled. That's template injection, which the scanner doesn't detect yet.

**Known limitations** (tracked in [HANDOFF.md → Open TODOs](HANDOFF.md#open-todos)):
- **Secrets are noisy.** 30 of Juice Shop's 41 secret findings are "Database Password" matches in seed data.
- **Dependency findings show `@undefined` versions.** They also don't separate dev from runtime dependencies. None of Express's 4 advisories (`diff`, `serialize-javascript`, `uuid`) is a direct dependency of Express.
- **Regex, not data flow.** `search.ts:23` stays **high** rather than critical because `req.query.q` reaches the query through a variable.

## Getting Started

```bash
npm ci
npm run scan <target-repo-path>  # writes scanner-output.json to the current directory
npm run dev                       # dashboard at http://localhost:5173 (loads scanner-output.json)
npm test                          # scanner + dashboard helper tests
npm run demo:export               # regenerate public/demo/ (needs the three targets cloned under /tmp)
npm run screenshots               # regenerate docs/screenshots/ from the live site (needs Chrome)
npm run build                     # production build
```

Try it on a known-vulnerable app: `git clone --depth 1 https://github.com/juice-shop/juice-shop.git /tmp/juice-shop && npm run scan /tmp/juice-shop`.

Without a local `scanner-output.json`, the dashboard opens the Juice Shop demo. Use the "Demo scan" picker to switch to DVNA or Express, or "Load scan file…" to open any report.

## Talking Points

- **The problem:** pattern scanners flag every match, so real issues drown in noise. This one scores exploitability and shows its reasoning: the login SQL injection above is critical for stated reasons, and the identical code in a training snippet is low.
- **Measured, not claimed:** checked against two intentionally vulnerable apps with documented answers. SQL injection 3/3; XSS 8/9 Juice Shop challenges + 3/3 DVNA. The one miss is a known gap (template injection).
- **Honest coverage:** the report lists the 5 categories it doesn't check yet, so "0 findings" can't be mistaken for "secure".
- **Trade-offs:**
  - **Regex + local context instead of an AST or taint analysis:** fast and explainable, but it misses data flow through variables (`search.ts:23`).
  - **Node.js only.**
  - **Recall over precision for now:** the secret noise is visible, not hidden.
- **Engineering:**
  - **Tests:** 70 across 6 suites (scanners, demo export, dashboard logic).
  - **Protected `main`:** CI must pass (`npm ci` → `npm test` → `npm run build`) before anything merges.
  - **Fail-closed demo export:** it refuses to write a file that still contains a key format.
  - **Repo hygiene:** secret scanning and push protection are on.
  - **Accessibility:** contrast measured in light and dark mode, and chart colors checked for color-vision deficiency.
- **Next:** cut secret noise, separate dev from runtime dependencies, then the insecure-crypto and async scanners.

## Project Structure

```
src/
├── scanner/       # CLI, dependency + pattern scanners, shared file helpers, tests
├── components/    # Dashboard components (cards, chart, coverage, filters, table)
├── pages/         # Dashboard page
└── utils/         # Pure dashboard logic (filter/sort/count/chart rows), unit-tested
scripts/           # Demo-data export, README screenshots
public/demo/       # Committed, redacted demo scans served by the deployed dashboard
```

## Milestones

- [x] Week 1: Dependency scanner (npm audit integration)
- [x] Week 1: Pattern scanner (hardcoded secrets, SQL injection, XSS)
- [ ] Deferred: Pattern scanner (insecure crypto, async footguns)
- [x] Week 2: React dashboard with table, search, filtering, coverage report
- [x] Week 2: Severity visualization, dark mode, phone layout
- [x] Week 3: Demo data for three scans with a picker
- [x] Week 3: Deploy (Vercel): https://dash-jade-nine.vercel.app/
- [x] Week 3: README screenshots, how it works, talking points
- [ ] Later: PDF export, false-positive tuning

Status and docs: [STATUS.md](STATUS.md) · [PRD.md](PRD.md) · [DESIGN.md](DESIGN.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
