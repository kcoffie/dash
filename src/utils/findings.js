// Pure helpers for the dashboard: no React, so they run under `npm test`.

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export const TYPE_LABELS = {
  'dependency-cve': 'Dependency CVE',
  'hardcoded-secret': 'Hardcoded secret',
  'sql-injection': 'SQL injection',
  xss: 'XSS',
  'crypto-misuse': 'Insecure crypto',
  'async-footgun': 'Async footgun',
};

export function typeLabel(type) {
  return TYPE_LABELS[type] ?? type;
}

// Scanner ids aren't guaranteed unique (secret ids are derived from the match), so key on location too
export function findingKey(finding, index) {
  return `${finding.type}:${finding.file ?? ''}:${finding.line ?? ''}:${finding.id}:${index}`;
}

export function location(finding) {
  if (!finding.file) return '';
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

const SEARCHED_FIELDS = ['title', 'description', 'file', 'snippet', 'package', 'type'];

export function matchesQuery(finding, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return SEARCHED_FIELDS.some((field) => String(finding[field] ?? '').toLowerCase().includes(needle))
    || typeLabel(finding.type).toLowerCase().includes(needle);
}

export function filterFindings(findings, { severity = 'all', type = 'all', query = '' } = {}) {
  return findings.filter((finding) => (severity === 'all' || finding.severity === severity)
    && (type === 'all' || finding.type === type)
    && matchesQuery(finding, query));
}

function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  return rank === -1 ? SEVERITIES.length : rank;
}

// Most severe first; within a severity, most confident first; then by location for a stable order
export function sortFindings(findings) {
  return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity)
    || (b.confidence ?? 0) - (a.confidence ?? 0)
    || location(a).localeCompare(location(b), undefined, { numeric: true }));
}

export function countBySeverity(findings) {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) {
    if (finding.severity in counts) counts[finding.severity]++;
  }
  return counts;
}

export function countByType(findings) {
  const counts = {};
  for (const finding of findings) {
    counts[finding.type] = (counts[finding.type] ?? 0) + 1;
  }
  return counts;
}

// Summary cards to show. Info is almost always 0 (only npm audit emits it), and a lone empty card wastes a row
// on phones, so hide it when empty unless it's the active filter.
export function summarySeverities(counts, selected = 'all') {
  return SEVERITIES.filter((severity) => severity !== 'info' || counts.info > 0 || selected === 'info');
}

// Chart rows: one per finding type, biggest first, each split into severity segments (most severe first, empty ones dropped)
export function severityByType(findings) {
  const rows = new Map();
  for (const finding of findings) {
    if (!rows.has(finding.type)) rows.set(finding.type, { type: finding.type, total: 0, counts: {} });
    const row = rows.get(finding.type);
    row.total++;
    row.counts[finding.severity] = (row.counts[finding.severity] ?? 0) + 1;
  }
  return [...rows.values()]
    .sort((a, b) => b.total - a.total || typeLabel(a.type).localeCompare(typeLabel(b.type)))
    .map(({ type, total, counts }) => ({
      type,
      total,
      segments: Object.keys(counts)
        .sort((a, b) => severityRank(a) - severityRank(b))
        .map((severity) => ({ severity, count: counts[severity] })),
    }));
}

// Scanner context factors start with ✓ (evidence found), ⚠ (risk or mitigation note), or ? (unknown)
export function parseFactor(text) {
  const match = text.match(/^\s*(✓|⚠|\?)\s*(.*)$/s);
  if (!match) return { kind: 'note', text };
  const kind = { '✓': 'evidence', '⚠': 'warning', '?': 'unknown' }[match[1]];
  return { kind, text: match[2] };
}

// Accepts a full scanner report, or a bare findings array from older output
export function normalizeReport(data) {
  if (Array.isArray(data)) return { findings: data };
  if (data && Array.isArray(data.findings)) return data;
  throw new Error('Not a scanner report: expected an object with a "findings" array');
}

// Report files can come from anywhere; only link to web URLs (a javascript: link would be XSS)
export function isSafeUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// coverage.checked uses display names; map them to finding types for per-category counts
export const CATEGORY_TYPES = {
  'Dependency CVEs': 'dependency-cve',
  'Hardcoded Secrets': 'hardcoded-secret',
  'SQL Injection Patterns': 'sql-injection',
  'XSS Vulnerabilities': 'xss',
  'Insecure Crypto Usage': 'crypto-misuse',
  'Async Footguns': 'async-footgun',
};

// Demo manifest (public/demo/index.json, written by npm run demo:export). Entries name files to fetch,
// so only plain file names are accepted — no paths, no URLs.
export function normalizeDemoManifest(data) {
  const scans = Array.isArray(data?.scans) ? data.scans : [];
  return scans.filter((scan) => typeof scan?.id === 'string' && typeof scan.label === 'string'
    && /^[a-z0-9-]+\.json$/.test(scan.file ?? ''));
}

// Where a demo report came from: "juice-shop @ 1618a61" linking to that commit, when the repo URL is safe
export function sourceLink(report) {
  const { source } = report ?? {};
  if (!source?.repo || !isSafeUrl(source.repo)) return null;
  const commit = typeof source.commit === 'string' && /^[0-9a-f]{4,40}$/.test(source.commit) ? source.commit : null;
  return {
    href: commit ? `${source.repo}/tree/${commit}` : source.repo,
    label: commit ? `${report.targetPath} @ ${commit}` : report.targetPath,
  };
}
