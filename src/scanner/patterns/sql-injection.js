import fs from 'fs';
import path from 'path';
import { shouldSkipFile, isSourceFile, isTestOrExampleFile, walkDir, toStatements, ROUTE_HANDLER } from '../file-utils.js';

// A string literal that reads like a SQL statement, not just prose containing "select ... from".
// Uppercase keywords count anywhere; lowercase SQL only counts when the string starts with it.
const SQL_CLAUSE = String.raw`(SELECT\s+[\w*,\s.()]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE|WHERE\s+\w+\s*(=|LIKE|IN))\b`;
const SQL_UPPERCASE = new RegExp(String.raw`\b${SQL_CLAUSE}`);
const SQL_LEADING = new RegExp(String.raw`^\s*${SQL_CLAUSE}`, 'i');

function looksLikeSql(text) {
  return SQL_UPPERCASE.test(text) || SQL_LEADING.test(text);
}

const PATTERNS = [
  {
    name: 'SQL String Concatenation',
    // 'SELECT ... WHERE id = ' + userId   or   "... '" + name + "'"
    regex: /(['"])((?:(?!\1).)*)\1\s*\+\s*[\w$.[\]()]+/g,
    // The SQL may be split across several concatenated literals, so check them all together
    sqlText: (match, statement) => [...statement.matchAll(/(['"])((?:(?!\1).)*)\1/g)].map((m) => m[2]).join(''),
    detected: '✓ String concatenation in SQL query detected',
    description: 'SQL query built by concatenating a variable into the query string',
  },
  {
    name: 'SQL Template Literal Interpolation',
    // `SELECT * FROM users WHERE id = ${userId}`
    regex: /`([^`]*\$\{[^}]+\}[^`]*)`/g,
    sqlText: (match) => match[1],
    detected: '✓ Template literal interpolation in SQL query detected',
    description: 'SQL query built by interpolating a variable into a template literal',
  },
];

const USER_INPUT = /\breq\.(query|params|body|headers|cookies)\b|\bctx\.(query|params|request)\b|\brequest\.(query|params|body|payload)\b/;
const ESCAPING = /\b(escape|escapeId|escapeLiteral|escapeIdentifier)\s*\(|\b(parseInt|Number|parseFloat)\s*\(/;
const PLACEHOLDER = /\?|\$\d+|(?<![\w:]):[a-zA-Z_]\w*/;

// How far above a match to look for user input / route handlers / escaping
const CONTEXT_WINDOW = 15;

const SEVERITY_LADDER = ['low', 'medium', 'high', 'critical'];

function shiftSeverity(severity, steps) {
  const index = SEVERITY_LADDER.indexOf(severity) + steps;
  return SEVERITY_LADDER[Math.max(0, Math.min(SEVERITY_LADDER.length - 1, index))];
}

function interpolatedValues(statement, matchedText) {
  const fromTemplate = [...matchedText.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
  const fromConcat = [...statement.matchAll(/\+\s*([\w$.[\]()]+)/g)].map((m) => m[1].trim());
  return [...fromTemplate, ...fromConcat];
}

function isConstantValue(value) {
  return /^[A-Z][A-Z0-9_]*$/.test(value) || /^\d+$/.test(value);
}

function assessContext(lines, statement, matchedText, sqlText, filePath, pattern) {
  const { text, startLine, endLine } = statement;
  const nearby = lines.slice(Math.max(0, startLine - CONTEXT_WINDOW), endLine + 1).join('\n');
  const values = interpolatedValues(text, matchedText);

  const factors = [pattern.detected];
  let severity = 'medium';
  let confidence = 0.6;

  if (PLACEHOLDER.test(sqlText)) {
    factors.push('⚠ Query also uses placeholders (partially parameterized)');
  } else {
    factors.push('⚠ No parameterized query visible');
  }

  const userInputOnLine = USER_INPUT.test(text);
  if (userInputOnLine || USER_INPUT.test(nearby)) {
    factors.push(userInputOnLine
      ? '✓ User input (req.*) used directly in query'
      : '✓ User input (req.*) read nearby — likely flows into query');
    severity = shiftSeverity(severity, 1);
    confidence += userInputOnLine ? 0.25 : 0.15;
  } else {
    factors.push('? No user input visible nearby (check where values come from)');
  }

  if (ROUTE_HANDLER.test(nearby)) {
    factors.push('⚠ Inside a route handler (reachable over HTTP)');
    if (userInputOnLine) severity = shiftSeverity(severity, 1);
    confidence += 0.05;
  } else {
    factors.push('? Endpoint access level unclear (check routes)');
  }

  if (ESCAPING.test(nearby)) {
    factors.push('⚠ Escaping or numeric cast visible nearby (may be mitigated)');
    severity = shiftSeverity(severity, -1);
    confidence -= 0.2;
  }

  if (values.length > 0 && values.every(isConstantValue)) {
    factors.push('⚠ Interpolated value looks like a constant (likely not attacker-controlled)');
    severity = 'low';
    confidence -= 0.3;
  }

  if (isTestOrExampleFile(filePath)) {
    factors.push('⚠ In test/example file (lower real-world risk)');
    confidence -= 0.15;
  }

  return {
    factors,
    severity,
    confidence: Math.round(Math.max(0.1, Math.min(0.95, confidence)) * 100) / 100,
  };
}

function remediationFor(pattern) {
  const example = pattern.name === 'SQL Template Literal Interpolation'
    ? 'db.query(`SELECT * FROM users WHERE id = ?`, [userId])  // instead of `... WHERE id = ${userId}`'
    : "db.query('SELECT * FROM users WHERE id = ?', [userId])  // instead of '... WHERE id = ' + userId";
  return `Use a parameterized query so the driver handles escaping: ${example}. For dynamic identifiers (table/column names), validate against an allowlist.`;
}

export async function scanForSqlInjection(targetPath) {
  const findings = [];
  const seen = new Set();

  try {
    const files = walkDir(targetPath);

    for (const file of files) {
      if (shouldSkipFile(file) || !isSourceFile(file)) continue;

      let content;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch (error) {
        continue;
      }

      const relFile = path.relative(targetPath, file);
      const lines = content.split('\n');

      for (const statement of toStatements(lines)) {
        const firstLine = lines[statement.startLine].trim();
        if (firstLine.startsWith('//') || firstLine.startsWith('*')) continue;

        const lineNumber = statement.startLine + 1;
        const findingKey = `${relFile}:${lineNumber}`;

        for (const pattern of PATTERNS) {
          pattern.regex.lastIndex = 0;
          let match;

          while ((match = pattern.regex.exec(statement.text)) !== null) {
            const sqlText = pattern.sqlText(match, statement.text);
            if (!looksLikeSql(sqlText)) continue;
            if (seen.has(findingKey)) continue;
            seen.add(findingKey);

            const { factors, severity, confidence } = assessContext(lines, statement, match[0], sqlText, relFile, pattern);

            findings.push({
              id: `sqli-${relFile.replace(/[^\w]/g, '_')}-${lineNumber}`,
              type: 'sql-injection',
              title: `Potential SQL Injection (${pattern.name})`,
              severity,
              confidence,
              description: pattern.description,
              file: relFile,
              line: lineNumber,
              snippet: statement.text.replace(/\s+/g, ' ').trim().substring(0, 120),
              context: factors,
              remediation: remediationFor(pattern),
              references: [
                'https://owasp.org/www-community/attacks/SQL_Injection',
                'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html',
              ],
              tags: ['injection', 'sql', 'copy-paste-vulnerable'],
            });
          }
        }
      }
    }
  } catch (error) {
    throw new Error(`SQL injection scanning failed: ${error.message}`);
  }

  return findings;
}
