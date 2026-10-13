// End to end: scripts/ratchet-check.js against a real temp git repo (no fakes). Covers what the pure tests can't:
// the `git show` call, a failed git, reading the PR's file from the working directory, the ::error:: line and the
// exit code. Lives in scripts/__tests__: `npm test` runs it, Stryker doesn't (`test:src`); the rules are unit-tested.

import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'ratchet-check.js');
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '.test-tmp-ratchet-'));

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// --- A temp repo: refs/remotes/origin/<branch> hold the base configs (as after CI's checkout), the working tree is the PR ---

const repo = path.join(tmpDir, 'repo');
fs.mkdirSync(repo);
// No inherited GIT_* variables: git sets GIT_DIR / GIT_INDEX_FILE when it runs hooks, and with them every git call
// here (and the script's `git show`) would act on the outer repo instead of the temp one
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
  { cwd: repo, env: GIT_ENV, encoding: 'utf8' }).trim();
const CONFIG = path.join(repo, 'stryker.config.json');
const config = (brk) => JSON.stringify({ thresholds: { high: 80, low: 65, break: brk } });

git('init', '-q', '-b', 'main');
fs.writeFileSync(CONFIG, config(60));
git('add', '.');
git('commit', '-q', '-m', 'base');
// A branch whose commit has no stryker.config.json
git('checkout', '-q', '--orphan', 'no-config');
git('rm', '-q', '--cached', 'stryker.config.json');
fs.writeFileSync(path.join(repo, 'other.txt'), 'x\n');
git('add', 'other.txt');
git('commit', '-q', '-m', 'no config');
git('checkout', '-q', '-f', 'main');
// Same branch with break: missing
git('checkout', '-q', '-b', 'no-break');
fs.writeFileSync(CONFIG, JSON.stringify({ thresholds: { high: 80 } }));
git('commit', '-q', '-am', 'no break');
git('checkout', '-q', 'main');
for (const branch of ['main', 'no-config', 'no-break']) git('update-ref', `refs/remotes/origin/${branch}`, branch);
// Tags that shadow the base's short names (git looks in refs/tags before refs/remotes): break 1
git('checkout', '-q', '--detach');
fs.writeFileSync(CONFIG, config(1));
git('commit', '-q', '-am', 'shadow');
const shadow = git('rev-parse', 'HEAD');
git('checkout', '-q', '-f', 'main'); // before the tags exist, or git warns that "main" is ambiguous
git('tag', 'origin/main', shadow);
git('tag', 'main', shadow);
// No refs/remotes/origin/tag-only, only a tag literally named like it: git's name lookup would fall back to it
git('tag', 'refs/remotes/origin/tag-only', shadow);
// A base branch with a slash
git('update-ref', 'refs/remotes/origin/release/1.x', 'refs/heads/main'); // not "main": the tag of that name would win

// Runs the script in the repo with `args`; the PR's config is `head` (null: no file)
function runScript(args, head) {
  if (head === null) fs.rmSync(CONFIG, { force: true });
  else fs.writeFileSync(CONFIG, head);
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd: repo, env: GIT_ENV, encoding: 'utf8', timeout: 15000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

async function testEqualPasses() {
  const r = await runScript(['main'], config(60));
  return report('base 60, PR 60 → exit 0, logs "break: base 60, this PR 60"',
    r.code === 0 && r.stdout === 'break: base 60, this PR 60\n', JSON.stringify(r));
}

async function testLoweredFails() {
  const r = await runScript(['main'], config(10));
  return report('base 60, PR 10 → exit 1 with ::error:: "lowered (60 -> 10)"',
    r.code === 1 && r.stdout.includes('::error::thresholds.break was lowered (60 -> 10)'), JSON.stringify(r));
}

async function testUnknownRefFails() {
  const r = await runScript(['no-such-branch'], config(10));
  return report('base branch not in the repo (git show fails) → exit 1 with ::error::, not base 0',
    r.code === 1 && r.stdout.includes('::error::refs/remotes/origin/no-such-branch:stryker.config.json could not be read') && !r.stdout.includes('base 0'), JSON.stringify(r));
}

async function testBaseWithoutConfigFails() {
  const r = await runScript(['no-config'], config(10));
  return report('base commit has no stryker.config.json → exit 1 with ::error::',
    r.code === 1 && r.stdout.includes('::error::refs/remotes/origin/no-config:stryker.config.json could not be read'), JSON.stringify(r));
}

async function testBaseWithoutBreakFails() {
  const r = await runScript(['no-break'], config(10));
  return report('base config without thresholds.break → exit 1 with ::error::',
    r.code === 1 && r.stdout.includes('::error::base thresholds.break is missing'), JSON.stringify(r));
}

// Reviewer, 2026-10-13: with `origin/main` on the command line, a tag named origin/main was used as the base
async function testShadowingTagsIgnored() {
  const r = await runScript(['main'], config(1));
  return report('tags named main and origin/main (break 1) are ignored: base is refs/remotes/origin/main (60) → lowered',
    r.code === 1 && r.stdout.includes('::error::thresholds.break was lowered (60 -> 1)'), JSON.stringify(r));
}

// Second reviewer, 2026-10-13: without the remote-tracking ref, `git show refs/remotes/origin/<b>:…` read refs/tags/refs/remotes/origin/<b>
async function testTagNamedLikeRemoteRefIgnored() {
  const r = await runScript(['tag-only'], config(1));
  return report('only a tag named refs/remotes/origin/tag-only exists → exit 1, base could not be read',
    r.code === 1 && r.stdout.includes('::error::refs/remotes/origin/tag-only:stryker.config.json could not be read'), JSON.stringify(r));
}

async function testBranchWithSlash() {
  const r = await runScript(['release/1.x'], config(60));
  return report('base branch release/1.x is read from refs/remotes/origin/release/1.x',
    r.code === 0 && r.stdout === 'break: base 60, this PR 60\n', JSON.stringify(r));
}

async function testPrWithoutConfigFails() {
  const r = await runScript(['main'], null);
  return report('PR has no stryker.config.json → exit 1 with ::error::',
    r.code === 1 && r.stdout.includes('::error::this PR\'s stryker.config.json could not be read'), JSON.stringify(r));
}

async function testNoRefFails() {
  const r = await runScript([], config(60));
  return report('no ref argument → exit 1 with ::error::', r.code === 1 && r.stdout.includes('::error::'), JSON.stringify(r));
}

async function testOptionLikeRefNeverReachesGit() {
  const planted = path.join(tmpDir, 'planted');
  const r = await runScript([`--output=${planted}`], config(60));
  // git show would write "<planted>:stryker.config.json", so look for any file starting with the name
  const written = fs.readdirSync(tmpDir).filter((name) => name.startsWith('planted'));
  return report('ref "--output=<file>" → exit 1 and git never writes the file',
    r.code === 1 && r.stdout.includes('not a usable base ref') && written.length === 0, JSON.stringify({ ...r, written }));
}

const results = [];
try {
  for (const test of [testEqualPasses, testLoweredFails, testUnknownRefFails, testBaseWithoutConfigFails, testBaseWithoutBreakFails,
    testShadowingTagsIgnored, testTagNamedLikeRemoteRefIgnored, testBranchWithSlash, testPrWithoutConfigFails, testNoRefFails, testOptionLikeRefNeverReachesGit]) {
    results.push(await test());
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
