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

`type` is one of `dependency-cve`, `hardcoded-secret`, `sql-injection`, `xss`, `crypto-misuse`, or `async-footgun`.

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
4. **Async Footguns** (`async-footgun`): promise chains with no `.catch()` that aren't returned, awaited, or assigned; async `(req, res[, next])` handlers with awaits outside try/catch; `forEach(async …)`, `new Promise(async …)`, async timer callbacks and event listeners. Strings and comments are masked first, and context comes from the signatures of the enclosing functions, not a fixed line window. Context: chain in a route handler or passport callback → medium, high when request input feeds the promise (`req.*`, or the username/password passport-local passes to its verify callback, which come from `req.body`; user decision 2026-10-07); other server code → low; browser code → low; `void` and `import()` are noted as deliberate. Async handlers → high, but not reported when every registration goes through a wrapper (`asyncHandler(…)`-style), on Express 5, or with `express-async-errors`. Severity rules are the user's (session 7).
5. **Insecure Crypto** (`crypto-misuse`): MD5/SHA-1 (`createHash`, `md5`/`sha1` packages, CryptoJS), hardcoded HMAC/cipher/JWT keys, `createCipher` and DES/RC4/ECB, `Math.random()` for security values, JWT verified without an `algorithms` allowlist (or with `none`), Hashids with a literal salt. Context: a weak hash on a password/token line or compared to `req.*` → high; a file checksum → low; inside a small helper → scored by its callers (files importing the helper's module; training snippets don't count); `Math.random()` → medium when the line names a secret/token/salt…, low when only the function or file name does, otherwise not reported; JWT → high with a public key (algorithm confusion), medium otherwise. One finding per line, at the highest severity of its issues. Severity rules are the user's (session 7).

Validation: Juice Shop and DVNA are intentionally vulnerable, so they have known answers. SQLi finds 3/3. XSS finds 8/9 Juice Shop challenges and 3/3 DVNA. Crypto finds 5/6 code-level Juice Shop challenges and 1/1 DVNA. Async: DVNA 15 chains without `.catch()` (hand-checked); Juice Shop's 21 wrapped handlers produce no findings. Express is a false-positive check: 0 SQLi, 0 crypto, 0 async. The answer key is in HANDOFF.md.

---

## Dashboard Features (as built)

### 1. Summary Cards
One card per severity with its count; clicking a card filters the table. The Info card is hidden when it's 0 (only npm audit emits "info"), unless it's the active filter.

### 2. Findings by Type Chart
One horizontal bar per finding type, biggest first, split into severity segments, with a legend and a total per bar. Hovering or focusing a segment shows a tooltip; clicking a type or segment filters the table. Plain HTML/CSS, no chart library. Severity fills were checked for colorblind separation in both themes.

### 3. Coverage Report (Collapsible)
Shows what was checked and what wasn't, so "0 findings" means "checked and clean", not "never looked":
```
Coverage: checked 6 categories · 3 not yet supported
✓ Dependency CVEs          67 found      Not yet checked
✓ Hardcoded Secrets        27 found      – CORS Misconfiguration
✓ SQL Injection Patterns   13 found      – Permission Creep
✓ XSS Vulnerabilities      19 found      – Logging PII
✓ Insecure Crypto Usage    18 found
✓ Async Footguns           16 found
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
- The async-footgun scanner targets this most directly: unhandled rejections are an easy thing for generated Express 4 code to get wrong, and on Node ≥ 15 they crash the server.

**"Why this over existing tools (SonarQube, Snyk)?"**
- This is smaller, focused, understandable end-to-end
- SonarQube is enterprise bloat; this is designed to teach & communicate
- Context + business framing (exploitability, not just patterns)
