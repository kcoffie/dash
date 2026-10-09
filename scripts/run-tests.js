#!/usr/bin/env node
/**
 * Stryker's test command (`npm run test:src`): runs every src/**\/__tests__/*.test.js in ONE Node process, one file
 * at a time. `npm test` still uses `node --test` (a process per file); this exists because Stryker runs the suite
 * once per mutant and CI is CPU-bound: 16 processes cost 3.34 s CPU per run, one process 1.17 s (measured 2026-10-09).
 *
 * A file passes or fails exactly as it would as its own process (scripts/__tests__/run-tests.test.js):
 * - it calls process.exit(code): code, or process.exitCode when called without one (also after the import has
 *   resolved: five test files start runTests() without awaiting it)
 * - it never calls process.exit: process.exitCode (0 when unset) once its work has drained ('beforeExit'); 13 if its
 *   top-level await never settled, as Node exits then
 * - it throws while loading, or leaves an unhandled rejection: fails
 * Stops at the first failing file: Stryker only needs pass/fail. process.exitCode is reset between files.
 *
 * Convention this relies on (all test files follow it): process.exit is a file's last action, and a file leaves no
 * timers running. As its own process, exit would end leftover work; here it would run during the next file, so a
 * file that leaves a timer or immediate pending fails with a message instead of being credited to the next one.
 *
 * Usage: node scripts/run-tests.js [file ...]   (default: src/**\/__tests__/*.test.js under the cwd, sorted)
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const realExit = process.exit.bind(process);
const files = process.argv.length > 2 ? process.argv.slice(2) : fs.globSync('src/**/__tests__/*.test.js').sort();

if (files.length === 0) {
  console.error('run-tests: no test files found');
  realExit(1);
}

// The exit code this file's own process would have ended with
function runFile(file) {
  return new Promise((resolve) => {
    const finish = (code) => {
      process.removeListener('beforeExit', drained);
      resolve(code);
    };
    let loaded = false;
    const drained = () => finish(loaded ? (process.exitCode ?? 0) : 13);
    process.exit = (code) => finish(code ?? process.exitCode ?? 0);
    process.once('beforeExit', drained);
    import(pathToFileURL(path.resolve(file)).href).then(
      () => { loaded = true; },
      (error) => {
        console.error(error);
        finish(1);
      },
    );
  });
}

for (const file of files) {
  process.exitCode = undefined;
  const code = await runFile(file);
  const leftover = process.getActiveResourcesInfo().filter((type) => type === 'Timeout' || type === 'Immediate');
  if (leftover.length > 0) {
    console.error(`run-tests: ${file} left ${leftover.length} timer(s) running after it finished (process.exit must be its last action)`);
    realExit(1);
  }
  if (Number(code) !== 0) {
    console.error(`run-tests: ${file} failed (exit ${code})`);
    realExit(1);
  }
}
process.exitCode = undefined;
realExit(0);
