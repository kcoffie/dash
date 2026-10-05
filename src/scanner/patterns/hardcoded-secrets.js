import fs from 'fs';
import path from 'path';
import { walkDir, isTestFile, isTestOrExampleFile, isCodeSnippetFile } from '../file-utils.js';

// Provider formats are specific enough that a match is a key whatever the value looks like.
// Generic patterns (a password or token assigned a string) capture the value in group 2,
// and are scored by what that value and its file look like. The key may be quoted (JSON).
export const PATTERNS = [
  {
    name: 'AWS Access Key',
    kind: 'provider',
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    severity: 'critical',
    description: 'Hardcoded AWS access key detected',
  },
  {
    name: 'Private Key',
    kind: 'provider',
    regex: /-----BEGIN ((RSA|DSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
    severity: 'critical',
    description: 'Private cryptographic key detected',
  },
  {
    name: 'GitHub/GitLab Token',
    kind: 'provider',
    regex: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,})/g,
    severity: 'critical',
    description: 'GitHub or GitLab authentication token detected',
  },
  {
    name: 'Slack/Discord Webhook',
    kind: 'provider',
    regex: /https:\/\/(hooks\.slack\.com\/services|(discord|discordapp)\.com\/api\/webhooks)\/[^\s"'`]+/g,
    severity: 'high',
    description: 'Webhook URL (Slack/Discord) detected in code',
  },
  {
    // KEY=value in .env files, usually unquoted. The key must end in a secret word, so
    // TOKEN_TTL=3600 and PASSWORD_MIN_LENGTH=12 aren't matched. Commented-out lines count (still leaked).
    name: 'Env File Secret',
    kind: 'generic',
    envOnly: true,
    regex: /^\s*(?:#\s*)?(?:export\s+)?([A-Za-z0-9_]*(?:PASSWORD|PASSWD|PWD|SECRET|SECRET_KEY|TOKEN|API_?KEY|ACCESS_KEY|PRIVATE_KEY))\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#"']+))/gi,
    value: (match) => match[2] ?? match[3] ?? match[4],
    severity: 'high',
    description: 'Secret in an environment file detected',
  },
  {
    name: 'API Token/Key',
    kind: 'generic',
    regex: /(api[_-]?key|apikey|access[_-]?token|token)['"]?\s*[=:]\s*['"`]([^'"`]{20,})['"`]/gi,
    severity: 'high',
    description: 'Potential API key or access token detected',
  },
  {
    name: 'Secret Key',
    kind: 'generic',
    regex: /([\w-]*secret(?:[_-]?key)?)['"]?\s*[=:]\s*['"`]([^'"`]{6,})['"`]/gi,
    severity: 'high',
    description: 'Hardcoded secret key (e.g. a session or JWT signing secret) detected',
  },
  {
    name: 'Database Password',
    kind: 'generic',
    regex: /(password|passwd|pwd)['"]?\s*[=:]\s*['"`]([^'"`]{6,})['"`]/gi,
    severity: 'high',
    description: 'Hardcoded password detected',
  },
];

// Values that are computed or filled in later: `${...}` (JS / Terraform) and `{{ ... }}` (Helm, Handlebars)
const INTERPOLATED = /\$\{|\{\{/;

const PLACEHOLDER_WORDS = new Set([
  'password', 'passw0rd', 'secret', 'changeme', 'change_me', 'change-me', 'example', 'sample', 'test', 'testing',
  'foo', 'bar', 'foobar', 'dummy', 'placeholder', 'redacted', 'todo', 'none', 'null', 'undefined', 'xxx',
]);

function looksLikePlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_WORDS.has(normalized)
    || /^(.)\1+$/.test(normalized) // "xxxxxx", "******"
    || /^<[^>]+>$/.test(normalized) // "<your-token>"
    || /^your[-_ ]|^my[-_]/.test(normalized) // "your_api_key_here", "my_password_here" (not "my little …")
    || /change[-_ ]?me|placeholder|replace[-_ ]?me/.test(normalized);
}

// Shannon entropy in bits per character
function entropy(value) {
  const counts = {};
  for (const char of value) counts[char] = (counts[char] || 0) + 1;
  return Object.values(counts).reduce((sum, count) => {
    const p = count / value.length;
    return sum - p * Math.log2(p);
  }, 0);
}

// Structured data under a data/ or seed directory: an app's seed accounts and fixtures
function isSeedDataFile(filePath) {
  return /\.(ya?ml|json|csv|sql)$/.test(filePath) && /(^|\/)(data|seeds?|seeders?|seeding)\//.test(filePath);
}

// Translation files map UI label keys ("LABEL_PASSWORD") to display text, never to credentials
function isTranslationFile(filePath) {
  return /(^|\/)(i18n|l10n|locales?|translations?|lang)\//.test(filePath);
}

// .env, .env.production, deploy/prod.env
export function isEnvFile(filePath) {
  return /(^|\/)\.env(\.[\w-]+)?$|\.env$/.test(filePath);
}

// .env.example, .env.sample: committed on purpose, with placeholder values
function isEnvExampleFile(filePath) {
  return /(^|\/)\.env\.(example|sample|template|dist|defaults)$/.test(filePath);
}

function isCommentLine(line) {
  return /^\s*(\/\/|\/\*|\*|#|<!--|--)/.test(line);
}

// Severity, confidence, and the factors behind them. Never includes the secret's value.
function assessSecret(pattern, value, keyName, line, filePath) {
  const factors = [];
  let severity = pattern.severity;
  let confidence;
  const inTestOrExample = isTestOrExampleFile(filePath) || isEnvExampleFile(filePath);
  const inSnippet = isCodeSnippetFile(filePath);

  if (pattern.kind === 'provider') {
    factors.push(`✓ Matches the ${pattern.name} format`);
    confidence = 0.9;
    if (inSnippet) {
      factors.push('⚠ In a training/fixture file: still a leak if the key is real');
      confidence = 0.7;
    } else if (inTestOrExample) {
      factors.push('⚠ In a test/example file: still a leak if the key is real');
      confidence = 0.7;
    } else {
      factors.push('✓ In application code or config');
    }
  } else {
    factors.push(`✓ \`${keyName}\` is assigned a literal value`);
    confidence = 0.6;

    if (looksLikePlaceholder(value)) {
      factors.push('⚠ Value looks like a placeholder, not a real credential');
      severity = 'low';
      confidence = 0.2;
    } else if (pattern.name === 'API Token/Key' && entropy(value) < 3) {
      factors.push(`⚠ Low-entropy value (${entropy(value).toFixed(1)} bits/char): real tokens are random`);
      severity = 'low';
      confidence = 0.3;
    } else if (pattern.name === 'API Token/Key' && entropy(value) >= 4) {
      factors.push(`✓ High-entropy value (${entropy(value).toFixed(1)} bits/char): looks like a real token`);
      confidence = 0.75;
    } else {
      factors.push('? Value doesn\'t look like a placeholder');
    }

    if (inSnippet) {
      factors.push('⚠ Non-executed code snippet (training/fixture file, not run by the app)');
      severity = 'low';
      confidence = Math.min(confidence, 0.3);
    } else if (inTestOrExample) {
      factors.push('⚠ In a test/example file (likely a test credential)');
      severity = 'low';
      confidence = Math.min(confidence, 0.3);
    } else if (isSeedDataFile(filePath)) {
      factors.push('⚠ Seed data file: likely a default account password; change it before deploying');
      if (severity !== 'low') severity = 'medium';
      confidence = Math.min(confidence, 0.5);
    } else {
      factors.push('✓ In application code or config');
    }
  }

  if (isCommentLine(line)) {
    factors.push('? In a comment (may be documentation; still a leak if real)');
    confidence -= 0.1;
  } else {
    factors.push('✓ Active code (not in a comment)');
  }

  if (isEnvFile(filePath) && !isEnvExampleFile(filePath)) {
    factors.push('? In a .env file: check that it isn\'t committed (it belongs in .gitignore)');
  }

  return { severity, confidence: Math.round(Math.max(0.1, confidence) * 100) / 100, factors };
}

// The regex may match the tail of a longer name ("Password" in testingPassword)
function wholeIdentifier(line, start, matchedKey) {
  let begin = start;
  while (begin > 0 && /[\w$-]/.test(line[begin - 1])) begin--;
  return line.slice(begin, start) + matchedKey;
}

// Matches on one line, specific provider formats first; a generic match overlapping a
// provider match (api_key = "ghp_...") is the same secret and is dropped
function matchLine(line, { genericAllowed = true, envFile = false } = {}) {
  const matches = [];
  for (const pattern of PATTERNS) {
    if (pattern.kind === 'generic' && !genericAllowed) continue;
    if (pattern.envOnly && !envFile) continue;
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const value = pattern.kind === 'provider' ? match[0] : (pattern.value ? pattern.value(match) : match[2]);
      if (pattern.kind === 'generic' && INTERPOLATED.test(value)) continue;
      if (matches.some((other) => start < other.end && other.start < end)) continue;
      matches.push({ pattern, start, end, value, keyName: pattern.kind === 'generic' ? wholeIdentifier(line, start, match[1]) : null });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

export async function scanForSecrets(targetPath) {
  const findings = [];

  try {
    // A real key in a test file is still leaked, so test files are scanned too (see genericAllowed)
    const files = walkDir(targetPath, { includeTests: true });

    for (const file of files) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue; // Unreadable (permissions, broken symlink)
      }

      const relFile = path.relative(targetPath, file);
      const idBase = `secret-${relFile.replace(/[^\w]/g, '_')}`;
      const lines = content.split('\n');
      // Test files are scanned for provider keys only: their generic passwords are test fixtures
      // (user decision; Juice Shop has 160+ like `const password = '123456'`)
      const genericAllowed = !isTranslationFile(relFile) && !isTestFile(relFile);
      const envFile = isEnvFile(relFile);

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const matches = matchLine(line, { genericAllowed, envFile });

        matches.forEach((match, index) => {
          const { severity, confidence, factors } = assessSecret(match.pattern, match.value, match.keyName, line, relFile);
          findings.push({
            id: `${idBase}-${lineNum + 1}${index > 0 ? `-${index + 1}` : ''}`,
            type: 'hardcoded-secret',
            title: match.pattern.name,
            severity,
            confidence,
            description: match.pattern.description,
            file: relFile,
            line: lineNum + 1,
            snippet: line.trim().replace(/\s+/g, ' ').substring(0, 120),
            context: factors,
            remediation: 'Remove this secret and rotate the credential (assume it has leaked: it is in the repository history). Load secrets from environment variables or a secrets manager instead.',
            references: [
              'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html',
              'https://owasp.org/www-community/Source_Code_Disclosure',
            ],
            tags: ['secret', 'secrets-detection', match.pattern.kind === 'provider' ? 'provider-key' : 'generic-credential'],
          });
        });
      }
    }
  } catch (error) {
    throw new Error(`Secret scanning failed: ${error.message}`);
  }

  return findings;
}
