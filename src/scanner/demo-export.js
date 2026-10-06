/**
 * Turns a scanner report into a demo report that's safe to commit to this public repo.
 * Scan targets like Juice Shop plant real-looking private keys, and a secret finding's
 * snippet (and id) would republish them, so those are redacted (as are hardcoded crypto keys),
 * and the result is checked for key material before it's written.
 */

import { PATTERNS } from './patterns/hardcoded-secrets.js';

export const REDACTED = '[redacted in demo report]';

// Key formats with no innocent look-alikes. The generic token/password patterns also match
// ordinary code (a SQL query with a password column), so they'd block legitimate findings.
const KEY_FORMATS = PATTERNS.filter((pattern) => [
  'AWS Access Key', 'Private Key', 'GitHub/GitLab Token', 'Slack/Discord Webhook',
].includes(pattern.name));

// Names of key formats found in a finding (empty when clean)
export function keyMaterialIn(finding) {
  const text = JSON.stringify(finding);
  return KEY_FORMATS
    .filter((pattern) => {
      pattern.regex.lastIndex = 0;
      return pattern.regex.test(text);
    })
    .map((pattern) => pattern.name);
}

// source: { name, repo, commit } — name replaces the local scan path (e.g. /tmp/juice-shop)
export function toDemoReport(report, { name, repo, commit }) {
  const findings = report.findings.map((finding) => {
    if (finding.type === 'hardcoded-secret') {
      return { ...finding, id: `secret-${finding.file}-${finding.line}`, snippet: REDACTED };
    }
    // A hardcoded crypto key's snippet is the key itself (the id is just file + line)
    if (finding.type === 'crypto-misuse' && finding.tags?.includes('hardcoded-key')) {
      return { ...finding, snippet: REDACTED };
    }
    return finding;
  });

  const leaks = findings
    .map((finding) => ({ finding, formats: keyMaterialIn(finding) }))
    .filter(({ formats }) => formats.length > 0)
    .map(({ finding, formats }) => `${finding.type} at ${finding.file}:${finding.line} (${formats.join(', ')})`);
  if (leaks.length > 0) {
    throw new Error(`Demo report for ${name} would publish key material:\n  ${leaks.join('\n  ')}`);
  }

  return { ...report, targetPath: name, source: { repo, commit }, findings };
}
