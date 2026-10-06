// Mutation-test only the scanner/utils lines this branch changed, and fail below the bar.
// The whole-project ratchet (thresholds.break in stryker.config.json) stops the score
// dropping; this stops new code arriving with weak tests while the total still looks fine.
// Usage: npm run mutate:changed [-- <base ref, default origin/main>]
// A mutant that truly changes nothing observable can be skipped in the code with
//   // Stryker disable next-line <Mutator>: <reason>
// and the reviewer checks the reason.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BAR = 80;
const base = process.argv[2] ?? 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

// Same scope as "mutate" in stryker.config.json
const DIRS = ['src/scanner/', 'src/utils/'];
const inScope = (file) => file.endsWith('.js') && !file.includes('/__tests__/') && file !== 'src/scanner/index.js';

// Changed line ranges per file, from a zero-context diff: '@@ -a,b +c,d @@' -> lines c..c+d-1
const ranges = [];
let file = null;
// Against the merge base, working tree included, so it also checks work not committed yet
const mergeBase = git('merge-base', base, 'HEAD').trim();
for (const line of git('diff', '-U0', mergeBase, '--', ...DIRS).split('\n')) {
  const target = line.match(/^\+\+\+ (?:b\/(.+)|\/dev\/null)$/);
  if (target) { file = target[1] && inScope(target[1]) ? target[1] : null; continue; }
  const hunk = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
  if (hunk && file && hunk[2] !== '0') ranges.push(`${file}:${hunk[1]}-${Number(hunk[1]) + Number(hunk[2] ?? 1) - 1}`);
}
// New files not yet added to git: the whole file counts as changed
for (const untracked of git('ls-files', '--others', '--exclude-standard', '--', ...DIRS).split('\n')) {
  if (inScope(untracked)) ranges.push(untracked);
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
try {
  execFileSync('npx', ['stryker', 'run', 'out/stryker.changed.json', ...process.argv.slice(3)], { stdio: 'inherit' });
} catch {
  console.error(`\nmutate:changed: under ${BAR}% of planted bugs in the changed lines were caught. See out/mutation-changed.html`);
  process.exit(1);
}
