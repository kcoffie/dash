# Security Audit Platform — Design Doc

## Core Concept: Contextual Scoring

The key differentiator: **Don't just flag patterns. Score exploitability based on context.**

### Example

**Naive approach:**
```
❌ SQL Injection pattern found: string concatenation in query
   Severity: HIGH
```

**Contextual approach:**
```
❌ Potential SQL Injection
   Severity: HIGH (was MEDIUM, upgraded based on context)
   
   Factors:
   • ✓ String concatenation in SQL query detected
   • ⚠ No parameterized query or escaping visible
   • ✓ User input flows to this code (data-flow analysis)
   • ⚠ Endpoint is public API (exploitable to attacker)
   
   → Conclusion: Exploitable. Upgrade to CRITICAL if auth bypass possible.
```

---

## Scanner Output Format

Each finding includes:

```json
{
  "type": "sql-injection-pattern",
  "title": "Potential SQL Injection",
  "severity": "high",
  "description": "String concatenation in SQL query",
  "file": "src/db.js",
  "line": 42,
  "pattern": "const query = 'SELECT * FROM users WHERE id = ' + userId",
  
  "context": [
    "✓ Concatenation pattern detected",
    "⚠ No parameterized query visible",
    "✓ User input reaches this code",
    "?" Endpoint access level unclear (check routes)"
  ],
  
  "remediation": "Use db.query(\"SELECT * FROM users WHERE id = ?\", [userId])",
  "references": ["https://owasp.org/www-community/attacks/SQL_Injection"],
  "confidence": 0.85
}
```

---

## Phase 1 Roadmap

### Week 1: Scanners

**Dependency Scanner**
- Parse `package.json`, `requirements.txt`, `go.mod`
- Query npm audit API / GitHub Advisory Database
- Output: CVE findings with CVSS scores

**Pattern Scanners** (with context)
1. **Hardcoded Secrets**
   - Regex: AWS keys, API tokens, DB passwords
   - Context: Is it in a .env file? Committed? Exposed in error message?

2. **SQL Injection**
   - Pattern: String concatenation in queries
   - Context: Is input sanitized elsewhere? Prepared statements? Public endpoint?

3. **XSS**
   - Pattern: Unsanitized user input in DOM
   - Context: Is it only in logs (safe)? User-visible (risky)? Attacker-controlled?

4. **Async Footguns** (AI/modern code focus)
   - Pattern: `fetch()` without `await` or `.catch()`
   - Context: Is error handler present? Does unhandled rejection crash server?

5. **Insecure Crypto**
   - Pattern: MD5, SHA1 for passwords; hardcoded keys
   - Context: Is it just for non-sensitive hashing? Real auth?

---

## Dashboard Features

### 1. Coverage Report (Collapsible)
Shows what was checked, grouped by result:
```
✅ Checked (9 categories)
   • Hardcoded Secrets
   • SQL Injection
   • XSS
   • Insecure Crypto
   • CORS Misconfig
   • Async Issues
   • Permission Creep
   • Logging PII
   • Dependency CVEs

🔍 Found: 12 findings
```

### 2. Findings Table
- Severity (Critical → Info)
- Title + description
- Exploitability factors (expandable)
- File + line number
- "How to fix" section (expandable)
- Confidence score (0-100%)

### 3. Filters
- By severity
- By type (SQL injection, secrets, etc.)
- By exploitability (found + context confirms, vs. potential only)
- By file / directory

### 4. Quick Stats
- Total findings
- Breakdown by severity
- Breakdown by type
- Confidence distribution

---

## Interview Talking Points

**"Why contextual scoring?"**
- Real-world vulns require multiple factors to exploit
- Reduces false positives from 80% → 20%
- Shows you understand threat modeling, not just pattern matching

**"Why focus on AI code?"**
- AI-generated code has unique blind spots (copy-paste, async, type assumptions)
- Shows knowledge of modern dev workflows
- Demonstrates you can spot the difference between "code bug" and "AI artifact"

**"Why this over existing tools (SonarQube, Snyk)?"**
- This is smaller, focused, understandable end-to-end
- SonarQube is enterprise bloat; this is designed to teach & communicate
- Context + business framing (exploitability, not just patterns)
