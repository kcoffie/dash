// Compares a scan report against a hand-written answer key (answer-keys/*.json).
// Design and rules: docs/design-notes/answer-key-test.md. Dependency CVEs are out of scope
// (no target commits a lockfile, so advisories drift), so they're ignored here.

export const STATUSES = ['found', 'reviewed', 'not flagged', 'known miss'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const TYPES = ['hardcoded-secret', 'sql-injection', 'xss', 'crypto-misuse', 'async-footgun'];

// An entry names a file exactly (`file`) or by prefix/suffix (`pattern`), and optionally a line range
export function matchesFile(entry, file) {
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

export function where(entry) {
  const file = entry.file ?? `${entry.pattern.startsWith ?? ''}*${entry.pattern.endsWith ?? ''}`;
  return entry.lines ? `${file}:${entry.lines[0]}-${entry.lines[1]}` : file;
}

// A file pattern is { startsWith?, endsWith? } with string values. A plain string (e.g. a glob)
// would pass a loose check and then match nothing, so it's rejected.
function isPattern(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return false;
  const keys = Object.keys(p);
  return keys.length > 0 && keys.every((k) => (k === 'startsWith' || k === 'endsWith') && typeof p[k] === 'string' && p[k] !== '');
}

const RULES = ['noFindingsOfType', 'maxSeverity'];
// Every field a key or entry may have: a misspelled one (rule, nonproduction, challenge) would switch its check off silently
const KEY_FIELDS = ['target', 'repo', 'commit', 'sources', 'nonProduction', 'rules', 'entries'];
const ENTRY_FIELDS = ['status', 'type', 'file', 'pattern', 'lines', 'severity', 'challenges', 'why', 'reason'];

// Shape problems in a key, so a typo can't turn an entry or rule into a check that always passes
export function validateKey(key) {
  const problems = [];
  for (const name of Object.keys(key)) if (!KEY_FIELDS.includes(name)) problems.push(`unknown field "${name}"`);
  if (!/^[0-9a-f]{40}$/.test(key.commit ?? '')) problems.push('commit must be a full 40-character SHA');
  if (!Array.isArray(key.entries)) problems.push('entries must be an array');
  if (key.nonProduction !== undefined && !(Array.isArray(key.nonProduction) && key.nonProduction.every(isPattern))) {
    problems.push('nonProduction must be a list of { startsWith, endsWith } patterns');
  }
  const rules = key.rules ?? {};
  for (const name of Object.keys(rules)) if (!RULES.includes(name)) problems.push(`unknown rule "${name}"`);
  if (rules.noFindingsOfType !== undefined
    && !(Array.isArray(rules.noFindingsOfType) && rules.noFindingsOfType.every((t) => TYPES.includes(t)))) {
    problems.push('rules.noFindingsOfType must list known types');
  }
  if (rules.maxSeverity !== undefined && !SEVERITIES.includes(rules.maxSeverity)) problems.push('rules.maxSeverity must be a severity');
  (Array.isArray(key.entries) ? key.entries : []).forEach((e, i) => {
    const at = `entry ${i}`;
    for (const name of Object.keys(e)) if (!ENTRY_FIELDS.includes(name)) problems.push(`${at}: unknown field "${name}"`);
    if (!STATUSES.includes(e.status)) problems.push(`${at}: unknown status "${e.status}"`);
    if (!TYPES.includes(e.type)) problems.push(`${at}: unknown type "${e.type}"`);
    if ((e.file === undefined) === (e.pattern === undefined)) problems.push(`${at}: needs exactly one of file or pattern`);
    if (e.pattern !== undefined && !isPattern(e.pattern)) problems.push(`${at}: pattern must be { startsWith, endsWith } with string values`);
    if (e.lines && !(Number.isInteger(e.lines[0]) && Number.isInteger(e.lines[1]) && e.lines[0] >= 1 && e.lines[0] <= e.lines[1])) {
      problems.push(`${at}: lines must be [start, end] with 1 <= start <= end`);
    }
    if (e.challenges !== undefined && !(Array.isArray(e.challenges) && e.challenges.every((c) => typeof c === 'string'))) {
      problems.push(`${at}: challenges must be a list of names`);
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

// Returns { failures: [{ kind, message }], recall: { [type]: { [challenge]: boolean } }, sites: { [type]: { reported, total } } }.
// A challenge is recalled when every found entry of that type tagged with it is reported at its severity; one tagged only on
// known-miss / not-flagged entries is not recalled. Sites are found + known-miss entries (the way the PRD counts recall).
export function compareToKey(key, { findings, errors = [] }) {
  const failures = [];
  const fail = (kind, message) => failures.push({ kind, message });
  const scanned = findings.filter((f) => f.type !== 'dependency-cve');

  for (const error of errors) fail('scanner error', error);

  const expected = key.entries.filter((e) => e.status === 'found' || e.status === 'reviewed');
  const claimed = (f) => expected.some((e) => matches(e, f));

  const recall = {};
  const missed = {}; // { [type]: Set of challenges tagged on known-miss / not-flagged entries }
  const sites = {};
  const site = (type) => (sites[type] ??= { reported: 0, total: 0 });
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
        site(entry.type).total++;
        if (ok) site(entry.type).reported++;
        for (const c of entry.challenges ?? []) {
          const byType = (recall[entry.type] ??= {});
          byType[c] = (byType[c] ?? true) && ok;
        }
      }
    } else {
      if (entry.status === 'known miss') site(entry.type).total++;
      for (const c of entry.challenges ?? []) (missed[entry.type] ??= new Set()).add(c);
      for (const f of hits) {
        fail(entry.status === 'known miss' ? 'known miss found' : 'not flagged appears',
          entry.status === 'known miss'
            ? `${f.file}:${f.line} ${entry.type} is now reported: update the answer key (${where(entry)})`
            : `${f.file}:${f.line} ${entry.type} reported, but the key says not flagged (${where(entry)})`);
      }
    }
  }

  // Every loud finding in production code must be a reviewed decision, not silent drift. Secrets
  // count in non-production code too: only provider formats may stay high there (DESIGN), so each
  // one needs an entry, and a generic value that stopped being capped shows up here.
  for (const f of scanned) {
    const exempt = isNonProduction(key, f.file) && f.type !== 'hardcoded-secret';
    if ((f.severity === 'high' || f.severity === 'critical') && !keyed.has(f) && !exempt) {
      fail('unkeyed high', `${f.file}:${f.line} ${f.type} (${f.severity}) has no answer-key entry`);
    }
  }

  // DESIGN: non-production code is capped at low. Provider-format secrets are the exception (they keep
  // their severity anywhere, and are always high or critical), so a high/critical secret there is left to
  // the unkeyed-high rule above; a medium one is a generic value that escaped the cap (user decision 2026-10-08).
  for (const f of scanned) {
    const providerSeverity = f.type === 'hardcoded-secret' && (f.severity === 'high' || f.severity === 'critical');
    if (!providerSeverity && f.severity !== 'low' && isNonProduction(key, f.file)) {
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

  // A challenge with found entries follows them; one tagged only on misses is not recalled
  for (const [type, challenges] of Object.entries(missed)) {
    for (const c of challenges) {
      const byType = (recall[type] ??= {});
      if (!(c in byType)) byType[c] = false;
    }
  }

  return { failures, recall, sites };
}

// Scanner types with at least one found entry across all keys: a type with none can't show
// that a crashed or empty scan is wrong
export function typesWithFoundEntries(keys) {
  return TYPES.filter((t) => keys.some((k) => k.entries.some((e) => e.status === 'found' && e.type === t)));
}
