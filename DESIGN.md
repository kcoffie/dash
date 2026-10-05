# Security Audit Platform — Design Doc

**Last Updated:** 2026-10-02. This describes what's built. Ideas not built yet are marked *(not built)*. Requirements are in PRD.md and progress is in STATUS.md.

## Core Concept: Contextual Scoring

The key differentiator: **Don't just flag patterns. Score exploitability based on context.**

### Example

**Naive approach:**
```
❌ SQL Injection pattern found: string concatenation in query
   Severity: HIGH
```

**Contextual approach** (real finding: OWASP Juice Shop `routes/login.ts:34`):
```
❌ Potential SQL Injection (SQL Template Literal Interpolation) · CRITICAL · 90% confidence

   Why this severity:                                       (starts at MEDIUM)
   ✓ Template literal interpolation in SQL query detected
   ⚠ No parameterized query visible
   ✓ User input (req.*) used directly in query              → HIGH
   ⚠ Inside a route handler (reachable over HTTP)           → CRITICAL
```

The same pattern in a test file, a training snippet, or with a constant like `${PAGE_SIZE}` comes out LOW. The pattern is the same; the context is different.

---

## Scoring Model (as built)

| Scanner | Starting severity | What moves it |
|---|---|---|
| SQL injection | MEDIUM, 0.6 confidence | user input (`req.*`) nearby or on the line ↑1 · route handler + input on the line ↑1 more · escaping / `parseInt` nearby ↓1 · constant value → LOW · non-production code → LOW |
| XSS | MEDIUM | no encoding visible · server input (`req.*`) ↑1 · browser-controlled source (URL, storage) ↑1 · route handler + input ↑1 · encoder/sanitizer ↓1 · constant → LOW · non-production → LOW |
| Hardcoded secrets | per pattern: AWS key, private key, GitHub/GitLab token = critical; webhook, API token, secret key, password = high | **provider formats** keep their severity anywhere (a real key leaks wherever it sits). **Generic values:** placeholder (`foobar`, `changeme`, `<…>`) or low-entropy token → LOW · test/example/snippet file → LOW · seed data file (`data/`, `seeds/` + yml/json/csv/sql) → MEDIUM. Templated values (`${…}`, `{{ }}`) aren't findings. `.test.`/`.spec.` files: provider formats only; translation files (`i18n/`, `locales/`): provider formats only |
| Dependency CVEs | npm audit's severity, 0.95 confidence | dev-only (absent from `npm audit --omit=dev`) → LOW · can't tell dev from runtime → 0.85 confidence |

- **Severity ladder:** `low → medium → high → critical`; `shiftSeverity()` moves along it and clamps at the ends.
- **Confidence:** 0.1–0.95, raised by direct evidence and lowered by mitigations.
- **Non-production code** (`nonProductionContext()` in `file-utils.js`): training snippets (`codefixes/`, `snippets/`, `fixtures/`) and test/example files are **capped at LOW**, with a "⚠ Non-executed code snippet" factor and confidence capped at 0.3. This was the user's call: tag these findings, don't drop them.
- **Look-back window:** 15 lines before the statement (`CONTEXT_WINDOW`), for user input, route handlers, and mitigations. Multi-line statements are joined first (`toStatements()`).
- **Factor prefixes:** `✓` evidence found · `⚠` risk or mitigation note · `?` unknown, needs a human. The dashboard renders these as icons.

---

## Scanner Output Format

The full schema is **PRD.md §3**. One finding:

```json
{
  "id": "sqli-routes_login_ts-34",
  "type": "sql-injection",
  "title": "Potential SQL Injection (SQL Template Literal Interpolation)",
  "severity": "critical",
  "confidence": 0.9,
  "description": "SQL query built by interpolating a variable into a template literal",
  "file": "routes/login.ts",
  "line": 34,
  "snippet": "models.sequelize.query(`SELECT * FROM Users WHERE email = '${req.body.email || ''}' AND password = '${security.hash(req.",
  "context": [
    "✓ Template literal interpolation in SQL query detected",
    "⚠ No parameterized query visible",
    "✓ User input (req.*) used directly in query",
    "⚠ Inside a route handler (reachable over HTTP)"
  ],
  "remediation": "Use a parameterized query so the driver handles escaping: … (before/after example)",
  "references": [
    "https://owasp.org/www-community/attacks/SQL_Injection",
    "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html"
  ],
  "tags": ["injection", "sql", "copy-paste-vulnerable"]
}
```

`type` is one of `dependency-cve`, `hardcoded-secret`, `sql-injection`, `xss`, plus `crypto-misuse` and `async-footgun`, which are reserved and not built yet.

---

## Scanners

**Dependency Scanner** (`dependency-scanner.js`, `npm-audit-client.js`)
- Reads `package.json` and runs npm audit, never modifying the target. With a committed `package-lock.json` / `npm-shrinkwrap.json`, audits those versions. Without one, copies `package.json` to a temp dir and resolves a lockfile there first (`npm install --package-lock-only --ignore-scripts`), since `npm audit` fails without a lockfile. npm's own errors (`{ "error": … }`) go to the report's `errors`; they're never read as zero findings. No `package.json` → skipped, and the pattern scan continues. Workspaces without a lockfile → error (can't be resolved from the root `package.json`).
- A second `npm audit --omit=dev` marks dev-only advisories.
- Output: advisory title, severity (and `advisorySeverity` when capped), installed version from the lockfile, affected range, first patched version when the range has a strict upper bound, the direct dependency that pulls it in, and npm's suggested fix (which may name a different package, and may be a downgrade), GHSA link.
- *(not built)* `requirements.txt` / `go.mod` (Phase 2), CVSS score and CVE id, yarn/pnpm lockfiles (resolved fresh instead, with a factor saying so).

**Pattern Scanners** (`src/scanner/patterns/`; shared helpers in `file-utils.js`)
1. **Hardcoded Secrets**: AWS keys (`AKIA`/`ASIA`), private keys (PKCS#1/#8, encrypted, OpenSSH, PGP), GitHub (`ghp_`, `gho_`, `ghs_`, `github_pat_`…) and GitLab (`glpat-`) tokens, Slack/Discord webhooks, and literal values for password / token / API-key / secret keys (quoted JSON keys too; unquoted `KEY=value` in `.env` files, where the key must end in the secret word). Context: value (placeholder, entropy), file kind (test/example, snippet, seed data, translation, `.env`), comment. Factors never include the secret's value.
2. **SQL Injection**: string concatenation and template literals that look like SQL (uppercase keywords anywhere, lowercase only at the start). Context: see the scoring model above.
3. **XSS**: `bypassSecurityTrust*`, `dangerouslySetInnerHTML`, `innerHTML`, `document.write` / `insertAdjacentHTML` / jQuery `.html()`, unescaped template output (EJS/Handlebars/Pug/Vue), `res.send()` of HTML or raw `req.*`. Template files are scanned for XSS only. Angular `[innerHTML]` isn't flagged, because Angular sanitizes it.
4. **Async Footguns** *(not built, deferred)*: `fetch()` without `await` / `.catch()`; is an error handler present, and does an unhandled rejection crash the server?
5. **Insecure Crypto** *(not built, deferred)*: MD5/SHA1 for passwords, hardcoded keys; is it real auth or non-sensitive hashing?

Validation: Juice Shop and DVNA are intentionally vulnerable, so they have known answers. SQLi finds 3/3. XSS finds 8/9 Juice Shop challenges and 3/3 DVNA. Express is a false-positive check: 0 SQLi. The answer key is in HANDOFF.md.

---

## Dashboard Features (as built)

### 1. Summary Cards
One card per severity with its count; clicking a card filters the table. The Info card is hidden when it's 0 (only npm audit emits "info"), unless it's the active filter.

### 2. Findings by Type Chart
One horizontal bar per finding type, biggest first, split into severity segments, with a legend and a total per bar. Hovering or focusing a segment shows a tooltip; clicking a type or segment filters the table. Plain HTML/CSS, no chart library. Severity fills were checked for colorblind separation in both themes.

### 3. Coverage Report (Collapsible)
Shows what was checked and what wasn't, so "0 findings" means "checked and clean", not "never looked":
```
Coverage: checked 4 categories · 5 not yet supported
✓ Dependency CVEs          66 found      Not yet checked
✓ Hardcoded Secrets        27 found      – Insecure Crypto Usage
✓ SQL Injection Patterns   13 found      – CORS Misconfiguration
✓ XSS Vulnerabilities      19 found      – Async Footguns
                                         – Permission Creep
                                         – Logging PII
```
Scan errors, if any, appear here too.

### 4. Findings Table
- Sorted by severity, then confidence, then location
- Columns: severity badge, title + type, file:line, confidence. On phones, the location moves under the title and confidence is hidden.
- Expanded row: description, code snippet, **"Why this severity"** (the context factors), "How to fix", reference links (http(s) only, because a crafted report could carry `javascript:` URLs), tags

### 5. Filters
- Search across title, description, file, snippet, package, and type
- By severity, by type, and by clicking cards or chart segments
- *(not built)* by exploitability; by directory (search on a path works for now)

### 6. Theme & Layout
- Dark mode follows the system preference (no toggle)
- Responsive down to 390px with no horizontal scroll

### 7. Report Sources
- Local `scanner-output.json` first (dev), else the first committed demo (deployed site)
- "Demo scan" picker: OWASP Juice Shop (default), DVNA, Express. The target links to the scanned commit.
- "Load scan file…" for any other report

**Demo data** (`npm run demo:export` → `public/demo/`): the repo is public and Juice Shop plants real-looking private keys, so the export replaces secret findings' snippets and ids with a redaction marker, and it refuses to write a report that still contains an AWS key, private-key header, GitHub/GitLab token, or Slack/Discord webhook anywhere. The finding itself (file, line, severity, factors, fix) stays, so the demo still shows what was found.

*(not built)* confidence distribution, PDF export.

---

## Interview Talking Points

**"Why contextual scoring?"**
- Real-world vulns require multiple factors to exploit
- The same SQLi pattern scores CRITICAL in a login route that takes `req.body`, and LOW in a training snippet. The factors say why.
- Shows you understand threat modeling, not just pattern matching
- *Not claimed yet:* a measured false-positive rate. It needs a labeled sample, and is a Phase 2 TODO.

**"Why focus on AI code?"**
- AI-generated code has unique blind spots (copy-paste, async, type assumptions)
- Shows knowledge of modern dev workflows
- The async-footgun scanner is the piece that targets this most directly, and it's deferred. Say so if asked.

**"Why this over existing tools (SonarQube, Snyk)?"**
- This is smaller, focused, understandable end-to-end
- SonarQube is enterprise bloat; this is designed to teach & communicate
- Context + business framing (exploitability, not just patterns)
