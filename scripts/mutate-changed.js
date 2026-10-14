// Mutation-test only the scanner/utils lines this branch changed, and fail below the bar.
// The whole-project ratchet (thresholds.break in stryker.config.json) stops the score
// dropping; this stops new code arriving with weak tests while the total still looks fine.
// Usage: npm run mutate:changed [-- <base branch, default main> [stryker args…]]   (CI: "$BASE_REF" --concurrency 4)
// The base is exactly refs/remotes/origin/<base branch>, resolved with `git show-ref --verify` (no name lookup):
// with a name, a tag called origin/main, or one called refs/remotes/origin/main when the remote-tracking ref is
// missing, would stand in for the branch (git looks in refs/tags first) and could make the diff empty. Anything it
// can't resolve fails with an ::error:: line. Checked end to end by scripts/__tests__/mutate-changed.test.js.
// Not guarded (Open TODO): the generated config starts from this branch's stryker.config.json, so a branch can still
// weaken its own check there (dryRunOnly, mutator.excludedMutations, …), and so can stryker args such as --mutate,
// --dryRunOnly or --logLevel warn (the last fails closed: Stryker's "Found N" line is then missing). CI passes only
// --concurrency.
// A mutant that truly changes nothing observable can be skipped in the code with
//   // Stryker disable next-line <Mutator>: <reason>
// and the reviewer checks the reason.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isUsableRef } from '../src/utils/ratchet-check.js';

const BAR = 80;
const branch = process.argv[2] ?? 'main';
const base = `refs/remotes/origin/${branch}`;
// GIT_DIFF_OPTS would override -U0 (--unified=3 widens every range). Pathspecs are literal: a renamed file's old
// name goes to git as a pathspec, and as a glob "old[1].js" would also match old1.js and credit its hunks to the rename.
const gitEnv = { ...process.env, GIT_LITERAL_PATHSPECS: '1' };
delete gitEnv.GIT_DIFF_OPTS;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', env: gitEnv, maxBuffer: 64 * 1024 * 1024 });

function fail(message) {
  console.log(`::error::mutate:changed: ${message}`);
  process.exit(1);
}
// An option-like branch never reaches git
if (!isUsableRef(branch)) fail(`${JSON.stringify(branch)} is not a usable base branch (usage: mutate-changed.js <base branch, e.g. main>)`);
let baseSha;
try {
  baseSha = git('show-ref', '--verify', '--hash', base).trim();
} catch {
  fail(`${base} not found: pass the base branch's name (e.g. main, not origin/main) and fetch it first`);
}

// Same scope as "mutate" in stryker.config.json
const DIRS = ['src/scanner/', 'src/utils/'];
const inScope = (file) => file.endsWith('.js') && !file.includes('/__tests__/') && file !== 'src/scanner/index.js';

// Against the merge base, working tree included, so it also checks work not committed yet
let mergeBase;
try {
  mergeBase = git('merge-base', baseSha, 'HEAD').trim();
} catch {
  fail(`no merge base with ${base} (shallow clone or unrelated history?)`);
}

// Stryker reads each mutate entry as a glob of its absolute path (FileMatcher in @stryker-mutator/core: minimatch,
// dot: false), so glob syntax in the file name or the checkout folder ("x{a,b}.js", "da[sh]/") can match nothing,
// and a run with 0 mutants scores NaN, which passes the bar. Each file is checked with Stryker's own minimatch first.
let minimatch, Minimatch;
try {
  const fromStryker = createRequire(createRequire(import.meta.url).resolve('@stryker-mutator/core'));
  ({ minimatch, Minimatch } = fromStryker('minimatch'));
} catch {
  fail("can't load Stryker's minimatch to check file paths (run npm ci)");
}
const checkable = (file) => {
  // Stryker's options check: a mutate entry with a range must not be a glob ("a?.js" matches itself but is one)
  if (new Minimatch(file).hasMagic()) fail(`${JSON.stringify(file)} changed, but Stryker reads its name as a glob: rename it`);
  const absolute = path.resolve(file).replace(/\\/g, '/');
  if (!minimatch(absolute, absolute, { dot: false })) {
    fail(`${JSON.stringify(file)} changed, but Stryker can't match its path ${JSON.stringify(absolute)} (glob syntax in the file or folder name): rename or move it`);
  }
  return file;
};

// Changed files, named exactly: NUL-separated name-status (never quoted), renames paired whatever diff.renames says
const changed = [];
const fields = git('diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', mergeBase, '--', ...DIRS).split('\0');
for (let i = 0; i < fields.length - 1;) {
  const status = fields[i++];
  const paths = status.startsWith('R') || status.startsWith('C') ? [fields[i++], fields[i++]] : [fields[i++]];
  const file = paths[paths.length - 1];
  if (!status.startsWith('D') && inScope(file)) changed.push({ file, paths });
}

// Changed line ranges per file, from a zero-context diff of that file (or rename pair) alone: '@@ -a,b +c,d @@'
// -> lines c..c+d-1. Only hunk headers are read: no file headers to unquote, and content lines start with ' ', '+',
// '-' or '\', so an added line that looks like a header ("++ b/x" shows as "+++ b/x") can't be taken for one.
// Fixed output whatever the user's git config or attributes say (color, external diff, textconv, -diff, merged hunks).
const diffArgs = ['--no-color', '--no-ext-diff', '--no-textconv', '--text', '--find-renames', '-U0', '--inter-hunk-context=0'];
const ranges = [];
for (const { file, paths } of changed) {
  for (const line of git('diff', ...diffArgs, mergeBase, '--', ...paths).split('\n')) {
    const hunk = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (hunk && hunk[2] !== '0') ranges.push(`${checkable(file)}:${hunk[1]}-${Number(hunk[1]) + Number(hunk[2] ?? 1) - 1}`);
  }
}
// New files not yet added to git: the whole file counts as changed
for (const untracked of git('ls-files', '--others', '--exclude-standard', '-z', '--', ...DIRS).split('\0')) {
  if (untracked && inScope(untracked)) ranges.push(checkable(untracked));
}
if (!ranges.length) {
  console.log('mutate:changed: no changed src/scanner or src/utils lines, nothing to check');
  process.exit(0);
}
console.log(`mutate:changed: ${ranges.length} changed range(s) vs ${base}:\n  ${ranges.join('\n  ')}`);

const conf = JSON.parse(readFileSync('stryker.config.json', 'utf8'));
mkdirSync('out', { recursive: true });
writeFileSync('out/stryker.changed.json', JSON.stringify({
  ...conf,
  $schema: undefined,
  mutate: ranges,
  thresholds: { high: BAR, low: BAR, break: BAR },
  htmlReporter: { fileName: 'out/mutation-changed.html' },
  jsonReporter: { fileName: 'out/mutation-changed.json' },
}, null, 2));
// Stryker's output is shown as it runs and kept: it also drops whole folders before matching (.next, node_modules in
// any case, ignorePatterns), and then logs no "Found N of M file(s) to be mutated" line, scores NaN and exits 0.
// So the count of files it found must equal the files changed, or the changed lines went unchecked.
const files = new Set(ranges.map((range) => range.replace(/:\d+-\d+$/, '')));
let output = '';
const { code, signal, error } = await new Promise((resolve) => {
  const stryker = spawn('npx', ['stryker', 'run', 'out/stryker.changed.json', ...process.argv.slice(3)], { stdio: ['inherit', 'pipe', 'pipe'] });
  stryker.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
  stryker.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
  stryker.on('error', (error) => resolve({ error }));
  stryker.on('close', (code, signal) => resolve({ code, signal }));
});
if (error) fail(`could not run Stryker: ${error.message}`);
if (code !== 0) {
  if (/under breaking threshold/.test(output)) {
    console.error(`\nmutate:changed: under ${BAR}% of planted bugs in the changed lines were caught. See out/mutation-changed.html`);
    process.exit(1);
  }
  fail(`Stryker failed (${signal ? `signal ${signal}` : `exit code ${code}`}): see its output above`);
}
const found = output.match(/Found (\d+) of \d+ file\(s\) to be mutated/);
if (!found || Number(found[1]) !== files.size) {
  fail(`Stryker found ${found ? found[1] : 'no'} file(s) to mutate, expected ${files.size} (${[...files].join(', ')}): the changed lines were not checked`);
}
