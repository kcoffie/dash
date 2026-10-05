import fs from 'fs';
import path from 'path';
import { walkDir } from '../file-utils.js';

export const PATTERNS = [
  {
    name: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/g,
    severity: 'critical',
    description: 'Hardcoded AWS access key detected',
  },
  {
    name: 'Private Key',
    regex: /-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY/g,
    severity: 'critical',
    description: 'Private cryptographic key detected',
  },
  {
    name: 'API Token/Key',
    regex: /(api[_-]?key|apikey|access[_-]?token|token)\s*[=:]\s*['"`][^'"`]{20,}['"`]/gi,
    severity: 'high',
    description: 'Potential API key or access token detected',
  },
  {
    name: 'Database Password',
    regex: /(password|passwd|pwd)\s*[=:]\s*['"`]([^'"`]{6,})['"`]/gi,
    severity: 'high',
    description: 'Database password in configuration detected',
  },
  {
    name: 'GitHub/GitLab Token',
    regex: /(ghp_|glpat_|github_token)[A-Za-z0-9_]{30,}/g,
    severity: 'critical',
    description: 'GitHub or GitLab authentication token detected',
  },
  {
    name: 'Slack/Discord Webhook',
    regex: /https:\/\/(hooks\.slack\.com|discordapp\.com\/api\/webhooks)\/[^\s"'`]+/g,
    severity: 'high',
    description: 'Webhook URL (Slack/Discord) detected in code',
  },
];

function getContextFactors(line, filePath, matchedText) {
  const factors = [];

  if (filePath.includes('.env')) {
    factors.push('✓ In .env file (less critical if not committed)');
  }

  if (filePath.includes('/test') || filePath.includes('/example') || filePath.includes('.test.') || filePath.includes('.spec.')) {
    factors.push('⚠ In test/example file (may be intentional/fake)');
  }

  if (line.includes('//') || line.includes('/*')) {
    factors.push('? In or near comment (may be example/documentation)');
  }

  // Check for obvious fake passwords
  const lowercaseMatch = matchedText.toLowerCase();
  if (['test', 'demo', 'example', 'foobar', 'password', 'secret', '123456', '12345678'].some((fake) => lowercaseMatch.includes(fake))) {
    factors.push('⚠ Matches common test password pattern (likely fake)');
  }

  if (!line.trim().startsWith('//') && !line.trim().startsWith('*')) {
    factors.push('✓ Active code (not in comment)');
  }

  const entropy = estimateEntropy(matchedText);
  if (entropy > 4.5) {
    factors.push(`✓ High entropy (${entropy.toFixed(1)}) - likely real secret`);
  } else if (entropy < 3) {
    factors.push(`⚠ Low entropy (${entropy.toFixed(1)}) - may be test/placeholder`);
  }

  if (factors.length === 0) {
    factors.push('⚠ Unable to determine context (manual review needed)');
  }

  return factors;
}

function estimateEntropy(str) {
  const frequencies = {};
  for (const char of str) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }

  let entropy = 0;
  for (const freq of Object.values(frequencies)) {
    const p = freq / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export async function scanForSecrets(targetPath) {
  const findings = [];
  const seen = new Set();

  try {
    const files = walkDir(targetPath);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];

          for (const pattern of PATTERNS) {
            let match;
            // Reset regex lastIndex for each line (reusable regex issue)
            pattern.regex.lastIndex = 0;

            while ((match = pattern.regex.exec(line)) !== null) {
              const findingId = `${file}-${lineNum}-${pattern.name}-${match[0].substring(0, 10)}`;
              if (!seen.has(findingId)) {
                seen.add(findingId);

                const relFile = path.relative(targetPath, file);
                const context = getContextFactors(line, relFile, match[0]);

                findings.push({
                  id: `secret-${findingId.split('-').slice(-1)[0]}`,
                  type: 'hardcoded-secret',
                  title: pattern.name,
                  severity: pattern.severity,
                  confidence: 0.8,
                  description: pattern.description,
                  file: relFile,
                  line: lineNum + 1,
                  snippet: line.trim().substring(0, 100),
                  context,
                  remediation: `Remove this secret and rotate credentials immediately. Store secrets in environment variables or a secrets manager, not in code.`,
                  references: ['https://owasp.org/www-community/Source_Code_Disclosure'],
                  tags: ['secret', 'critical', 'secrets-detection'],
                });
              }
            }
          }
        }
      } catch (error) {
        // Skip files that can't be read as text
        continue;
      }
    }
  } catch (error) {
    throw new Error(`Secret scanning failed: ${error.message}`);
  }

  return findings;
}
