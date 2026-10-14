// Contract for the stand-in `npm` the dependency tests put first on PATH (src/scanner/__tests__/helpers/bin/npm, see
// helpers/fake-npm.js). It must replay what real npm recorded: stdout byte for byte, stderr, and the exit code, and
// fail every call it wasn't recorded for. Lives in scripts/__tests__ so `npm test` runs it but Stryker's per-mutant
// command (src tests only) doesn't pay for it.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS = path.join(__dirname, '..', '..', 'src', 'scanner', '__tests__');
const FAKE = path.join(TESTS, 'helpers', 'bin', 'npm');
const FIXTURES = path.join(TESTS, 'fixtures', 'npm-audit');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-fake-npm-'));

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// Runs the fake like npm-audit-client does (execFileSync through PATH), with output as Buffers
function npm(args, responses, cwd = tmpDir) {
  const r = spawnSync(FAKE, args, {
    cwd,
    env: { ...process.env, FAKE_NPM_RESPONSES: responses },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr ?? Buffer.alloc(0), error: r.error };
}

// The exit code real npm gives `npm audit --json`: 1 on an error or any vulnerability, else 0
function expectedExit(auditJson) {
  const audit = JSON.parse(auditJson);
  return audit.error || audit.metadata.vulnerabilities.total > 0 ? 1 : 0;
}

const FIXTURE_NAMES = fs.readdirSync(FIXTURES).filter((n) => fs.statSync(path.join(FIXTURES, n)).isDirectory()).sort();
const MODES = [
  { args: ['audit', '--json'], file: 'audit' },
  { args: ['audit', '--json', '--omit=dev'], file: 'audit-omit-dev' },
];
const read = (dir, file) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file)) : null);

function testRecordedExitCodes() {
  // Each recording stores its exit code next to the JSON; it must be the code the rule gives for that JSON
  const wrong = [];
  for (const name of FIXTURE_NAMES) {
    for (const { file } of MODES) {
      const dir = path.join(FIXTURES, name);
      const stored = read(dir, `${file}.exitcode`)?.toString().trim();
      const expected = String(expectedExit(read(dir, `${file}.json`)));
      if (stored !== expected) wrong.push(`${name}/${file}.exitcode: ${stored ?? 'missing'}, expected ${expected}`);
    }
  }
  return report(`every recording's exit code matches npm's rule (${FIXTURE_NAMES.length} fixtures × ${MODES.length})`,
    wrong.length === 0 && FIXTURE_NAMES.length > 0, wrong.join('; '));
}

function testReplaysEachRecording() {
  const wrong = [];
  for (const name of FIXTURE_NAMES) {
    const dir = path.join(FIXTURES, name);
    for (const { args, file } of MODES) {
      const r = npm(args, dir);
      const stdout = read(dir, `${file}.json`);
      const stderr = read(dir, 'audit.stderr') ?? Buffer.alloc(0);
      const code = expectedExit(stdout);
      if (!r.stdout.equals(stdout)) wrong.push(`${name} ${args.join(' ')}: stdout differs (${r.stdout.length} vs ${stdout.length} bytes)`);
      if (!r.stderr.equals(stderr)) wrong.push(`${name} ${args.join(' ')}: stderr ${JSON.stringify(r.stderr.toString())}`);
      if (r.code !== code) wrong.push(`${name} ${args.join(' ')}: exit ${r.code}, expected ${code}`);
    }
  }
  return report('audit --json [--omit=dev] replays stdout, stderr and exit code for every recording', wrong.length === 0,
    wrong.join('; '));
}

function testFlagOrder() {
  // npm-audit-client puts --omit=dev last today; the fake matches flags anywhere, like npm
  const dir = path.join(FIXTURES, 'node-serialize-0.0.4');
  const r = npm(['audit', '--omit=dev', '--json'], dir);
  return report('audit --omit=dev --json (flags in another order) replays the omit-dev recording',
    r.code === 1 && r.stdout.equals(read(dir, 'audit-omit-dev.json')), `exit ${r.code}`);
}

function testLargeOutputArrivesWhole() {
  // The node fake wrote stdout then called process.exit(): on macOS, pipes are async and output past 64 KB was cut
  const dir = fs.mkdtempSync(path.join(tmpDir, 'large-'));
  const pad = 'x'.repeat(1024 * 1024);
  const json = JSON.stringify({ pad, metadata: { vulnerabilities: { total: 0 } } });
  fs.writeFileSync(path.join(dir, 'audit.json'), json);
  fs.writeFileSync(path.join(dir, 'audit.exitcode'), '0\n');
  const r = npm(['audit', '--json'], dir);
  return report('1 MB of recorded stdout arrives whole', r.code === 0 && r.stdout.length === Buffer.byteLength(json),
    `exit ${r.code}, ${r.stdout.length} of ${Buffer.byteLength(json)} bytes`);
}

function testInstallWritesRecordedLockfile() {
  const dir = path.join(FIXTURES, 'node-serialize-0.0.4');
  const cwd = fs.mkdtempSync(path.join(tmpDir, 'install-'));
  const r = npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], dir, cwd);
  const written = read(cwd, 'package-lock.json');
  return report('install --package-lock-only writes the recorded lockfile into the cwd and exits 0',
    r.code === 0 && written !== null && written.equals(read(dir, 'package-lock.fixture.json')), `exit ${r.code}`);
}

function testUnexpectedCallsFail() {
  // Anything not recorded must fail, so a scanner change that calls npm differently can't pass on a guess
  const dir = path.join(FIXTURES, 'ms-2.1.3');
  const calls = [['ls'], ['audit'], ['install'], ['install', 'ms'], []];
  const wrong = calls.filter((args) => {
    const r = npm(args, dir);
    return !(r.code === 1 && r.stdout.length === 0
      && r.stderr.toString() === `npm error fake npm: unexpected call: npm ${args.join(' ')}\n`);
  });
  return report('unrecorded calls (ls, audit without --json, a real install, no arguments) exit 1 with the message',
    wrong.length === 0, JSON.stringify(wrong));
}

function testMissingRecordingFails() {
  const empty = fs.mkdtempSync(path.join(tmpDir, 'empty-'));
  const r = npm(['audit', '--json'], empty);
  return report('a missing recording fails (non-zero exit, no stdout)', r.code !== 0 && r.code !== null && r.stdout.length === 0,
    `exit ${r.code}, ${r.stdout.length} bytes`);
}

const results = [];
try {
  for (const test of [testRecordedExitCodes, testReplaysEachRecording, testFlagOrder, testLargeOutputArrivesWhole,
    testInstallWritesRecordedLockfile, testUnexpectedCallsFail, testMissingRecordingFails]) {
    results.push(test());
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
