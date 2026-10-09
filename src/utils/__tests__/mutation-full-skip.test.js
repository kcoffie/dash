import { mutationFullDecision } from '../mutation-full-skip.js';

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// A push's `before` SHA, and `git diff --name-only --no-renames -z before after` output (NUL after every path)
const BEFORE = '0123456789abcdef0123456789abcdef01234567';
const NEW_BRANCH = '0000000000000000000000000000000000000000';
const z = (...files) => files.map((f) => `${f}\0`).join('');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (d) => JSON.stringify(d);

// --- Skip only when every changed file is Markdown ---

function testMarkdownOnlySkips() {
  const d = mutationFullDecision({ before: BEFORE, diff: z('HANDOFF.md', 'docs/ENGINEERING_PROCESS.md') });
  return report('every changed file ends in .md → skip, listing the files',
    d.skip === true && same(d.files, ['HANDOFF.md', 'docs/ENGINEERING_PROCESS.md']), show(d));
}

function testOneNonMarkdownFileRuns() {
  const d = mutationFullDecision({ before: BEFORE, diff: z('HANDOFF.md', 'answer-keys/juice-shop.json', 'STATUS.md') });
  return report('one non-Markdown file among Markdown → run, reason names 1 non-Markdown file',
    d.skip === false && d.reason.includes('1 non-Markdown'), show(d));
}

function testRenameToMarkdownRuns() {
  // --no-renames lists a rename as the deleted old path plus the added new one
  const d = mutationFullDecision({ before: BEFORE, diff: z('src/utils/x.js', 'src/utils/x.md') });
  return report('x.js renamed to x.md (delete + add) → run', d.skip === false, show(d));
}

function testLookalikeExtensionsRun() {
  const cases = ['README.md.js', 'docs/page.mdx', 'NOTES.MD', 'notes.md/index.js'];
  const runs = cases.filter((f) => mutationFullDecision({ before: BEFORE, diff: z(f) }).skip === false);
  return report('.md.js, .mdx, upper-case .MD and a folder named *.md → run (only a lower-case .md ending skips)',
    same(runs, cases), JSON.stringify(runs));
}

function testNonAsciiMarkdownNameSkips() {
  // With -z, git prints paths raw (no "core.quotePath" quoting), so a non-ASCII name still ends in .md
  const d = mutationFullDecision({ before: BEFORE, diff: z('docs/café.md') });
  return report('non-ASCII Markdown file name → skip', d.skip === true && same(d.files, ['docs/café.md']), show(d));
}

// --- Fail safe: run whenever the file list can't be trusted ---

function testNewBranchRuns() {
  const d = mutationFullDecision({ before: NEW_BRANCH, diff: z('HANDOFF.md') });
  return report('before is all zeros (no previous commit) → run even if the diff is Markdown only',
    d.skip === false && d.reason.includes('no previous commit') && same(d.files, []), show(d));
}

function testShaEndingInZeroIsARealCommit() {
  // Only an all-zero SHA means "no previous commit"; about 1 real SHA in 16 ends in 0
  const d = mutationFullDecision({ before: '0123456789abcdef0123456789abcdef01234500', diff: z('HANDOFF.md') });
  return report('before SHA ending in zeros is a real commit → Markdown-only still skips', d.skip === true, show(d));
}

function testMissingBeforeRuns() {
  const missing = [undefined, '', '  '].filter((before) => mutationFullDecision({ before, diff: z('HANDOFF.md') }).skip === false);
  return report('before missing or blank → run', missing.length === 3, `${missing.length}/3 ran`);
}

function testFailedDiffRuns() {
  // null = git diff failed (e.g. before isn't in the fetched history)
  const d = mutationFullDecision({ before: BEFORE, diff: null });
  return report('git diff failed → run, reason says the changed files are unknown',
    d.skip === false && d.reason.includes('unknown') && same(d.files, []), show(d));
}

function testEmptyDiffRuns() {
  const d = mutationFullDecision({ before: BEFORE, diff: '' });
  return report('no changed files (e.g. an empty commit) → run', d.skip === false && d.reason.includes('no changed files'), show(d));
}

function testSkipReasonCountsFiles() {
  const d = mutationFullDecision({ before: BEFORE, diff: z('a.md', 'b.md', 'c.md') });
  return report('skip reason says "Markdown-only push" and counts the files',
    d.skip === true && d.reason === 'Markdown-only push (3 file(s))', show(d));
}

function testRunReasonCountsNonMarkdown() {
  const d = mutationFullDecision({ before: BEFORE, diff: z('a.md', 'src/x.js', 'package.json') });
  return report('run reason counts the non-Markdown files',
    d.skip === false && d.reason === '2 non-Markdown file(s) changed' && same(d.files, ['a.md', 'src/x.js', 'package.json']), show(d));
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
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
