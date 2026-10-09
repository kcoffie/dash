#!/usr/bin/env node
/**
 * Stryker's test command (`npm run test:src`): runs every src/**\/__tests__/*.test.js in ONE Node process, one file
 * at a time. `npm test` still uses `node --test` (a process per file); this exists because Stryker runs the suite
 * once per mutant and CI is CPU-bound: 16 processes cost 3.34 s CPU per run, one process 1.17 s (measured 2026-10-09).
 *
 * A file passes or fails exactly as it would as its own process (scripts/__tests__/run-tests.test.js):
 * - it calls process.exit(code): code, or process.exitCode when called without one (also after the import has
 *   resolved: five test files start runTests() without awaiting it)
 * - it never calls process.exit: process.exitCode (0 when unset) once its work has drained ('beforeExit')
 * - it throws while loading, or leaves an unhandled rejection: fails
 * Stops at the first failing file: Stryker only needs pass/fail. process.exitCode is reset between files.
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
    const drained = () => finish(process.exitCode ?? 0);
    process.exit = (code) => finish(code ?? process.exitCode ?? 0);
    process.once('beforeExit', drained);
    import(pathToFileURL(path.resolve(file)).href).catch((error) => {
      console.error(error);
      finish(1);
    });
  });
}

for (const file of files) {
  process.exitCode = undefined;
  const code = await runFile(file);
  if (Number(code) !== 0) {
    console.error(`run-tests: ${file} failed (exit ${code})`);
    realExit(1);
  }
}
process.exitCode = undefined;
realExit(0);
