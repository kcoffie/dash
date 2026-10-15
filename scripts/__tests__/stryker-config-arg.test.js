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

// `stryker run` (also `@stryker-mutator/core run`, a version pin like `stryker@10`, a path ending in stryker or
// bin/stryker.js) in a shell line or a quoted array, then the next token (empty when the line ends there)
const CALL = /(?:@stryker-mutator\/core(?:@[\w.^~-]+)?|\bstryker(?:@[\w.^~-]+|\.js)?)['"]?[\s,[(]*['"]?run\b['"]?\s*,?\s*['"]?([^\s'",)\]]*)/g;
// Full-line comments in YAML, shell and JS (`#`, `//`, block-comment ` * `): a comment mentioning a call isn't one.
// A line starting with `/*` is kept, since code can follow the comment on it (counting a call there fails loudly).
const COMMENT_LINE = /^\s*(#|\/\/|\*).*$/gm;

// One { where, arg } per `stryker run` call in the text; arg is the token after `run` ('' when none)
function strykerRunCalls(text, where) {
  // Comments first: a shell comment ends at the newline even when it ends in `\`, so the next line is real code
  const code = text.replace(COMMENT_LINE, '').replace(/\\\r?\n/g, ' ');
  return [...code.matchAll(CALL)].map((m) => ({ where, arg: m[1] }));
}

// Stryker started through a launcher that falls back to the registry: without node_modules, `npx stryker` installs and
// runs the registry package `stryker` (Stryker 1.x, 2022) with no prompt in CI or without a terminal, and even
// `npx --no-install` asks the registry first. Stryker must run from node_modules/.bin (or a package.json script).
// Covers npx, npm exec / npm x, pnpm / yarn dlx, with options before the package, in a shell line or a quoted array.
const REGISTRY_LAUNCH = /(?:\bnpx|\bnpm['"]?[\s,[(]*['"]?(?:exec|x)|\b(?:pnpm|yarn)['"]?[\s,[(]*['"]?dlx)\b['"]?(?:[\s,[(]*['"]?-[\w-]+(?:=[^\s'",)\]]*)?['"]?)*[\s,[(]*['"]?(?:@stryker-mutator\/core|stryker)\b/g;

// One { where, text } per registry launch of Stryker in the text (comments skipped, as for calls)
function registryLaunches(text, where) {
  const code = text.replace(COMMENT_LINE, '').replace(/\\\r?\n/g, ' ');
  return [...code.matchAll(REGISTRY_LAUNCH)].map((m) => ({ where, text: m[0] }));
}

// The config each call must name: the file the ratchet step reads, except mutate-changed.js, which runs its copy of it
// (out/stryker.changed.json, built from stryker.config.json)
const expectedConfig = (where) => (where === 'scripts/mutate-changed.js' ? 'out/stryker.changed.json' : 'stryker.config.json');
const namesConfig = ({ where, arg }) => arg === expectedConfig(where);

// Tracked files whose text is searched for calls: workflows, local actions, and every script outside the tests
const isScanned = (f) => /^\.github\/.+\.ya?ml$/.test(f) || (/^scripts\/.+\.(js|mjs|cjs|sh)$/.test(f) && !f.includes('/__tests__/'));

function testMatcher() {
  const cases = [
    ['npx stryker run --concurrency 4', false],
    ['stryker run', false],
    ['"mutate": "stryker run",', false],
    ["execFileSync('npx', ['stryker', 'run', ...args])", false],
    ['npx stryker run stryker.config.json --concurrency 4', true],
    ['"mutate": "stryker run stryker.config.json",', true],
    ["execFileSync('npx', ['stryker', 'run', 'out/stryker.changed.json', ...args])", true, 'scripts/mutate-changed.js'],
    // Other ways to start Stryker (reviewer, 2026-10-13)
    ['"mutate:full": "npx @stryker-mutator/core run --concurrency 4"', false],
    ["execFileSync('node_modules/.bin/stryker', ['run', '--concurrency', '4'])", false],
    ['npx stryker \\\n            run --concurrency 4', false],
    ['npx @stryker-mutator/core run stryker.config.json', true],
    // Version-pinned and direct-path launchers, real code after a block comment (reviewer pass 2)
    ['npx @stryker-mutator/core@10 run --concurrency 4', false],
    ['npx stryker@10 run --concurrency 4', false],
    ['node node_modules/@stryker-mutator/core/bin/stryker.js run --concurrency 4', false],
    ["/* eslint-disable */ execFileSync('npx', ['stryker', 'run'])", false],
    // A shell comment ends at the newline even when it ends in a backslash: the next line is a real call
    ['# was: npx stryker run stryker.config.json \\\n        npx stryker run --concurrency 4', false],
  ];
  const wrong = cases.filter(([text, ok, where = 'case']) => {
    const calls = strykerRunCalls(text, where);
    return calls.length !== 1 || namesConfig(calls[0]) !== ok;
  });
  return report('matcher finds each call and tells the expected config from another or none', wrong.length === 0,
    JSON.stringify(wrong.map(([text]) => text)));
}

function testCommentsAreNotCalls() {
  // A comment mentioning a call must not count as one (else it could stand in for a real call site)
  const texts = ['# npx stryker run stryker.config.json', '  // execFileSync(\'npx\', [\'stryker\', \'run\'])', ' * stryker run'];
  const found = texts.filter((t) => strykerRunCalls(t, 'case').length > 0);
  return report('comment lines are not calls', found.length === 0, JSON.stringify(found));
}

function testScannedFiles() {
  const yes = ['.github/workflows/test.yml', '.github/actions/mutate/action.yaml', 'scripts/a.js', 'scripts/a.mjs', 'scripts/a.cjs',
    'scripts/a.sh', 'scripts/sub/a.js'];
  const no = ['scripts/__tests__/a.test.js', 'src/a.js', 'README.md'];
  const wrong = [...yes.filter((f) => !isScanned(f)), ...no.filter((f) => isScanned(f))];
  return report('workflows, actions and every script file are searched (not test files)', wrong.length === 0, JSON.stringify(wrong));
}

function testExactConfigNames() {
  // mutation-full and npm run mutate must use the file the ratchet step reads; mutate-changed.js its generated copy
  const wrong = [
    { where: '.github/workflows/test.yml', arg: 'stryker.conf.json' },
    { where: 'package.json "mutate"', arg: 'stryker.conf.json' },
    { where: 'scripts/mutate-changed.js', arg: 'stryker.config.json' },
  ].filter(namesConfig);
  const right = [
    { where: '.github/workflows/test.yml', arg: 'stryker.config.json' },
    { where: 'scripts/mutate-changed.js', arg: 'out/stryker.changed.json' },
  ].filter((c) => !namesConfig(c));
  return report('only stryker.config.json (or mutate-changed.js\'s generated copy) is accepted', wrong.length + right.length === 0,
    JSON.stringify({ wrongAccepted: wrong, rightRejected: right }));
}

// find(text, where) over every searched file and every package.json script
function searchRepo(find) {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '.github', 'package.json', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  const found = [];
  for (const f of tracked) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (isScanned(f)) found.push(...find(text, f));
    if (f === 'package.json') {
      for (const [name, command] of Object.entries(JSON.parse(text).scripts)) found.push(...find(command, `package.json "${name}"`));
    }
  }
  return found;
}

const repoCalls = () => searchRepo(strykerRunCalls);

function testLaunchMatcher() {
  const cases = [
    ['npx stryker run stryker.config.json --concurrency 4', true],
    ["spawn('npx', ['stryker', 'run', 'out/stryker.changed.json'])", true],
    ["spawn('npx', ['--no-install', 'stryker', 'run'])", true],
    ['npx --yes @stryker-mutator/core@10 run', true],
    ['npx --package=@stryker-mutator/core stryker run', true],
    ['npx -p @stryker-mutator/core stryker run', true],
    ['npm exec -- stryker run', true],
    ["execFileSync('npm', ['exec', 'stryker', 'run'])", true],
    ['npm x stryker run', true],
    ['pnpm dlx stryker run', true],
    ['yarn dlx @stryker-mutator/core run', true],
    ['npx \\\n  stryker run', true],
    ['./node_modules/.bin/stryker run stryker.config.json --concurrency 4', false],
    ["spawn('node_modules/.bin/stryker', ['run', 'out/stryker.changed.json'])", false],
    ['"mutate": "stryker run stryker.config.json"', false],
    ['npx vite build && ./node_modules/.bin/stryker run', false],
    ['npm run mutate', false],
    ['# was: npx stryker run', false],
  ];
  const wrong = cases.filter(([text, launch]) => (registryLaunches(text, 'case').length === 1) !== launch
    || registryLaunches(text, 'case').length > 1);
  return report('launch matcher flags npx / npm exec / dlx starting Stryker, not the local bin', wrong.length === 0,
    JSON.stringify(wrong.map(([text]) => text)));
}

function testNoRegistryLaunch() {
  const launches = searchRepo(registryLaunches);
  return report('Stryker is never started through npx / npm exec / dlx (registry fallback)', launches.length === 0,
    `\n  ${launches.map((l) => `${l.where}: ${l.text}`).join('\n  ')}`);
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

const results = [testMatcher(), testCommentsAreNotCalls(), testScannedFiles(), testExactConfigNames(), testCallSitesFound(),
  testEveryCallNamesConfig(), testLaunchMatcher(), testNoRegistryLaunch()];
console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
