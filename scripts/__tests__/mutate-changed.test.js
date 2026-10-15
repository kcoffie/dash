// End to end: scripts/mutate-changed.js against a real temp git repo. Checks which base the changed lines are taken
// from (exactly refs/remotes/origin/<branch>, never a tag of a similar name), that a base it can't resolve fails
// closed, and what reaches Stryker. Stryker is a fake at the temp repo's node_modules/.bin/stryker that records its
// arguments, and `npx` a fake on PATH that records any call (there must be none), so no Stryker or registry package
// runs. Lives in scripts/__tests__: `npm test` runs it, Stryker doesn't (`test:src`).

import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'mutate-changed.js');
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '.test-tmp-mutate-changed-'));

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// --- Fake Stryker: appends its arguments to a log and prints what Stryker would about the generated config: ---
// "Found N of 99 file(s) to be mutated." with N = the distinct files in its mutate list (Stryker matched them all),
// or $FAKE_STRYKER_FOUND ("none": no such line, as when Stryker matches nothing); the under-threshold error if
// $FAKE_STRYKER_UNDER is set; kills itself with $FAKE_STRYKER_SIGNAL if set. Exits with $FAKE_STRYKER_EXIT (default 0).
// Installed into the repo by installStryker() after setup, as `npm ci` would.

const bin = path.join(tmpDir, 'bin');
const strykerLog = path.join(tmpDir, 'stryker.log');
const npxLog = path.join(tmpDir, 'npx.log');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'fake-stryker.cjs'), `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(strykerLog)}, process.argv.slice(2).join(' ') + '\\n');
const { mutate } = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const found = process.env.FAKE_STRYKER_FOUND ?? String(new Set(mutate.map((m) => m.replace(/:\\d+-\\d+$/, ''))).size);
if (found !== 'none') console.log('INFO ProjectReader Found ' + found + ' of 99 file(s) to be mutated.');
if (process.env.FAKE_STRYKER_SIGNAL) process.kill(process.pid, process.env.FAKE_STRYKER_SIGNAL);
if (process.env.FAKE_STRYKER_UNDER) console.log('ERROR MutationTestReportHelper Final mutation score 50.00 under breaking threshold 80, setting exit code to 1 (failure).');
process.exit(Number(process.env.FAKE_STRYKER_EXIT ?? 0));
`);
const fakeStryker = `#!/bin/sh\nexec '${process.execPath}' '${path.join(bin, 'fake-stryker.cjs')}' "$@"\n`;
// npx would install and run the registry package `stryker` when there's no local one: any call is logged and fails
fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\necho "$@" >> '${npxLog}'\nexit 97\n`, { mode: 0o755 });

// Puts the fake at <dir>/node_modules/.bin/stryker; node_modules is ignored there, as in the real repo
function installStryker(dir) {
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'stryker'), fakeStryker, { mode: 0o755 });
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'node_modules/\n');
}

// --- A temp repo: refs/remotes/origin/<branch> hold the bases (as after CI's checkout), HEAD is the PR ---

const repo = path.join(tmpDir, 'repo');
fs.mkdirSync(repo);
// No inherited GIT_* variables: git sets GIT_DIR / GIT_INDEX_FILE when it runs hooks, and with them every git call
// here (and the script's) would act on the outer repo instead of the temp one
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
};
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
  { cwd: repo, env: ENV, encoding: 'utf8' }).trim();
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};

// Inside the try below, so a failed setup still removes tmpDir
function setup() {
  write('stryker.config.json', JSON.stringify({ mutate: ['src/**/*.js'], thresholds: { high: 80, low: 65, break: 60 } }));
  write('src/utils/foo.js', 'export const a = 1;\n');
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('update-ref', 'refs/remotes/origin/release/1.x', 'main');
  // The base branch moved on after the PR branched: line 1 changed there. Only the PR's own lines may count.
  git('checkout', '-q', '-b', 'advanced');
  write('src/utils/foo.js', 'export const a = 10;\n');
  git('commit', '-q', '-am', 'base moves on');
  git('update-ref', 'refs/remotes/origin/advanced', 'HEAD');
  // A base with no history in common with the PR (as with a too-shallow clone): no merge base
  git('checkout', '-q', '--orphan', 'unrelated');
  git('commit', '-q', '-m', 'unrelated');
  git('update-ref', 'refs/remotes/origin/unrelated', 'HEAD');
  git('checkout', '-q', '-f', 'main');
  // One branch per parser case below, each a PR against main
  const branch = (name, files, from = 'main') => {
    git('checkout', '-q', '-b', name, from);
    for (const [file, text] of Object.entries(files)) write(file, text);
    git('add', '.');
    git('commit', '-q', '-m', name);
    git('checkout', '-q', '-f', 'main');
  };
  // Names git quotes (core.quotePath) or ends with a tab in its diff headers
  branch('odd-names', { 'src/utils/sp ace.js': 'export const s = 1;\n', 'src/utils/é.js': 'export const e = 1;\n' });
  // Glob syntax: Stryker reads mutate entries as globs, and a range it can't match is 0 mutants, score NaN, exit 0
  branch('glob-name', { 'src/utils/a[1].js': 'export const g = 1;\n' });
  // Odd names outside the mutate scope are not errors
  branch('fixture-odd', { 'src/scanner/__tests__/fixtures/a b.json': '{}\n', 'src/scanner/__tests__/fixtures/c[1].json': '{}\n' });
  // An added line starting "++ b/" reads "+++ b/…" in the diff, like a file header
  branch('collision-base', { 'src/utils/foo.js': 'let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;\n' });
  git('update-ref', 'refs/remotes/origin/collision-base', 'collision-base');
  branch('collision', { 'src/utils/foo.js': 'let a = 1;\n++ b/docs.md;\nlet c = 3;\nlet d = 4 > 2;\n' }, 'collision-base');
  // Glob syntax Stryker's matcher can't match (braces with a comma), and syntax it can (+)
  branch('brace-name', { 'src/utils/x{a,b}.js': 'export const x = 1;\n' });
  branch('plus-name', { 'src/utils/a+b.js': 'export const p = 1;\n' });
  // Matches itself, but Stryker's options check reads it as a glob ("Cannot combine a glob expression with a mutation range")
  branch('magic-name', { 'src/utils/a?.js': 'export const m = 1;\n' });
  // A pure deletion: no new lines
  branch('deletion', { 'src/utils/foo.js': 'let a = 1;\nlet c = 3;\nlet d = 4;\n' }, 'collision-base');
  // Two hunks 10 lines apart in one file
  const twenty = (from) => Array.from({ length: 20 }, (_, i) => `export const v${i + 1} = ${i + 1 === from ? 0 : i + 1};`).join('\n') + '\n';
  branch('hunks-base', { 'src/utils/h.js': twenty(0) });
  git('update-ref', 'refs/remotes/origin/hunks-base', 'hunks-base');
  branch('hunks', { 'src/utils/h.js': twenty(0).replace('v5 = 5;', 'v5 = 50;').replace('v15 = 15;', 'v15 = 150;') }, 'hunks-base');
  // Rename whose old name has glob syntax; another file's line 1 changes. As a pathspec, "old[1].js" also matches old1.js.
  branch('rename-glob-base', { 'src/utils/old[1].js': 'export const o = 1;\n', 'src/utils/old1.js': 'export const q = 1;\n' });
  git('update-ref', 'refs/remotes/origin/rename-glob-base', 'rename-glob-base');
  git('checkout', '-q', '-b', 'rename-glob', 'rename-glob-base');
  git('mv', 'src/utils/old[1].js', 'src/utils/new.js');
  write('src/utils/old1.js', 'export const q = 10;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'rename-glob');
  git('checkout', '-q', '-f', 'main');
  // A renamed file with one new line: only that line counts, as before
  git('checkout', '-q', '-b', 'renamed');
  git('mv', 'src/utils/foo.js', 'src/utils/bar.js');
  write('src/utils/bar.js', 'export const a = 1;\nexport const r = 2;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'renamed');
  git('checkout', '-q', '-f', 'main');
  // A base whose commit has no stryker.config.json
  git('checkout', '-q', '-b', 'no-config');
  git('rm', '-q', 'stryker.config.json');
  git('commit', '-q', '-m', 'no config');
  git('update-ref', 'refs/remotes/origin/no-config', 'HEAD');
  git('checkout', '-q', '-f', 'main');
  // The PR: one changed line in src/utils
  git('checkout', '-q', '-b', 'pr');
  write('src/utils/foo.js', 'export const a = 1;\nexport const b = (x) => x > 2;\n');
  git('commit', '-q', '-am', 'change');
  // A base that already has the PR's commit: nothing changed
  git('update-ref', 'refs/remotes/origin/same', 'HEAD');
  // Tags that shadow the base's names (git looks in refs/tags before refs/remotes), all at the PR head, so a diff
  // against them is empty. Created after the last checkout, or git warns that "main" is ambiguous.
  git('tag', 'origin/main', 'HEAD');
  git('tag', 'main', 'HEAD');
  // No refs/remotes/origin/tag-only, only a tag literally named like it: git's name lookup would fall back to it
  git('tag', 'refs/remotes/origin/tag-only', 'HEAD');
}

// Runs the script in the repo with `args`; returns exit code, output and the fake Stryker's and npx's calls
function runScript(args, { strykerExit = 0, env = {}, cwd = repo } = {}) {
  fs.rmSync(strykerLog, { force: true });
  fs.rmSync(npxLog, { force: true });
  const calls = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd, env: { ...ENV, ...env, FAKE_STRYKER_EXIT: String(strykerExit) }, encoding: 'utf8', timeout: 15000 },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr, stryker: calls(strykerLog), npx: calls(npxLog) }));
  });
}

const RANGE = 'src/utils/foo.js:2-2';
const STRYKER = 'run out/stryker.changed.json';
const foundChange = (r, base) => r.code === 0 && r.stdout.includes(`1 changed range(s) vs ${base}:\n  ${RANGE}\n`)
  && r.stryker.length === 1 && r.stryker[0] === STRYKER && r.npx.length === 0;

// --- Base resolution (AC1, AC2, AC3) ---

async function testShadowingTagsIgnored() {
  const r = await runScript(['main']);
  return report('base "main" with tags main and origin/main at the PR head → diff against refs/remotes/origin/main, finds the change',
    foundChange(r, 'refs/remotes/origin/main'), JSON.stringify(r));
}

async function testDefaultBaseIsMain() {
  const r = await runScript([]);
  return report('no base argument → refs/remotes/origin/main (tags ignored), finds the change',
    foundChange(r, 'refs/remotes/origin/main'), JSON.stringify(r));
}

async function testBranchWithSlash() {
  const r = await runScript(['release/1.x']);
  return report('base "release/1.x" → refs/remotes/origin/release/1.x, finds the change',
    foundChange(r, 'refs/remotes/origin/release/1.x'), JSON.stringify(r));
}

const failedClosed = (r, what) => r.code === 1 && r.stdout.includes(`::error::mutate:changed: ${what}`)
  && !r.stdout.includes('nothing to check') && r.stryker.length === 0;

// Reviewer, 2026-10-14: the fixture's main *is* the merge base, so diffing against the base tip would also have passed
async function testOnlyLinesSinceMergeBase() {
  const r = await runScript(['advanced']);
  return report('base branch moved on (changed line 1) → only the PR\'s line 2 counts, not the base\'s newer line',
    foundChange(r, 'refs/remotes/origin/advanced'), JSON.stringify(r));
}

async function testNoMergeBaseFails() {
  const r = await runScript(['unrelated']);
  return report('no merge base with refs/remotes/origin/unrelated → exit 1 with ::error::',
    failedClosed(r, 'no merge base with refs/remotes/origin/unrelated'), JSON.stringify(r));
}

async function testOldFormFails() {
  const r = await runScript(['origin/main']);
  return report('base "origin/main" (old form) → no refs/remotes/origin/origin/main, exit 1 with ::error::, not the tag',
    failedClosed(r, 'refs/remotes/origin/origin/main not found'), JSON.stringify(r));
}

async function testTagNamedLikeRemoteRefFails() {
  const r = await runScript(['tag-only']);
  return report('only a tag named refs/remotes/origin/tag-only → exit 1 with ::error::, not the tag',
    failedClosed(r, 'refs/remotes/origin/tag-only not found'), JSON.stringify(r));
}

async function testUnknownBranchFails() {
  const r = await runScript(['no-such-branch']);
  return report('base branch not in the repo → exit 1 with ::error::',
    failedClosed(r, 'refs/remotes/origin/no-such-branch not found'), JSON.stringify(r));
}

async function testEmptyBaseFails() {
  // CI passes "$BASE_REF": empty if github.base_ref ever is
  const r = await runScript(['']);
  return report('base "" → exit 1 with ::error::', failedClosed(r, '"" is not a usable base branch'), JSON.stringify(r));
}

async function testOptionLikeBaseNeverReachesGit() {
  const planted = path.join(tmpDir, 'planted');
  const r = await runScript([`--output=${planted}`]);
  const written = fs.readdirSync(tmpDir).filter((name) => name.startsWith('planted'));
  return report('base "--output=<file>" → exit 1 with ::error:: and git never sees it',
    failedClosed(r, `${JSON.stringify(`--output=${planted}`)} is not a usable base branch`) && written.length === 0, JSON.stringify({ ...r, written }));
}

// Reviewer, 2026-10-14: the parser expects '+++ b/<file>' lines, so a user's diff settings hid every change
async function testUserDiffConfigIgnored() {
  const settings = [['diff.mnemonicPrefix', 'true'], ['diff.noprefix', 'true'], ['color.diff', 'always'], ['diff.external', 'true']];
  const failures = [];
  for (const [key, value] of settings) {
    const r = await runScript(['main'], { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: key, GIT_CONFIG_VALUE_0: value } });
    if (!foundChange(r, 'refs/remotes/origin/main')) failures.push({ key, value, ...r });
  }
  return report('git config diff.mnemonicPrefix / diff.noprefix / color.diff=always / diff.external → still finds the change',
    failures.length === 0, JSON.stringify(failures));
}

// --- The diff parser can't drop or shift a change (follow-up to PR #42's review) ---

// Runs `fn` with `name` checked out, then returns to the PR branch
async function onBranch(name, fn) {
  git('checkout', '-q', '-f', name);
  try {
    return await fn();
  } finally {
    git('checkout', '-q', '-f', 'pr');
  }
}

async function testOddNamesCount() {
  const r = await onBranch('odd-names', () => runScript(['main']));
  return report('changed files named "sp ace.js" and "é.js" (default config) → both checked',
    r.code === 0 && r.stdout.includes('2 changed range(s) vs refs/remotes/origin/main:')
      && r.stdout.includes('  src/utils/sp ace.js:1-1\n') && r.stdout.includes('  src/utils/é.js:1-1\n') && r.stryker.length === 1,
    JSON.stringify(r));
}

async function testUntrackedOddNameCounts() {
  write('src/utils/new file é.js', 'export const n = 1;\n');
  try {
    const r = await runScript(['main']);
    return report('an untracked "new file é.js" counts as changed (whole file)',
      r.code === 0 && r.stdout.includes('2 changed range(s)') && r.stdout.includes('  src/utils/new file é.js\n'), JSON.stringify(r));
  } finally {
    fs.rmSync(path.join(repo, 'src/utils/new file é.js'), { force: true });
  }
}

async function testGlobNameFails() {
  const r = await onBranch('glob-name', () => runScript(['main']));
  return report('changed file "a[1].js" (glob syntax, Stryker would match nothing) → exit 1 with ::error::, Stryker not run',
    failedClosed(r, '"src/utils/a[1].js" changed, but Stryker can\'t match its path'), JSON.stringify(r));
}

async function testBraceNameFails() {
  const r = await onBranch('brace-name', () => runScript(['main']));
  return report('changed file "x{a,b}.js" (brace expansion) → exit 1 with ::error::, Stryker not run',
    failedClosed(r, '"src/utils/x{a,b}.js" changed, but Stryker can\'t match its path'), JSON.stringify(r));
}

async function testUntrackedGlobNameFails() {
  write('src/utils/u{a,b}.js', 'export const u = 1;\n');
  try {
    const r = await runScript(['main']);
    return report('an untracked "u{a,b}.js" → exit 1 with ::error::, Stryker not run',
      failedClosed(r, '"src/utils/u{a,b}.js" changed, but Stryker can\'t match its path'), JSON.stringify(r));
  } finally {
    fs.rmSync(path.join(repo, 'src/utils/u{a,b}.js'), { force: true });
  }
}

async function testNameStrykerMatchesCounts() {
  const r = await onBranch('plus-name', () => runScript(['main']));
  return report('changed file "a+b.js" (Stryker matches it) → checked, not rejected',
    r.code === 0 && r.stdout.includes('1 changed range(s) vs refs/remotes/origin/main:\n  src/utils/a+b.js:1-1\n'), JSON.stringify(r));
}

async function testMagicNameFails() {
  const r = await onBranch('magic-name', () => runScript(['main']));
  return report('changed file "a?.js" (Stryker reads it as a glob) → exit 1 with ::error::, Stryker not run',
    failedClosed(r, '"src/utils/a?.js" changed, but Stryker reads its name as a glob'), JSON.stringify(r));
}

// Reviewer, 2026-10-14: Stryker also drops whole folders (.next, node_modules in any case, ignorePatterns) before
// matching, and then logs no "Found N of M" line at all: 0 mutants, score NaN, exit 0. Its count is checked after the run.
async function testStrykerMatchedNothingFails() {
  const r = await runScript(['main'], { env: { FAKE_STRYKER_FOUND: 'none' } });
  return report('Stryker logs no "Found N of M file(s)" line (matched nothing) and exits 0 → exit 1 with ::error::',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: Stryker found no file(s) to mutate, expected 1') && r.stryker.length === 1, JSON.stringify(r));
}

async function testStrykerMatchedFewerFails() {
  const r = await onBranch('odd-names', () => runScript(['main'], { env: { FAKE_STRYKER_FOUND: '1' } }));
  return report('2 changed files, Stryker found 1 and exits 0 → exit 1 with ::error::',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: Stryker found 1 file(s) to mutate, expected 2'), JSON.stringify(r));
}

// Reviewer, 2026-10-14: Stryker resolves each mutate entry against the checkout folder, so the folder is part of the glob
async function testCheckoutFolderWithGlobSyntaxFails() {
  const clone = path.join(tmpDir, 'da[sh]');
  git('clone', '-q', '--no-hardlinks', repo, clone);
  const r = await runScript(['main'], { cwd: clone });
  return report('checkout in a folder named "da[sh]" (Stryker would match nothing, score NaN, exit 0) → exit 1 with ::error::',
    failedClosed(r, '"src/utils/foo.js" changed, but Stryker can\'t match its path'), JSON.stringify(r));
}

async function testInterHunkContextIgnored() {
  const r = await onBranch('hunks', () => runScript(['hunks-base'], { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'diff.interHunkContext', GIT_CONFIG_VALUE_0: '20' } }));
  return report('diff.interHunkContext=20 → still h.js:5-5 and h.js:15-15, not 5-15',
    r.code === 0 && r.stdout.includes('2 changed range(s) vs refs/remotes/origin/hunks-base:\n  src/utils/h.js:5-5\n  src/utils/h.js:15-15\n'), JSON.stringify(r));
}

async function testRenameGlobOldPathNotCredited() {
  const r = await onBranch('rename-glob', () => runScript(['rename-glob-base']));
  return report('rename of "old[1].js" → new.js, old1.js line 1 changed → only old1.js:1-1 (new.js gets no one else\'s hunk)',
    r.code === 0 && r.stdout.includes('1 changed range(s) vs refs/remotes/origin/rename-glob-base:\n  src/utils/old1.js:1-1\n'), JSON.stringify(r));
}

async function testRenameWithoutRenameConfig() {
  const r = await onBranch('renamed', () => runScript(['main'], { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'diff.renames', GIT_CONFIG_VALUE_0: 'false' } }));
  return report('rename with diff.renames=false → still only bar.js:2-2',
    r.code === 0 && r.stdout.includes('1 changed range(s) vs refs/remotes/origin/main:\n  src/utils/bar.js:2-2\n'), JSON.stringify(r));
}

async function testPureDeletionNoRange() {
  const r = await onBranch('deletion', () => runScript(['collision-base']));
  return report('a deleted line only → "nothing to check", no "foo.js:2-1" range',
    r.code === 0 && r.stdout.includes('nothing to check') && r.stryker.length === 0, JSON.stringify(r));
}

async function testUncommittedEditCounts() {
  write('src/utils/foo.js', 'export const a = 100;\nexport const b = (x) => x > 2;\n');
  try {
    const r = await runScript(['main']);
    return report('an uncommitted edit to line 1 counts with the committed line 2 → foo.js:1-2',
      r.code === 0 && r.stdout.includes('1 changed range(s) vs refs/remotes/origin/main:\n  src/utils/foo.js:1-2\n'), JSON.stringify(r));
  } finally {
    git('checkout', '-q', '--', 'src/utils/foo.js');
  }
}

async function testOutOfScopeOddNamesIgnored() {
  const r = await onBranch('fixture-odd', () => runScript(['main']));
  return report('odd names outside the mutate scope (test fixtures) → "nothing to check", not an error',
    r.code === 0 && r.stdout.includes('nothing to check') && r.stryker.length === 0, JSON.stringify(r));
}

async function testContentLikeHeaderIgnored() {
  const r = await onBranch('collision', () => runScript(['collision-base']));
  return report('an added line "++ b/docs.md;" doesn\'t hide the next hunk → foo.js:2-2 and foo.js:4-4',
    r.code === 0 && r.stdout.includes('2 changed range(s) vs refs/remotes/origin/collision-base:\n  src/utils/foo.js:2-2\n  src/utils/foo.js:4-4\n'),
    JSON.stringify(r));
}

async function testRenameKeepsOnlyNewLines() {
  const r = await onBranch('renamed', () => runScript(['main']));
  return report('renamed foo.js → bar.js plus one line → only bar.js:2-2 (rename detected, not the whole file)',
    r.code === 0 && r.stdout.includes('1 changed range(s) vs refs/remotes/origin/main:\n  src/utils/bar.js:2-2\n'), JSON.stringify(r));
}

async function testAttributesIgnored() {
  const attrs = path.join(tmpDir, 'attributes');
  const textconv = [['diff.up.textconv', 'sed 1d']];
  // GIT_CONFIG_COUNT / KEY_n / VALUE_n for a list of [key, value]
  const gitConfigEnv = (pairs) => Object.assign({ GIT_CONFIG_COUNT: String(pairs.length) },
    ...pairs.map(([key, value], i) => ({ [`GIT_CONFIG_KEY_${i}`]: key, [`GIT_CONFIG_VALUE_${i}`]: value })));
  const cases = [
    ['core.attributesFile, textconv', '*.js diff=up\n', 'global', textconv],
    ['core.attributesFile, -diff', '*.js -diff\n', 'global', []],
    ['.gitattributes, textconv', '*.js diff=up\n', 'repo', textconv],
    ['.gitattributes, -diff', '*.js -diff\n', 'repo', []],
  ];
  const failures = [];
  for (const [name, text, where, extra] of cases) {
    const file = where === 'global' ? attrs : path.join(repo, '.gitattributes');
    fs.writeFileSync(file, text);
    const env = gitConfigEnv(where === 'global' ? [['core.attributesFile', attrs], ...extra] : extra);
    try {
      const r = await runScript(['main'], { env });
      if (!foundChange(r, 'refs/remotes/origin/main')) failures.push({ name, ...r });
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  return report('textconv / -diff attributes (core.attributesFile or .gitattributes) → still foo.js:2-2',
    failures.length === 0, JSON.stringify(failures));
}

async function testDiffOptsEnvIgnored() {
  const r = await runScript(['main'], { env: { GIT_DIFF_OPTS: '--unified=3' } });
  return report('GIT_DIFF_OPTS=--unified=3 → still foo.js:2-2, not widened', foundChange(r, 'refs/remotes/origin/main'), JSON.stringify(r));
}

// --- Unchanged behaviour (AC5) ---

async function testNothingChanged() {
  const r = await runScript(['same']);
  return report('base already has the PR\'s commit → "nothing to check", exit 0, Stryker not run',
    r.code === 0 && r.stdout.includes('nothing to check') && r.stryker.length === 0, JSON.stringify(r));
}

async function testUntrackedFileCounts() {
  write('src/scanner/new-scanner.js', 'export const c = 3;\n');
  try {
    const r = await runScript(['main']);
    return report('an untracked new src/scanner file counts as changed (whole file)',
      r.code === 0 && r.stdout.includes('2 changed range(s) vs refs/remotes/origin/main:') && r.stdout.includes('  src/scanner/new-scanner.js\n'),
      JSON.stringify(r));
  } finally {
    fs.rmSync(path.join(repo, 'src/scanner'), { recursive: true, force: true });
  }
}

async function testExtraArgsAndConfig() {
  const r = await runScript(['main', '--concurrency', '4']);
  const conf = JSON.parse(fs.readFileSync(path.join(repo, 'out/stryker.changed.json'), 'utf8'));
  return report('extra args reach Stryker after the generated config; it mutates only the changed range at 80',
    r.code === 0 && r.stryker.length === 1 && r.stryker[0] === `${STRYKER} --concurrency 4` && r.npx.length === 0
      && JSON.stringify(conf.mutate) === JSON.stringify([RANGE]) && conf.thresholds.break === 80,
    JSON.stringify({ ...r, conf }));
}

// --- The PR's own config and args can't weaken the check (user decision 2026-10-15) ---

// Writes the PR's stryker.config.json (uncommitted, as a local run sees it) for `fn`, then restores it
async function withConfig(edit, fn) {
  const file = path.join(repo, 'stryker.config.json');
  const saved = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, JSON.stringify(edit(JSON.parse(saved))));
  try {
    return await fn();
  } finally {
    fs.writeFileSync(file, saved);
  }
}

// Reproduced 2026-10-15 with real Stryker: "Found 1 of 119", no mutants tested, exit 0
async function testConfigDryRunOnlyFails() {
  const r = await withConfig((c) => ({ ...c, dryRunOnly: true }), () => runScript(['main']));
  return report('PR config adds dryRunOnly: true → exit 1 with ::error:: naming dryRunOnly; Stryker not started',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: this PR changes stryker.config.json key(s) a PR may not change: dryRunOnly (')
      && r.stryker.length === 0 && r.npx.length === 0, JSON.stringify(r));
}

async function testConfigOnlyChangeFails() {
  const r = await withConfig((c) => ({ ...c, mutate: [] }), () => runScript(['same']));
  return report('no src lines changed but PR config changes mutate → exit 1 with ::error::, not "nothing to check"',
    r.code === 1 && r.stdout.includes('may not change: mutate (') && !r.stdout.includes('nothing to check') && r.stryker.length === 0, JSON.stringify(r));
}

async function testConfigBreakLoweredFails() {
  const r = await withConfig((c) => ({ ...c, thresholds: { ...c.thresholds, break: 10 } }), () => runScript(['main']));
  return report('PR config lowers thresholds.break → exit 1 with ::error:: "lowered (60 -> 10)"; Stryker not started',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: thresholds.break was lowered (60 -> 10)') && r.stryker.length === 0, JSON.stringify(r));
}

async function testConfigChangeableKeyRuns() {
  const r = await withConfig((c) => ({ ...c, reporters: ['html'], concurrency: 2 }), () => runScript(['main']));
  return report('PR config changes only reporters and concurrency → runs as usual', foundChange(r, 'refs/remotes/origin/main'), JSON.stringify(r));
}

async function testBaseWithoutConfigFails() {
  const r = await runScript(['no-config']);
  return report('base has no stryker.config.json → exit 1 with ::error:: "could not be read"; Stryker not started',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: refs/remotes/origin/no-config:stryker.config.json could not be read') && r.stryker.length === 0,
    JSON.stringify(r));
}

async function testPrWithoutConfigFails() {
  const r = await withConfig((c) => c, async () => {
    fs.rmSync(path.join(repo, 'stryker.config.json'));
    return runScript(['main']);
  });
  return report('PR has no stryker.config.json → exit 1 with ::error::; Stryker not started',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: this PR\'s stryker.config.json could not be read') && r.stryker.length === 0, JSON.stringify(r));
}

// Reproduced 2026-10-15 with real Stryker: `--dryRunOnly` after the base tested no mutants and exited 0
async function testDryRunOnlyArgFails() {
  const r = await runScript(['main', '--concurrency', '4', '--dryRunOnly']);
  return report('arg --dryRunOnly after --concurrency 4 → exit 1 with ::error::; Stryker not started',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: only "--concurrency <n>" may be passed on to Stryker') && r.stryker.length === 0, JSON.stringify(r));
}

async function testMutateArgFails() {
  const r = await runScript(['main', '--mutate', 'src/utils/foo.js:1-1']);
  return report('arg --mutate → exit 1 with ::error::; Stryker not started',
    r.code === 1 && r.stdout.includes('may be passed on to Stryker') && r.stryker.length === 0, JSON.stringify(r));
}

async function testStrykerFailureFails() {
  const r = await runScript(['main'], { strykerExit: 1, env: { FAKE_STRYKER_UNDER: '1' } });
  return report('Stryker exits 1 (under the bar) → exit 1 with "under 80%"',
    r.code === 1 && r.stderr.includes('under 80% of planted bugs') && r.stryker.length === 1, JSON.stringify(r));
}

async function testStrykerErrorNotCalledUnderBar() {
  const r = await runScript(['main'], { strykerExit: 1 });
  return report('Stryker exits 1 without "under breaking threshold" (e.g. invalid config) → exit 1 with ::error::, not "under 80%"',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: Stryker failed (exit code 1)') && !r.stderr.includes('under 80%'), JSON.stringify(r));
}

async function testSpawnErrorShown() {
  const local = path.join(repo, 'node_modules', '.bin', 'stryker');
  fs.chmodSync(local, 0o644);
  try {
    const r = await runScript(['main']);
    return report('local Stryker not executable → exit 1 with ::error:: naming the spawn error (EACCES), not "see its output above"',
      r.code === 1 && /::error::mutate:changed: could not run Stryker: .*EACCES/.test(r.stdout) && r.npx.length === 0, JSON.stringify(r));
  } finally {
    fs.chmodSync(local, 0o755);
  }
}

// AC2: without node_modules, `npx stryker` installs and runs the registry package `stryker` (Stryker 1.x) unprompted
// in CI; the script must stop before starting anything
async function testMissingLocalStrykerFails() {
  const local = path.join(repo, 'node_modules', '.bin', 'stryker');
  fs.renameSync(local, `${local}.away`);
  try {
    const r = await runScript(['main']);
    return report('no node_modules/.bin/stryker → exit 1 with ::error:: to run npm ci; neither Stryker nor npx is started',
      r.code === 1 && r.stdout.includes('::error::mutate:changed: Stryker isn\'t installed (node_modules/.bin/stryker is missing): run npm ci')
        && r.stryker.length === 0 && r.npx.length === 0, JSON.stringify(r));
  } finally {
    fs.renameSync(`${local}.away`, local);
  }
}

async function testKilledBySignalNamed() {
  const r = await runScript(['main'], { env: { FAKE_STRYKER_SIGNAL: 'SIGKILL' } });
  return report('Stryker killed by SIGKILL → exit 1 with ::error:: naming the signal, not "under 80%"',
    r.code === 1 && r.stdout.includes('::error::mutate:changed: Stryker failed (signal SIGKILL)') && !r.stderr.includes('under 80%'), JSON.stringify(r));
}

const results = [];
try {
  setup();
  installStryker(repo);
  for (const test of [testShadowingTagsIgnored, testDefaultBaseIsMain, testBranchWithSlash, testOnlyLinesSinceMergeBase, testNoMergeBaseFails, testOldFormFails, testTagNamedLikeRemoteRefFails,
    testUnknownBranchFails, testEmptyBaseFails, testOptionLikeBaseNeverReachesGit, testUserDiffConfigIgnored, testOddNamesCount, testUntrackedOddNameCounts, testGlobNameFails,
    testMagicNameFails, testStrykerMatchedNothingFails, testStrykerMatchedFewerFails, testStrykerErrorNotCalledUnderBar, testSpawnErrorShown, testMissingLocalStrykerFails, testKilledBySignalNamed,
    testBraceNameFails, testUntrackedGlobNameFails, testNameStrykerMatchesCounts, testCheckoutFolderWithGlobSyntaxFails,
    testInterHunkContextIgnored, testRenameGlobOldPathNotCredited, testRenameWithoutRenameConfig, testPureDeletionNoRange, testUncommittedEditCounts,
    testOutOfScopeOddNamesIgnored, testContentLikeHeaderIgnored, testRenameKeepsOnlyNewLines, testAttributesIgnored, testDiffOptsEnvIgnored,
    testNothingChanged, testUntrackedFileCounts,
    testExtraArgsAndConfig, testConfigDryRunOnlyFails, testConfigOnlyChangeFails, testConfigBreakLoweredFails, testConfigChangeableKeyRuns,
    testBaseWithoutConfigFails, testPrWithoutConfigFails, testDryRunOnlyArgFails, testMutateArgFails, testStrykerFailureFails]) {
    results.push(await test());
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
