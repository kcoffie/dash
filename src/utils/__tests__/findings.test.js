import {
  filterFindings, sortFindings, countBySeverity, countByType, parseFactor, normalizeReport, findingKey, location, isSafeUrl,
} from '../findings.js';

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const FINDINGS = [
  { id: 'a', type: 'xss', severity: 'medium', confidence: 0.6, title: 'Potential XSS', file: 'src/app.js', line: 10 },
  { id: 'b', type: 'sql-injection', severity: 'critical', confidence: 0.9, title: 'Potential SQL Injection', file: 'routes/login.ts', line: 34, snippet: "SELECT * FROM Users WHERE email = '${req.body.email}'" },
  { id: 'c', type: 'dependency-cve', severity: 'high', confidence: 0.95, title: 'lodash: Prototype Pollution', file: 'package.json', line: null, package: 'lodash' },
  { id: 'd', type: 'xss', severity: 'critical', confidence: 0.75, title: 'Potential XSS', file: 'views/a.ejs', line: 2 },
  { id: 'd', type: 'hardcoded-secret', severity: 'low', confidence: 0.3, title: 'API Token/Key', file: 'test/fixture.js', line: 9 },
];

function testFilterBySeverityAndType() {
  const critical = filterFindings(FINDINGS, { severity: 'critical' });
  const criticalXss = filterFindings(FINDINGS, { severity: 'critical', type: 'xss' });
  return report(
    'Filter by severity and type',
    critical.length === 2 && criticalXss.length === 1 && criticalXss[0].file === 'views/a.ejs',
    JSON.stringify({ critical, criticalXss }),
  );
}

function testSearchAcrossFields() {
  const byFile = filterFindings(FINDINGS, { query: 'login.ts' });
  const bySnippet = filterFindings(FINDINGS, { query: 'req.body' });
  const byPackage = filterFindings(FINDINGS, { query: 'LODASH' });
  const byTypeLabel = filterFindings(FINDINGS, { query: 'hardcoded secret' });
  const blank = filterFindings(FINDINGS, { query: '   ' });
  return report(
    'Search matches file, snippet, package, type label (case-insensitive)',
    byFile.length === 1 && bySnippet.length === 1 && byPackage.length === 1 && byTypeLabel.length === 1 && blank.length === 5,
    JSON.stringify({ byFile, bySnippet, byPackage, byTypeLabel }),
  );
}

function testSortBySeverityThenConfidence() {
  const order = sortFindings(FINDINGS).map((f) => f.id);
  return report('Sort: severity, then confidence', order.join() === 'b,d,c,a,d', order.join());
}

function testSortDoesNotMutate() {
  const copy = [...FINDINGS];
  sortFindings(FINDINGS);
  return report('Sort returns a new array', FINDINGS.every((f, i) => f === copy[i]));
}

function testCounts() {
  const bySeverity = countBySeverity(FINDINGS);
  const byType = countByType(FINDINGS);
  return report(
    'Counts by severity and type',
    bySeverity.critical === 2 && bySeverity.high === 1 && bySeverity.info === 0 && byType.xss === 2,
    JSON.stringify({ bySeverity, byType }),
  );
}

function testParseFactor() {
  const parsed = ['✓ User input used', '⚠ No parameterized query', '? Endpoint unclear', 'plain'].map(parseFactor);
  return report(
    'Context factor prefixes → kinds',
    parsed.map((p) => p.kind).join() === 'evidence,warning,unknown,note' && parsed[0].text === 'User input used',
    JSON.stringify(parsed),
  );
}

function testKeysUniqueWithDuplicateIds() {
  const keys = new Set(FINDINGS.map(findingKey));
  return report('Keys unique even when scanner ids repeat', keys.size === FINDINGS.length);
}

function testLocation() {
  return report(
    'Location formats file:line, file only when no line',
    location(FINDINGS[1]) === 'routes/login.ts:34' && location(FINDINGS[2]) === 'package.json',
  );
}

function testNormalizeReport() {
  const full = normalizeReport({ findings: [1], summary: {} });
  const bare = normalizeReport([1, 2]);
  let rejected = false;
  try { normalizeReport({ nope: true }); } catch { rejected = true; }
  return report('Normalize report / bare array / reject junk', full.findings.length === 1 && bare.findings.length === 2 && rejected);
}

function testIsSafeUrl() {
  const safe = ['https://owasp.org/x', 'http://example.com'].every(isSafeUrl);
  const unsafe = ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>', 'not a url', ''].some(isSafeUrl);
  return report('Only http(s) reference URLs are linkable', safe && !unsafe);
}

const results = [
  testFilterBySeverityAndType(),
  testSearchAcrossFields(),
  testSortBySeverityThenConfidence(),
  testSortDoesNotMutate(),
  testCounts(),
  testParseFactor(),
  testKeysUniqueWithDuplicateIds(),
  testLocation(),
  testNormalizeReport(),
  testIsSafeUrl(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
