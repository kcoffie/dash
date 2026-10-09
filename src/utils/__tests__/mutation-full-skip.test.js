import { mutationFullDecision, latestWorkflowRun, jobResult } from '../mutation-full-skip.js';

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// A push's `before` SHA, and `git diff --name-only --no-renames -z before after` output (NUL after every path)
const BEFORE = '0123456789abcdef0123456789abcdef01234567';
// previous: mutation-full's result on `before` (jobResult); only 'success' lets a Markdown-only push skip
const PASSED = 'success';
const NEW_BRANCH = '0000000000000000000000000000000000000000';
const z = (...files) => files.map((f) => `${f}\0`).join('');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (d) => JSON.stringify(d);

// --- Skip only when every changed file is Markdown ---

function testMarkdownOnlySkips() {
  const d = mutationFullDecision({ before: BEFORE, previous: PASSED, diff: z('HANDOFF.md', 'docs/ENGINEERING_PROCESS.md') });
  return report('every changed file ends in .md → skip, listing the files',
    d.skip === true && same(d.files, ['HANDOFF.md', 'docs/ENGINEERING_PROCESS.md']), show(d));
}

function testOneNonMarkdownFileRuns() {
  const d = mutationFullDecision({ before: BEFORE, previous: PASSED, diff: z('HANDOFF.md', 'answer-keys/juice-shop.json', 'STATUS.md') });
  return report('one non-Markdown file among Markdown → run, reason names 1 non-Markdown file',
    d.skip === false && d.reason.includes('1 non-Markdown'), show(d));
}

function testRenameToMarkdownRuns() {
  // --no-renames lists a rename as the deleted old path plus the added new one
  const d = mutationFullDecision({ before: BEFORE, previous: PASSED, diff: z('src/utils/x.js', 'src/utils/x.md') });
  return report('x.js renamed to x.md (delete + add) → run', d.skip === false, show(d));
}

function testLookalikeExtensionsRun() {
  const cases = ['README.md.js', 'docs/page.mdx', 'NOTES.MD', 'notes.md/index.js'];
  const runs = cases.filter((f) => mutationFullDecision({ before: BEFORE, previous: PASSED, diff: z(f) }).skip === false);
  return report('.md.js, .mdx, upper-case .MD and a folder named *.md → run (only a lower-case .md ending skips)',
    same(runs, cases), JSON.stringify(runs));
}

function testNonAsciiMarkdownNameSkips() {
  // With -z, git prints paths raw (no "core.quotePath" quoting), so a non-ASCII name still ends in .md
  const d = mutationFullDecision({ before: BEFORE, previous: PASSED, diff: z('docs/café.md') });
  return report('non-ASCII Markdown file name → skip', d.skip === true && same(d.files, ['docs/café.md']), show(d));
}

// --- Fail safe: run whenever the file list can't be trusted ---

function testNewBranchRuns() {
  const d = mutationFullDecision({ before: NEW_BRANCH, previous: PASSED, diff: z('HANDOFF.md') });
  return report('before is all zeros (no previous commit) → run even if the diff is Markdown only',
    d.skip === false && d.reason.includes('no previous commit') && same(d.files, []), show(d));
}

function testShaEndingInZeroIsARealCommit() {
  // Only an all-zero SHA means "no previous commit"; about 1 real SHA in 16 ends in 0
  const d = mutationFullDecision({ before: '0123456789abcdef0123456789abcdef01234500', previous: PASSED, diff: z('HANDOFF.md') });
  return report('before SHA ending in zeros is a real commit → Markdown-only still skips', d.skip === true, show(d));
}

function testMissingBeforeRuns() {
  const missing = [undefined, '', '  '].filter((before) => {
    const d = mutationFullDecision({ before, previous: PASSED, diff: z('HANDOFF.md') });
    return d.skip === false && d.reason === 'no previous commit to compare with' && same(d.files, []);
  });
  return report('before missing or blank → run, as "no previous commit"', missing.length === 3, `${missing.length}/3 ran`);
}

function testFailedDiffRuns() {
  // null = git diff failed (e.g. before isn't in the fetched history)
  const d = mutationFullDecision({ before: BEFORE, previous: PASSED, diff: null });
  return report('git diff failed → run, reason says the changed files are unknown',
    d.skip === false && d.reason.includes('unknown') && same(d.files, []), show(d));
}

function testEmptyDiffRuns() {
  const d = mutationFullDecision({ before: BEFORE, previous: PASSED, diff: '' });
  return report('no changed files (e.g. an empty commit) → run', d.skip === false && d.reason.includes('no changed files'), show(d));
}

function testSkipReasonCountsFiles() {
  const d = mutationFullDecision({ before: BEFORE, previous: PASSED, diff: z('a.md', 'b.md', 'c.md') });
  return report('skip reason says "Markdown-only push" and counts the files',
    d.skip === true && d.reason === 'Markdown-only push (3 file(s)), mutation-full passed on 0123456', show(d));
}

function testRunReasonCountsNonMarkdown() {
  const d = mutationFullDecision({ before: BEFORE, previous: PASSED, diff: z('a.md', 'src/x.js', 'package.json') });
  return report('run reason counts the non-Markdown files',
    d.skip === false && d.reason === '2 non-Markdown file(s) changed' && same(d.files, ['a.md', 'src/x.js', 'package.json']), show(d));
}

// --- Skip only if mutation-full passed on the previous push (else a red score would turn green on HEAD) ---

function testPreviousNotPassedRuns() {
  const results = ['failure', 'cancelled', 'timed_out', 'in_progress', 'queued', 'skipped', 'not found', null, undefined];
  const ran = results.filter((previous) => mutationFullDecision({ before: BEFORE, diff: z('HANDOFF.md'), previous }).skip === false);
  return report('Markdown-only push but mutation-full on before is not success (failed, cancelled, running, missing) → run',
    ran.length === results.length, `${ran.length}/${results.length} ran`);
}

function testPreviousFailureNamedInReason() {
  const d = mutationFullDecision({ before: BEFORE, diff: z('HANDOFF.md'), previous: 'failure' });
  return report('run reason names the previous result and the short before SHA',
    d.skip === false && d.reason === 'mutation-full on 0123456 is failure, not success' && same(d.files, ['HANDOFF.md']), show(d));
}

function testUnknownPreviousNamedInReason() {
  const d = mutationFullDecision({ before: BEFORE, diff: z('HANDOFF.md') });
  return report('previous result unknown → run, reason says unknown', d.skip === false && d.reason === 'mutation-full on 0123456 is unknown, not success', show(d));
}

function testNonShaBeforeRuns() {
  // `before` reaches git's argument list: anything but a full lower-case SHA (an option, a short SHA) never gets there
  const cases = ['--output=/tmp/x', '0123456', '0123456789ABCDEF0123456789ABCDEF01234567', `${BEFORE}0`, `${BEFORE} `.repeat(2)];
  const ran = cases.filter((before) => {
    const d = mutationFullDecision({ before, diff: z('HANDOFF.md'), previous: PASSED });
    return d.skip === false && d.reason === 'before is not a full commit SHA' && same(d.files, []);
  });
  return report('before not a 40-character lower-case hex SHA → run', ran.length === cases.length, `${ran.length}/${cases.length}`);
}

function testShaWithNewlineAccepted() {
  // GitHub gives a bare SHA, but trimming keeps a trailing newline (e.g. from a shell) from forcing a run
  const d = mutationFullDecision({ before: `${BEFORE}\n`, diff: z('a.md'), previous: PASSED });
  return report('before with surrounding whitespace is trimmed', d.skip === true, show(d));
}

// --- Reading the GitHub API responses ---

const run = (id, extra = {}) => ({ id, path: '.github/workflows/test.yml', event: 'push', ...extra });

function testLatestRunPicksNewestOfThisWorkflow() {
  // Run ids only increase, so the highest id is the newest run (no ties, unlike timestamps)
  const runs = { workflow_runs: [run(10), run(30), run(40, { path: '.github/workflows/other.yml' }), run(20)] };
  const picked = latestWorkflowRun(runs, '.github/workflows/test.yml');
  return report('latest run: highest run id among this workflow\'s runs (other workflows ignored)', picked?.id === 30, show(picked));
}

function testLatestRunNoneFound() {
  const cases = [{ workflow_runs: [] }, { workflow_runs: [run(3, { path: 'x.yml' })] }, {}, null, { workflow_runs: 'x' }];
  const nulls = cases.filter((c) => latestWorkflowRun(c, '.github/workflows/test.yml') === null);
  return report('no run of this workflow, or a malformed response → null', nulls.length === cases.length, `${nulls.length}/${cases.length}`);
}

function testJobResultCompleted() {
  const jobs = { jobs: [{ name: 'test', status: 'completed', conclusion: 'failure' }, { name: 'mutation-full', status: 'completed', conclusion: 'success' }] };
  const failed = { jobs: [{ name: 'mutation-full', status: 'completed', conclusion: 'failure' }] };
  const a = jobResult(jobs, 'mutation-full');
  const b = jobResult(failed, 'mutation-full');
  return report('completed job → its conclusion (other jobs ignored)', a === 'success' && b === 'failure', `${a} / ${b}`);
}

function testJobResultNotCompleted() {
  // A job still running has conclusion null: its status is the answer, never 'success'
  const r = jobResult({ jobs: [{ name: 'mutation-full', status: 'in_progress', conclusion: null }] }, 'mutation-full');
  const odd = jobResult({ jobs: [{ name: 'mutation-full', status: 'completed', conclusion: null }] }, 'mutation-full');
  return report('job not completed → its status; completed with no conclusion → unknown', r === 'in_progress' && odd === 'unknown', `${r} / ${odd}`);
}

function testJobResultMissing() {
  const cases = [{ jobs: [{ name: 'test', status: 'completed', conclusion: 'success' }] }, { jobs: [] }, {}, null, { jobs: 'x' }];
  const results = cases.map((c) => jobResult(c, 'mutation-full'));
  return report('job missing or malformed response → not found', results.every((r) => r === 'not found'), JSON.stringify(results));
}

const results = [
  testMarkdownOnlySkips(),
  testOneNonMarkdownFileRuns(),
  testRenameToMarkdownRuns(),
  testLookalikeExtensionsRun(),
  testNonAsciiMarkdownNameSkips(),
  testNewBranchRuns(),
  testShaEndingInZeroIsARealCommit(),
  testMissingBeforeRuns(),
  testFailedDiffRuns(),
  testEmptyDiffRuns(),
  testSkipReasonCountsFiles(),
  testRunReasonCountsNonMarkdown(),
  testPreviousNotPassedRuns(),
  testPreviousFailureNamedInReason(),
  testUnknownPreviousNamedInReason(),
  testNonShaBeforeRuns(),
  testShaWithNewlineAccepted(),
  testLatestRunPicksNewestOfThisWorkflow(),
  testLatestRunNoneFound(),
  testJobResultCompleted(),
  testJobResultNotCompleted(),
  testJobResultMissing(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
