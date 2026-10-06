// Puts a stand-in `npm` (./bin/npm) first on PATH, so tests exercise the real dependency
// scanner without the registry. It replays `npm audit --json [--omit=dev]` as recorded from
// real npm (stdout, stderr, exit code), and fails anything else. Only the boundary is faked:
// npm-audit-client still runs.
//
// Recorded responses live in fixtures/npm-audit/<name>/ (recorded with npm 11.19.1 on
// 2026-10-06; registry-down = `--registry=http://127.0.0.1:9`, home path in the log line
// replaced). The fixture's package.json / package-lock.json are stored as *.fixture.json
// so GitHub's dependency graph doesn't raise alerts for the vulnerable test package.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, 'bin');
const FIXTURES = path.join(HERE, '..', 'fixtures', 'npm-audit');

// Copies the recorded project (package.json + lockfile) into targetPath
export function writeRecordedProject(name, targetPath) {
  const dir = path.join(FIXTURES, name);
  fs.copyFileSync(path.join(dir, 'package.fixture.json'), path.join(targetPath, 'package.json'));
  fs.copyFileSync(path.join(dir, 'package-lock.fixture.json'), path.join(targetPath, 'package-lock.json'));
}

// Runs fn with the fake npm first on PATH, replaying fixtures/npm-audit/<name>/
export async function withFakeNpm(name, fn) {
  const saved = { PATH: process.env.PATH, FAKE_NPM_RESPONSES: process.env.FAKE_NPM_RESPONSES };
  process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH}`;
  process.env.FAKE_NPM_RESPONSES = path.join(FIXTURES, name);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
