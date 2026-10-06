import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanTarget } from '../report.js';
import { scanPatterns } from '../pattern-scanner.js';
import { withFakeNpm, writeRecordedProject } from './helpers/fake-npm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Unique per run, so parallel runs (Stryker workers) don't delete each other's fixtures
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.test-tmp-report-'));

const STARTED = Date.now();
const AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');

// One finding per file. Each expected severity follows a rule the scanner's own tests pin
// (DESIGN.md "Scoring Model"), so the report's counts can be worked out by hand.
const FIXTURE_FILES = {
  'config.js': `const AWS_KEY = "${AWS_KEY}";`, // provider key in app code → critical
  'core/handler.js': [ // exported (req, res) handler, req.* into HTML → critical
    'module.exports.greet = function (req, res) {',
    "  res.send('<p>' + req.body.name + '</p>')",
    '}',
  ].join('\n'),
  'src/client.js': "const api_key = 'q8Zr2Lm9Xv4Tn7Wb1Kc5Hy3Pd6';", // random-looking API token → high
  'auth.js': "const stored = crypto.createHash('sha1').update(password).digest('hex')", // SHA-1 of a password → high
  'db.js': 'const sql = "DELETE FROM sessions WHERE user_id = " + userId;', // SQL concat, no visible input → medium
  'lib/ids.js': "const digest = crypto.createHash('md5').update(value).digest('hex')", // MD5 of an unknown value → medium
  'pager.js': 'const sql = `SELECT * FROM posts LIMIT ${PAGE_SIZE}`;', // constant interpolation → low
  'banner.js': 'banner.innerHTML = DEFAULT_BANNER;', // constant into a DOM sink → low
  'lib/cache.js': ['function warm () {', '  loadAll().then(items => store(items))', '}'].join('\n'), // server chain outside a request → low
};

// Plus the recorded npm audit: node-serialize 0.0.4, critical, runtime dependency → critical
const EXPECTED_FINDINGS = [
  'async-footgun lib/cache.js low',
  'crypto-misuse auth.js high',
  'crypto-misuse lib/ids.js medium',
  'dependency-cve package.json critical',
  'hardcoded-secret config.js critical',
  'hardcoded-secret src/client.js high',
  'sql-injection db.js medium',
  'sql-injection pager.js low',
  'xss banner.js low',
  'xss core/handler.js critical',
];

function makeTarget(name, files, { recordedProject } = {}) {
  const root = path.join(tmpDir, name);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  fs.mkdirSync(root, { recursive: true });
  if (recordedProject) writeRecordedProject(recordedProject, root);
  return root;
}

function quietLog() {
  const lines = [];
  return { lines, log: (line) => lines.push(line), logError: (line) => lines.push(line) };
}

async function scanFixtureOnce(name, options) {
  const target = makeTarget(name, FIXTURE_FILES, { recordedProject: 'node-serialize-0.0.4' });
  const output = quietLog();
  const report = await withFakeNpm('node-serialize-0.0.4', () => scanTarget(target, output), options);
  return { target, report, lines: output.lines };
}

// The tests that only read the report share one scan (each scan spawns npm twice)
let shared = null;
async function scanFixture(options) {
  if (options) return scanFixtureOnce('app-variant', options);
  shared ??= scanFixtureOnce('app');
  return shared;
}

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const describe = (findings) => findings.map((f) => `${f.type} ${f.file} ${f.severity}`).sort();

async function testEveryScannerContributes() {
  const { report: result } = await scanFixture();
  const got = describe(result.findings);
  return report('Every scanner runs: one finding per fixture rule, with the rule\'s severity', same(got, EXPECTED_FINDINGS), JSON.stringify(got));
}

async function testSummaryCountsBySeverity() {
  const { report: result } = await scanFixture();
  const expected = { total: 10, critical: 3, high: 2, medium: 2, low: 3, info: 0 };
  return report('Summary counts findings by severity (PRD §3)', same(result.summary, expected), JSON.stringify(result.summary));
}

async function testFindingsByType() {
  const { report: result } = await scanFixture();
  const expected = {
    'dependency-cve': 1, 'hardcoded-secret': 2, 'sql-injection': 2, 'xss': 2, 'crypto-misuse': 2, 'async-footgun': 1,
  };
  return report('Coverage counts findings per type (PRD Req 4)', same(result.coverage.findingsByType, expected), JSON.stringify(result.coverage.findingsByType));
}

async function testCoverageCategories() {
  const { coverage } = (await scanFixture()).report;
  const checked = ['Dependency CVEs', 'Hardcoded Secrets', 'SQL Injection Patterns', 'XSS Vulnerabilities', 'Insecure Crypto Usage', 'Async Footguns'];
  const notYetChecked = ['CORS Misconfiguration', 'Permission Creep', 'Logging PII'];
  return report(
    'Coverage lists the 6 checked and 3 not-yet-checked categories (PRD Req 4)',
    same(coverage.checked, checked) && coverage.checkedCount === 6 && same(coverage.notYetChecked, notYetChecked),
    JSON.stringify(coverage),
  );
}

async function testNoErrorsKeyWhenAllScannersSucceed() {
  const { report: result } = await scanFixture();
  return report('No "errors" key when every scanner succeeded (PRD §3)', !('errors' in result), JSON.stringify(result.errors));
}

async function testTimestampAndTarget() {
  const { target, report: result } = await scanFixture();
  const at = Date.parse(result.timestamp);
  return report(
    'Report records the scan time (ISO 8601) and the target path',
    result.timestamp === new Date(at).toISOString() && at >= STARTED && at <= Date.now() && result.targetPath === target,
    JSON.stringify({ timestamp: result.timestamp, targetPath: result.targetPath }),
  );
}

async function testFailedDependencyScanIsAnErrorNotZero() {
  const { report: result } = await scanFixture({ fail: 'npm error code E503\nnpm error 503 Service Unavailable' });
  const patternOnly = EXPECTED_FINDINGS.filter((f) => !f.startsWith('dependency-cve'));
  return report(
    'A failed npm audit is listed in errors, and the other scanners still report',
    same(result.errors, ['Dependency scan failed: npm audit failed: code E503 · 503 Service Unavailable'])
      && same(describe(result.findings), patternOnly) && result.summary.total === 9 && result.coverage.findingsByType['dependency-cve'] === 0,
    JSON.stringify({ errors: result.errors, findings: describe(result.findings) }),
  );
}

async function testNoPackageJsonIsAnError() {
  const target = makeTarget('no-manifest', { 'db.js': FIXTURE_FILES['db.js'] });
  const result = await scanTarget(target, quietLog());
  return report(
    'No package.json: listed in errors, pattern findings still reported',
    same(result.errors, ['No package.json found. Skipping dependency scan.']) && same(describe(result.findings), ['sql-injection db.js medium']),
    JSON.stringify({ errors: result.errors, findings: describe(result.findings) }),
  );
}

async function testProgressLogStatesCounts() {
  const { lines } = await scanFixture();
  // Same dependencies, no source files: the pattern line must say there were none
  const target = makeTarget('deps-only', {}, { recordedProject: 'node-serialize-0.0.4' });
  const depsOnly = quietLog();
  await withFakeNpm('node-serialize-0.0.4', () => scanTarget(target, depsOnly));
  return report(
    'Progress log gives each scanner\'s count, and says so when a scanner found nothing',
    same(lines, ['✓ Dependency scanning: 1 CVE(s) found', '✓ Pattern scanning: 9 finding(s) detected'])
      && same(depsOnly.lines, ['✓ Dependency scanning: 1 CVE(s) found', '✓ Pattern scanning: no issues found']),
    JSON.stringify({ lines, depsOnly: depsOnly.lines }),
  );
}

async function testCleanAuditSaysNoVulnerabilities() {
  // Recorded: ms 2.1.3, no advisories (npm exits 0)
  const target = makeTarget('clean-deps', {}, { recordedProject: 'ms-2.1.3' });
  const output = quietLog();
  const result = await withFakeNpm('ms-2.1.3', () => scanTarget(target, output));
  return report(
    'Clean npm audit: zero dependency findings, no errors, log says "no vulnerabilities"',
    result.findings.length === 0 && !('errors' in result)
      && same(output.lines, ['✓ Dependency scanning: no vulnerabilities', '✓ Pattern scanning: no issues found']),
    JSON.stringify({ findings: result.findings.length, errors: result.errors, lines: output.lines }),
  );
}

async function testScanPatternsCombinesAllFive() {
  const target = makeTarget('patterns', FIXTURE_FILES);
  const { findings, errors } = await scanPatterns(target);
  const types = [...new Set(findings.map((f) => f.type))].sort();
  return report(
    'scanPatterns returns the findings of all five pattern scanners, no errors',
    same(types, ['async-footgun', 'crypto-misuse', 'hardcoded-secret', 'sql-injection', 'xss']) && findings.length === 9 && same(errors, []),
    JSON.stringify({ types, count: findings.length, errors }),
  );
}

const results = [];
for (const test of [
  testEveryScannerContributes, testSummaryCountsBySeverity, testFindingsByType, testCoverageCategories,
  testNoErrorsKeyWhenAllScannersSucceed, testTimestampAndTarget, testFailedDependencyScanIsAnErrorNotZero,
  testNoPackageJsonIsAnError, testProgressLogStatesCounts, testCleanAuditSaysNoVulnerabilities, testScanPatternsCombinesAllFive,
]) {
  results.push(await test());
}

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
