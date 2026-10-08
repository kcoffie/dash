import {
  infrastructureProblems, demoCommitProblem, keyedFiles, redactTargetPath, diffAgainstDemo, recallLines, lostChallenges, verdict,
} from '../answer-keys-ci.js';

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OTHER = 'fedcba9876543210fedcba9876543210fedcba98';
const key = (entries = [], extra = {}) => ({ commit: COMMIT, entries, ...extra });
const finding = (type, file, line, severity, extra = {}) => ({ type, file, line, severity, confidence: 0.8, context: ['✓ a'], ...extra });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- Infrastructure: the target is the pinned commit and untouched ---

function testPinnedCleanTargetHasNoProblems() {
  const problems = infrastructureProblems(key(), { head: `${COMMIT}\n`, porcelain: '' });
  return report('HEAD = key commit (git output with newline) and clean tree → no infrastructure problem', same(problems, []), JSON.stringify(problems));
}

function testWrongCommitIsInfrastructure() {
  const problems = infrastructureProblems(key(), { head: OTHER, porcelain: '' });
  return report('HEAD ≠ key commit → one problem naming both commits',
    problems.length === 1 && problems[0].includes(OTHER) && problems[0].includes(COMMIT), JSON.stringify(problems));
}

function testUnreadableHeadIsInfrastructure() {
  const problems = infrastructureProblems(key(), { head: '', porcelain: '' });
  return report('No HEAD (not a git checkout) → problem saying so, never a pass',
    problems.length === 1 && problems[0].includes('(no commit)'), JSON.stringify(problems));
}

function testDirtyTreeIsInfrastructure() {
  const problems = infrastructureProblems(key(), { head: COMMIT, porcelain: ' M routes/login.ts\n?? extra.js\n' });
  return report('Dirty tree → one problem with the count of changed paths',
    problems.length === 1 && problems[0].includes('2 changed path(s)'), JSON.stringify(problems));
}

function testWrongCommitAndDirtyBothReported() {
  const problems = infrastructureProblems(key(), { head: OTHER, porcelain: ' M a.js\n' });
  return report('Wrong commit and dirty tree → both reported', problems.length === 2, JSON.stringify(problems));
}

// --- The demo the site shows was exported from the key's commit ---

function testDemoPrefixPasses() {
  return report('Demo short commit is a prefix of the key commit → no problem',
    demoCommitProblem(key(), { id: 'x', commit: COMMIT.slice(0, 7) }) === null);
}

function testDemoOtherCommitFails() {
  const problem = demoCommitProblem(key(), { id: 'x', commit: OTHER.slice(0, 7) });
  return report('Demo short commit from another commit → problem naming both', Boolean(problem?.includes(OTHER.slice(0, 7)) && problem.includes(COMMIT)), problem);
}

function testDemoTooShortFails() {
  // '' and '0' are prefixes of every commit / many commits: they prove nothing
  const short = ['', '012345'].map((commit) => demoCommitProblem(key(), { id: 'x', commit }));
  return report('Demo commit shorter than 7 characters → problem (a short prefix proves nothing)', short.every(Boolean), JSON.stringify(short));
}

function testDemoWithoutCommitFails() {
  const problem = demoCommitProblem(key(), { id: 'x' });
  return report('Demo scan with no commit → "shorter than 7" problem', Boolean(problem?.includes('shorter than 7')), problem);
}

function testDemoMissingFails() {
  return report('No demo scan for the target → problem', Boolean(demoCommitProblem(key(), undefined)));
}

// --- Keyed files must exist before scanning (a scanner skips unreadable files silently) ---

function testKeyedFiles() {
  const k = key([
    { status: 'found', type: 'xss', file: 'b.js' },
    { status: 'known miss', type: 'xss', file: 'a.js' },
    { status: 'not flagged', type: 'xss', file: 'b.js' },
    { status: 'reviewed', type: 'xss', file: 'c.js' },
    { status: 'not flagged', type: 'xss', pattern: { endsWith: '_correct.ts' } },
  ]);
  const files = keyedFiles(k);
  return report('Keyed files: every file entry of any status, sorted, once each, no patterns', same(files, ['a.js', 'b.js', 'c.js']), JSON.stringify(files));
}

// --- Output hygiene ---

function testRedactTargetPath() {
  const message = redactTargetPath('XSS scanning failed: EACCES: /w/targets/js/a.js and /w/targets/js/b.js', '/w/targets/js');
  return report('Every occurrence of the target path → <target>', message === 'XSS scanning failed: EACCES: <target>/a.js and <target>/b.js', message);
}

function testRedactEmptyTargetPathLeavesMessage() {
  const message = redactTargetPath('failed: x', '');
  return report('Empty target path → message unchanged (not <target> between every character)', message === 'failed: x', message);
}

// --- Information only: fresh scan vs public/demo ---

function testIdenticalScansHaveNoDifferences() {
  const fresh = [finding('xss', 'a.js', 3, 'medium'), finding('dependency-cve', 'package.json', 0, 'high')];
  const demo = [finding('xss', 'a.js', 3, 'medium', { snippet: '[redacted in demo report]', id: 'other' })];
  const diff = diffAgainstDemo(fresh, demo);
  return report('Same findings (snippet/id ignored, dependency CVEs left out) → counts 1/1, no difference lines',
    diff.fresh === 1 && diff.demo === 1 && same(diff.lines, []), JSON.stringify(diff));
}

function testSeverityChangeIsOneChangedLine() {
  const diff = diffAgainstDemo([finding('xss', 'a.js', 3, 'high')], [finding('xss', 'a.js', 3, 'medium')]);
  return report('Severity changed at the same file:line → one "changed" line with demo → fresh severity',
    same(diff.lines, ['changed a.js:3 xss: severity medium → high']), JSON.stringify(diff));
}

function testConfidenceAndContextChangesNamed() {
  const diff = diffAgainstDemo([finding('xss', 'a.js', 3, 'medium', { confidence: 0.9, context: ['✓ b'] })], [finding('xss', 'a.js', 3, 'medium')]);
  return report('Confidence and context changed → named, values of context not printed',
    same(diff.lines, ['changed a.js:3 xss medium: confidence 0.8 → 0.9, context differs']), JSON.stringify(diff));
}

function testOnlyInOneSide() {
  const diff = diffAgainstDemo([finding('sql-injection', 'b.js', 9, 'critical')], [finding('xss', 'a.js', 3, 'low')]);
  return report('Finding only in one report → "only in fresh scan" / "only in public/demo", sorted by file',
    same(diff.lines, ['only in public/demo a.js:3 xss low', 'only in fresh scan b.js:9 sql-injection critical']), JSON.stringify(diff));
}

function testDifferencesSortedByLocation() {
  const fresh = [finding('xss', 'b.js', 1, 'low'), finding('xss', 'a.js', 10, 'low'), finding('sql-injection', 'a.js', 10, 'high')];
  const diff = diffAgainstDemo(fresh, [finding('xss', 'a.js', 9, 'low')]);
  return report('Difference lines sorted by file, then line, then type (whichever side they come from)', same(diff.lines, [
    'only in public/demo a.js:9 xss low',
    'only in fresh scan a.js:10 sql-injection high',
    'only in fresh scan a.js:10 xss low',
    'only in fresh scan b.js:1 xss low',
  ]), JSON.stringify(diff));
}

function testDuplicateDroppedFromFreshScan() {
  const x = finding('xss', 'a.js', 3, 'medium');
  const diff = diffAgainstDemo([x], [x, { ...x }]);
  return report('Demo has a finding twice, fresh scan once → exactly one "only in public/demo" line',
    diff.demo === 2 && same(diff.lines, ['only in public/demo a.js:3 xss medium']), JSON.stringify(diff));
}

function testDuplicatesAtOneLocation() {
  // Two XSS findings on one line (two sinks); only one changed
  const demo = [finding('xss', 'a.js', 3, 'medium'), finding('xss', 'a.js', 3, 'high', { confidence: 0.6 })];
  const fresh = [finding('xss', 'a.js', 3, 'high', { confidence: 0.6 }), finding('xss', 'a.js', 3, 'low')];
  const diff = diffAgainstDemo(fresh, demo);
  return report('Two findings at one file:line, one changed → exactly one changed line',
    same(diff.lines, ['changed a.js:3 xss: severity medium → low']), JSON.stringify(diff));
}

function testDiffPrintsNoSnippetOrDescription() {
  const secret = { snippet: 'const key = "hunter2-SNIPPET"', description: 'DESCRIPTION-TEXT', context: ['✓ CONTEXT-TEXT'] };
  const diff = diffAgainstDemo([finding('hardcoded-secret', 'a.js', 1, 'high', secret), finding('xss', 'b.js', 2, 'low', secret)],
    [finding('xss', 'b.js', 2, 'low')]);
  const text = diff.lines.join('\n');
  return report('Difference lines never contain a snippet, description or context text',
    diff.lines.length === 2 && !/SNIPPET|DESCRIPTION|CONTEXT/.test(text), text);
}

// --- Recall, printed the way the PRD counts it ---

function testRecallLines() {
  const lines = recallLines({ xss: { A: true, B: false }, 'crypto-misuse': { C: true } }, { xss: { reported: 3, total: 4 }, 'async-footgun': { reported: 2, total: 2 } });
  return report('Recall lines: one per type, sorted, challenges and sites (0/0 when a type has none)', same(lines, [
    'async-footgun: 0/0 challenges · 2/2 sites',
    'crypto-misuse: 1/1 challenges · 0/0 sites',
    'xss: 1/2 challenges · 3/4 sites',
  ]), JSON.stringify(lines));
}

function testLostChallenges() {
  const k = key([
    { status: 'found', type: 'xss' }, // a site with no challenge (e.g. DVNA's async chains)
    { status: 'found', type: 'xss', challenges: ['Reflected'] },
    { status: 'known miss', type: 'xss', challenges: ['CSP Bypass'] },
    { status: 'found', type: 'sql-injection', challenges: ['CSP Bypass'] },
  ]);
  const lost = lostChallenges(k, { xss: { Reflected: false, 'CSP Bypass': false }, 'sql-injection': { 'CSP Bypass': true } });
  return report('Lost challenges: unrecalled with a found entry of that type; a documented miss is not lost; entries without challenges are fine',
    same(lost, ['xss: Reflected']), JSON.stringify(lost));
}

// --- Exit code: infrastructure is reported separately from key failures ---

function testVerdictPass() {
  const v = verdict({ infrastructure: 0, failures: 0 });
  return report('No failures → exit 0', v.code === 0 && v.summary.includes('passed'), JSON.stringify(v));
}

function testVerdictKeyFailures() {
  const v = verdict({ infrastructure: 0, failures: 3 });
  return report('Key failures only → exit 1, summary counts them', v.code === 1 && v.summary.includes('3 answer-key failure(s)'), JSON.stringify(v));
}

function testVerdictInfrastructureWins() {
  const v = verdict({ infrastructure: 1, failures: 2 });
  return report('Infrastructure failure (even with key failures) → exit 2, summary names both',
    v.code === 2 && v.summary.includes('1 infrastructure failure(s)') && v.summary.includes('2 answer-key failure(s)'), JSON.stringify(v));
}

const results = [
  testPinnedCleanTargetHasNoProblems(),
  testWrongCommitIsInfrastructure(),
  testUnreadableHeadIsInfrastructure(),
  testDirtyTreeIsInfrastructure(),
  testWrongCommitAndDirtyBothReported(),
  testDemoPrefixPasses(),
  testDemoOtherCommitFails(),
  testDemoTooShortFails(),
  testDemoWithoutCommitFails(),
  testDemoMissingFails(),
  testKeyedFiles(),
  testRedactTargetPath(),
  testRedactEmptyTargetPathLeavesMessage(),
  testIdenticalScansHaveNoDifferences(),
  testSeverityChangeIsOneChangedLine(),
  testConfidenceAndContextChangesNamed(),
  testOnlyInOneSide(),
  testDifferencesSortedByLocation(),
  testDuplicateDroppedFromFreshScan(),
  testDuplicatesAtOneLocation(),
  testDiffPrintsNoSnippetOrDescription(),
  testRecallLines(),
  testLostChallenges(),
  testVerdictPass(),
  testVerdictKeyFailures(),
  testVerdictInfrastructureWins(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
