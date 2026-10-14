// End to end: scripts/mutate-changed.js against a real temp git repo. Checks which base the changed lines are taken
// from (exactly refs/remotes/origin/<branch>, never a tag of a similar name), that a base it can't resolve fails
// closed, and what reaches Stryker. `npx` is a fake on PATH that records its arguments, so no Stryker (or registry
// package) runs. Lives in scripts/__tests__: `npm test` runs it, Stryker doesn't (`test:src`).

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

// --- Fake npx: appends its arguments to a log, exits with $FAKE_NPX_EXIT (default 0) ---

const bin = path.join(tmpDir, 'bin');
const npxLog = path.join(tmpDir, 'npx.log');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${npxLog}'\nexit "\${FAKE_NPX_EXIT:-0}"\n`, { mode: 0o755 });

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

// Runs the script in the repo with `args`; returns exit code, output and the fake npx's calls
function runScript(args, { npxExit = 0 } = {}) {
  fs.rmSync(npxLog, { force: true });
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd: repo, env: { ...ENV, FAKE_NPX_EXIT: String(npxExit) }, encoding: 'utf8', timeout: 15000 },
      (error, stdout, stderr) => {
        const npx = fs.existsSync(npxLog) ? fs.readFileSync(npxLog, 'utf8').split('\n').filter(Boolean) : [];
        resolve({ code: error ? error.code : 0, stdout, stderr, npx });
      });
  });
}

const RANGE = 'src/utils/foo.js:2-2';
const STRYKER = 'stryker run out/stryker.changed.json';
const foundChange = (r, base) => r.code === 0 && r.stdout.includes(`1 changed range(s) vs ${base}:\n  ${RANGE}\n`)
  && r.npx.length === 1 && r.npx[0] === STRYKER;

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
  && !r.stdout.includes('nothing to check') && r.npx.length === 0;

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

// --- Unchanged behaviour (AC5) ---

async function testNothingChanged() {
  const r = await runScript(['same']);
  return report('base already has the PR\'s commit → "nothing to check", exit 0, Stryker not run',
    r.code === 0 && r.stdout.includes('nothing to check') && r.npx.length === 0, JSON.stringify(r));
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
    r.code === 0 && r.npx.length === 1 && r.npx[0] === `${STRYKER} --concurrency 4`
      && JSON.stringify(conf.mutate) === JSON.stringify([RANGE]) && conf.thresholds.break === 80,
    JSON.stringify({ ...r, conf }));
}

async function testStrykerFailureFails() {
  const r = await runScript(['main'], { npxExit: 1 });
  return report('Stryker exits 1 (under the bar) → exit 1 with "under 80%"',
    r.code === 1 && r.stderr.includes('under 80% of planted bugs') && r.npx.length === 1, JSON.stringify(r));
}

const results = [];
try {
  setup();
  for (const test of [testShadowingTagsIgnored, testDefaultBaseIsMain, testBranchWithSlash, testOnlyLinesSinceMergeBase, testNoMergeBaseFails, testOldFormFails, testTagNamedLikeRemoteRefFails,
    testUnknownBranchFails, testEmptyBaseFails, testOptionLikeBaseNeverReachesGit, testNothingChanged, testUntrackedFileCounts,
    testExtraArgsAndConfig, testStrykerFailureFails]) {
    results.push(await test());
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
