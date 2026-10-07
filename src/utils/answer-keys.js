// Compares a scan report against a hand-written answer key (answer-keys/*.json).
// Design and rules: docs/design-notes/answer-key-test.md. Dependency CVEs are out of scope
// (no target commits a lockfile, so advisories drift), so they're ignored here.

export const STATUSES = ['found', 'reviewed', 'not flagged', 'known miss'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const TYPES = ['hardcoded-secret', 'sql-injection', 'xss', 'crypto-misuse', 'async-footgun'];

// An entry names a file exactly (`file`) or by prefix/suffix (`pattern`), and optionally a line range
function matchesFile(entry, file) {
  if (entry.file !== undefined) return entry.file === file;
  const { startsWith = '', endsWith = '' } = entry.pattern;
  return file.startsWith(startsWith) && file.endsWith(endsWith);
}

function matches(entry, finding) {
  if (finding.type !== entry.type || !matchesFile(entry, finding.file)) return false;
  if (!entry.lines) return true;
  return finding.line >= entry.lines[0] && finding.line <= entry.lines[1];
}

function isNonProduction(key, file) {
  return (key.nonProduction ?? []).some((p) => matchesFile({ pattern: p }, file));
}

function where(entry) {
  const file = entry.file ?? `${entry.pattern.startsWith ?? ''}*${entry.pattern.endsWith ?? ''}`;
  return entry.lines ? `${file}:${entry.lines[0]}-${entry.lines[1]}` : file;
}

// Shape problems in a key, so a typo can't turn an entry into a check that always passes
export function validateKey(key) {
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(key.commit ?? '')) problems.push('commit must be a full 40-character SHA');
  for (const p of key.nonProduction ?? []) {
    if (!p.startsWith && !p.endsWith) problems.push('nonProduction pattern needs startsWith or endsWith');
  }
  (key.entries ?? []).forEach((e, i) => {
    const at = `entry ${i}`;
    if (!STATUSES.includes(e.status)) problems.push(`${at}: unknown status "${e.status}"`);
    if (!TYPES.includes(e.type)) problems.push(`${at}: unknown type "${e.type}"`);
    if ((e.file === undefined) === (e.pattern === undefined)) problems.push(`${at}: needs exactly one of file or pattern`);
    if (e.pattern && !e.pattern.startsWith && !e.pattern.endsWith) problems.push(`${at}: pattern needs startsWith or endsWith`);
    if (e.lines && !(Number.isInteger(e.lines[0]) && Number.isInteger(e.lines[1]) && e.lines[0] >= 1 && e.lines[0] <= e.lines[1])) {
      problems.push(`${at}: lines must be [start, end] with 1 <= start <= end`);
    }
    if (!e.why) problems.push(`${at}: why is required`);
    if (e.status === 'found' || e.status === 'reviewed') {
      if (!SEVERITIES.includes(e.severity)) problems.push(`${at}: ${e.status} needs a severity`);
      if (e.file === undefined || !e.lines) problems.push(`${at}: ${e.status} needs a file and lines`);
    }
    if (e.status === 'reviewed' && !e.reason) problems.push(`${at}: reviewed needs a reason`);
  });
  return problems;
}

// Returns { failures: [{ kind, message }], recall: { [challenge]: boolean } }
export function compareToKey(key, { findings, errors = [] }) {
  const failures = [];
  const fail = (kind, message) => failures.push({ kind, message });
  const scanned = findings.filter((f) => f.type !== 'dependency-cve');

  for (const error of errors) fail('scanner error', error);

  const expected = key.entries.filter((e) => e.status === 'found' || e.status === 'reviewed');
  const claimed = (f) => expected.some((e) => matches(e, f));

  const recall = {};
  const keyed = new Set();
  for (const entry of key.entries) {
    const hits = scanned.filter((f) => matches(entry, f));
    if (entry.status === 'found' || entry.status === 'reviewed') {
      hits.forEach((f) => keyed.add(f));
      const ok = hits.length > 0 && hits.every((f) => f.severity === entry.severity);
      if (hits.length === 0) {
        // Moved only if a same-type finding in the file isn't another entry's
        const elsewhere = scanned.filter((f) => f.type === entry.type && f.file === entry.file && !claimed(f));
        if (elsewhere.length > 0) {
          fail('moved', `${where(entry)} ${entry.type}: not in range; same type reported at line(s) ${elsewhere.map((f) => f.line).join(', ')}`);
        } else {
          fail('missing', `${where(entry)} ${entry.type} (${entry.severity}) not reported`);
        }
      } else {
        for (const f of hits.filter((h) => h.severity !== entry.severity)) {
          fail('wrong severity', `${f.file}:${f.line} ${entry.type}: ${f.severity}, expected ${entry.severity}`);
        }
      }
      if (entry.status === 'found') {
        for (const c of entry.challenges ?? []) recall[c] = (recall[c] ?? true) && ok;
      }
    } else {
      for (const f of hits) {
        fail(entry.status === 'known miss' ? 'known miss found' : 'not flagged appears',
          entry.status === 'known miss'
            ? `${f.file}:${f.line} ${entry.type} is now reported: update the answer key (${where(entry)})`
            : `${f.file}:${f.line} ${entry.type} reported, but the key says not flagged (${where(entry)})`);
      }
    }
  }

  // Every loud finding in production code must be a reviewed decision, not silent drift
  for (const f of scanned) {
    if ((f.severity === 'high' || f.severity === 'critical') && !keyed.has(f) && !isNonProduction(key, f.file)) {
      fail('unkeyed high', `${f.file}:${f.line} ${f.type} (${f.severity}) has no answer-key entry`);
    }
  }

  // DESIGN: non-production code is capped at low. Provider-format secrets are the exception
  // (they keep their severity anywhere), and a key can't tell them from generic values, so
  // secrets are left out of this rule.
  for (const f of scanned) {
    if (f.type !== 'hardcoded-secret' && f.severity !== 'low' && isNonProduction(key, f.file)) {
      fail('non-production above low', `${f.file}:${f.line} ${f.type} is ${f.severity} in non-production code`);
    }
  }

  const rules = key.rules ?? {};
  for (const type of rules.noFindingsOfType ?? []) {
    const n = scanned.filter((f) => f.type === type).length;
    if (n > 0) fail('spec rule', `${n} ${type} finding(s); the spec says none`);
  }
  if (rules.maxSeverity) {
    const cap = SEVERITIES.indexOf(rules.maxSeverity);
    const over = scanned.filter((f) => SEVERITIES.indexOf(f.severity) > cap);
    if (over.length > 0) fail('spec rule', `${over.length} finding(s) above ${rules.maxSeverity}, e.g. ${over[0].file}:${over[0].line}`);
  }

  return { failures, recall };
}

// Scanner types with at least one found entry across all keys: a type with none can't show
// that a crashed or empty scan is wrong
export function typesWithFoundEntries(keys) {
  return TYPES.filter((t) => keys.some((k) => k.entries.some((e) => e.status === 'found' && e.type === t)));
}
