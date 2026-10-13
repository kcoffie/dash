// Every `stryker run` in the repo must name its config file. Without one, Stryker 10 takes the first of
// stryker.conf.{json,js,mjs,cjs}, then stryker.config.*, then the dot-prefixed variants, so a PR adding
// stryker.conf.json with a lower thresholds.break would pass the ratchet step (which reads stryker.config.json) and
// lower main's `mutation-full` threshold (reviewer, PR #37). Checked here: the workflows, package.json scripts, and
// scripts/*.js (array form, e.g. execFileSync('npx', ['stryker', 'run', <file>, ...])). Only tracked files (`git ls-files`),
// so untracked copies (like iCloud's "name 2.js") don't make local results differ from CI's.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// `stryker run` in a shell line or a quoted array, then the next token (empty when the line ends there)
const CALL = /\bstryker['"]?\s*,?\s*['"]?run\b['"]?\s*,?\s*['"]?([^\s'",)\]]*)/g;

// One { where, arg } per `stryker run` call in the text; arg is the token after `run` ('' when none)
export function strykerRunCalls(text, where) {
  return [...text.matchAll(CALL)].map((m) => ({ where, arg: m[1] }));
}

// A call names its config when the first argument is a file, not an option or nothing
const namesConfig = ({ arg }) => arg !== '' && !arg.startsWith('-') && /\.(json|js|mjs|cjs)$/.test(arg);

function testMatcher() {
  const cases = [
    ['npx stryker run --concurrency 4', false],
    ['stryker run', false],
    ['"mutate": "stryker run",', false],
    ["execFileSync('npx', ['stryker', 'run', ...args])", false],
    ['npx stryker run stryker.config.json --concurrency 4', true],
    ['"mutate": "stryker run stryker.config.json",', true],
    ["execFileSync('npx', ['stryker', 'run', 'out/stryker.changed.json', ...args])", true],
  ];
  const wrong = cases.filter(([text, ok]) => {
    const calls = strykerRunCalls(text, 'case');
    return calls.length !== 1 || namesConfig(calls[0]) !== ok;
  });
  return report('matcher finds each call and tells a named config from none', wrong.length === 0,
    JSON.stringify(wrong.map(([text]) => text)));
}

function repoCalls() {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '.github/workflows', 'package.json', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  const calls = [];
  for (const f of tracked) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /^scripts\/[^/]+\.js$/.test(f)) calls.push(...strykerRunCalls(text, f));
    if (f === 'package.json') {
      for (const [name, command] of Object.entries(JSON.parse(text).scripts)) calls.push(...strykerRunCalls(command, `package.json "${name}"`));
    }
  }
  return calls;
}

function testEveryCallNamesConfig() {
  const calls = repoCalls();
  const bare = calls.filter((c) => !namesConfig(c));
  return report(`every stryker run names its config file (${calls.length} call(s))`, bare.length === 0,
    `\n  no config file: ${bare.map((c) => `${c.where} (${c.arg || 'nothing'})`).join(', ')}`);
}

function testCallSitesFound() {
  // Guards against a matcher that silently finds nothing: the three known call sites must be seen
  const where = repoCalls().map((c) => c.where);
  const expected = ['.github/workflows/test.yml', 'package.json "mutate"', 'scripts/mutate-changed.js'];
  const missing = expected.filter((e) => !where.includes(e));
  return report('the known call sites are found (mutation-full, npm run mutate, mutate:changed)', missing.length === 0,
    `missing: ${missing.join(', ')}`);
}

const results = [testMatcher(), testCallSitesFound(), testEveryCallNamesConfig()];
console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
