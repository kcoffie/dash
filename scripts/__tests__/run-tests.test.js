// scripts/run-tests.js (Stryker's single-process test command) must pass and fail exactly where `node --test`
// does: one process per file, a file passes when its process exits 0. Each case below is a tiny test file written
// to a temp dir and run through the real runner.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(__dirname, '..', 'run-tests.js');
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '.test-tmp-runtests-'));

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// Each file appends its name to ran.log when it finishes, so a test can see which files ran
const RAN = path.join(tmpDir, 'ran.log');
const mark = (name) => `require('fs').appendFileSync(${JSON.stringify(RAN)}, ${JSON.stringify(`${name}\n`)});`;
const FILES = {
  'pass.mjs': `${mark('pass')} process.exit(0);`,
  'pass-no-arg.mjs': `${mark('pass-no-arg')} process.exit();`,
  'fail.mjs': `${mark('fail')} process.exit(1);`,
  'fail-code-3.mjs': `${mark('fail-code-3')} process.exit(3);`,
  'throws.mjs': "throw new Error('top-level');",
  // runTests() not awaited (5 real test files do this): exit is called after the import has resolved
  'async-pass.mjs': `async function run() { await new Promise((r) => setTimeout(r, 20)); ${mark('async-pass')} process.exit(0); } run();`,
  'async-fail.mjs': `async function run() { await new Promise((r) => setTimeout(r, 20)); ${mark('async-fail')} process.exit(1); } run();`,
  // Never calls process.exit: Node exits with process.exitCode (0 when unset) once the event loop drains
  'drains.mjs': `setTimeout(() => { ${mark('drains')} }, 20);`,
  'drains-exitcode-1.mjs': `setTimeout(() => { ${mark('drains-exitcode-1')} process.exitCode = 1; }, 20);`,
  'exitcode-4-then-exit-no-arg.mjs': `process.exitCode = 4; ${mark('exitcode-4-then-exit-no-arg')} process.exit();`,
  'sets-exitcode-then-exits-0.mjs': `process.exitCode = 1; ${mark('sets-exitcode-then-exits-0')} process.exit(0);`,
  'unhandled-rejection.mjs': "Promise.reject(new Error('nobody catches this'));",
  // A top-level await that never settles: Node exits 13 once the loop is empty, so the file fails
  'unsettled-await.mjs': `${mark('unsettled-await')} await new Promise(() => {}); process.exit(0);`,
  // Leaves a timer running after process.exit(0): as its own process the exit ends it, in one process it would
  // fire during the next file. The runner must refuse instead of crediting it to the next file.
  'leaves-timer.mjs': `${mark('leaves-timer')} setTimeout(() => process.exit(1), 50); process.exit(0);`,
};
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
for (const [name, body] of Object.entries(FILES)) {
  // createRequire so `require('fs')` works inside the .mjs fixtures
  fs.writeFileSync(path.join(tmpDir, name), `import { createRequire } from 'module'; const require = createRequire(import.meta.url);\n${body}\n`);
}

// Runs the runner on the given fixture files (in order); returns exit code, output and the files that finished
function run(...names) {
  fs.rmSync(RAN, { force: true });
  return new Promise((resolve) => {
    execFile('node', [RUNNER, ...names.map((n) => path.join(tmpDir, n))], { cwd: tmpDir, encoding: 'utf8', timeout: 20000 }, (error, stdout, stderr) => {
      const ran = fs.existsSync(RAN) ? fs.readFileSync(RAN, 'utf8').split('\n').filter(Boolean) : [];
      resolve({ code: error ? error.code : 0, stdout, stderr, ran });
    });
  });
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (r) => JSON.stringify({ code: r.code, ran: r.ran, stderr: r.stderr.slice(-300) });

async function testAllPassRunsEveryFile() {
  const r = await run('pass.mjs', 'pass-no-arg.mjs', 'async-pass.mjs', 'drains.mjs');
  return report('every file exits 0 (explicit, no argument, after the import, or by draining) → exit 0, all files ran in order',
    r.code === 0 && same(r.ran, ['pass', 'pass-no-arg', 'async-pass', 'drains']), show(r));
}

async function testFailingFileFailsAndIsNamed() {
  const results = [];
  for (const name of ['fail.mjs', 'fail-code-3.mjs', 'async-fail.mjs', 'drains-exitcode-1.mjs', 'exitcode-4-then-exit-no-arg.mjs']) {
    const r = await run('pass.mjs', name);
    results.push(r.code === 1 && r.stderr.includes(name));
  }
  return report('a file exiting non-zero (exit(1), exit(3), exit after the import, exitCode 1 on drain, exit() after exitCode 4) → exit 1 naming the file',
    results.every(Boolean), JSON.stringify(results));
}

async function testThrowingFileFails() {
  const r = await run('pass.mjs', 'throws.mjs');
  return report('a file that throws while loading → exit 1 naming the file', r.code === 1 && r.stderr.includes('throws.mjs'), show(r));
}

async function testUnhandledRejectionFails() {
  const r = await run('unhandled-rejection.mjs', 'pass.mjs');
  return report('an unhandled rejection → exit 1, as Node does', r.code === 1, show(r));
}

async function testUnsettledTopLevelAwaitFails() {
  const r = await run('unsettled-await.mjs', 'pass.mjs');
  return report('a top-level await that never settles → exit 1 naming the file (Node: exit 13), not a pass on drain',
    r.code === 1 && r.stderr.includes('unsettled-await.mjs') && same(r.ran, ['unsettled-await']), show(r));
}

async function testLeftoverTimerFailsThatFile() {
  const r = await run('leaves-timer.mjs', 'pass.mjs');
  return report('a file that leaves a timer running → exit 1 naming that file (never credited to the next file)',
    r.code === 1 && r.stderr.includes('leaves-timer.mjs') && r.stderr.includes('timer') && same(r.ran, ['leaves-timer']), show(r));
}

async function testSingleFileArgument() {
  const r = await run('pass.mjs');
  return report('one file argument → runs only that file', r.code === 0 && same(r.ran, ['pass']), show(r));
}

async function testDefaultDiscovery() {
  // No arguments: src/**/__tests__/*.test.js under the cwd, nested folders included, sorted; nothing else.
  // Sorted by path: 'src/a/__tests__/…' before 'src/a/deep/…' because '_' (0x5F) < 'd' (0x64).
  const root = path.join(tmpDir, 'discover');
  const files = {
    'src/b/__tests__/z.test.js': 'b-z', 'src/a/__tests__/y.test.js': 'a-y', 'src/a/deep/er/__tests__/x.test.js': 'a-deep',
    'src/__tests__/fixtures/decoy.test.js': 'decoy-in-fixtures', 'src/a/__tests__/helper.js': 'helper', 'test/__tests__/w.test.js': 'outside-src',
  };
  for (const [file, name] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `require('fs').appendFileSync(${JSON.stringify(RAN)}, ${JSON.stringify(`${name}\n`)}); process.exit(0);\n`);
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{ "type": "commonjs" }');
  fs.rmSync(RAN, { force: true });
  const r = await new Promise((resolve) => {
    execFile('node', [RUNNER], { cwd: root, encoding: 'utf8', timeout: 20000 }, (error, stdout, stderr) => {
      const ran = fs.existsSync(RAN) ? fs.readFileSync(RAN, 'utf8').split('\n').filter(Boolean) : [];
      resolve({ code: error ? error.code : 0, stdout, stderr, ran });
    });
  });
  return report('no arguments → every src/**/__tests__/*.test.js under the cwd, nested ones too, in sorted path order, nothing else',
    r.code === 0 && same(r.ran, ['a-y', 'a-deep', 'b-z']), show(r));
}

async function testStopsAtFirstFailure() {
  // Stryker only needs pass/fail, and a failure is a kill however many files ran
  const r = await run('pass.mjs', 'fail.mjs', 'pass-no-arg.mjs');
  return report('stops at the first failing file (later files don\'t run)', r.code === 1 && same(r.ran, ['pass', 'fail']), show(r));
}

async function testExitCodeDoesNotLeakIntoNextFile() {
  // Separate processes start with no exitCode; the runner must reset it between files
  const r = await run('sets-exitcode-then-exits-0.mjs', 'drains.mjs');
  return report('process.exitCode set by one file doesn\'t fail the next (each file starts with none)',
    r.code === 0 && same(r.ran, ['sets-exitcode-then-exits-0', 'drains']), show(r));
}

async function testNoFilesFails() {
  const r = await run();
  // With no arguments the runner globs src/**/__tests__/*.test.js under the cwd; the temp dir has none
  return report('no test files found → exit 1 (an empty run must not pass)', r.code === 1 && r.stderr.includes('no test files'), show(r));
}

const results = [];
try {
  for (const test of [testAllPassRunsEveryFile, testFailingFileFailsAndIsNamed, testThrowingFileFails, testUnhandledRejectionFails,
    testStopsAtFirstFailure, testExitCodeDoesNotLeakIntoNextFile, testNoFilesFails, testUnsettledTopLevelAwaitFails,
    testLeftoverTimerFailsThatFile, testSingleFileArgument, testDefaultDiscovery]) {
    results.push(await test());
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
