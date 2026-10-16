import { execFileSync } from 'child_process';
import { runTestsCommand, strykerArgsError } from '../stryker-args.js';

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const show = (value) => JSON.stringify(value);

function testNoArgsOk() {
  const e = strykerArgsError([]);
  return report('no args → ok (null)', e === null, show(e));
}

function testConcurrencyOk() {
  const es = [['--concurrency', '4'], ['--concurrency', '1'], ['--concurrency', '16']].map(strykerArgsError);
  return report('--concurrency 4, 1 or 16 → ok', es.every((e) => e === null), show(es));
}

// Reproduced 2026-10-15 (real Stryker 10.0.0): mutate:changed main --dryRunOnly tested no mutants and exited 0
function testOtherOptionsFail() {
  const cases = [['--dryRunOnly'], ['--concurrency', '4', '--dryRunOnly'], ['--mutate', 'src/x.js'], ['-m', 'src/x.js'], ['--incremental'], ['--timeoutMS', '1'], ['extra']];
  const es = cases.map(strykerArgsError);
  return report('--dryRunOnly, --mutate, -m, --incremental, --timeoutMS, a bare word, or any of them after --concurrency 4 → error',
    es.every((e) => typeof e === 'string'), show(es));
}

function testOtherConcurrencyFormsFail() {
  const cases = [['--concurrency'], ['--concurrency=4'], ['-c', '4'], ['--concurrency', '4', '--concurrency', '2'], ['4', '--concurrency']];
  const es = cases.map(strykerArgsError);
  return report('--concurrency with no value, --concurrency=4, -c 4, twice, or in the wrong order → error', es.every((e) => typeof e === 'string'), show(es));
}

function testBadConcurrencyValuesFail() {
  const cases = ['0', '-1', '4.5', '04', ' 4', '4 ', '', '1e1', 'x', '--dryRunOnly'].map((n) => ['--concurrency', n]);
  const es = cases.map(strykerArgsError);
  return report('--concurrency 0, -1, 4.5, 04, padded, empty, 1e1, x or an option → error', es.every((e) => typeof e === 'string'), show(es));
}

function testMessage() {
  const e = strykerArgsError(['--concurrency', '4', '--dryRunOnly']);
  return report('the message names what was passed and what is allowed',
    e === 'only "--concurrency <n>" may be passed on to Stryker (other options can weaken the check), got ["--concurrency","4","--dryRunOnly"]', show(e));
}

// runTestsCommand: Stryker's command runner hands the command to /bin/sh (child_process.exec), so the path must reach
// node as one argument, unchanged, whatever it contains
function testCommandPlainPath() {
  const c = runTestsCommand('/gate/scripts/run-tests.js');
  return report('a plain path → node \'<path>\'', c === "node '/gate/scripts/run-tests.js'", show(c));
}

function testCommandQuote() {
  const c = runTestsCommand("/a'b/run-tests.js");
  return report("a single quote in the path is closed, escaped and reopened ('\\'')", c === "node '/a'\\''b/run-tests.js'", show(c));
}

// What /bin/sh passes on as arguments after `node`: `node` replaced by printf printing one argument per line
const shArgs = (command) => execFileSync('/bin/sh', ['-c', command.replace(/^node /, "printf '%s\\n' ")], { encoding: 'utf8' });

function testCommandShellRoundTrip() {
  const paths = ['/g a/run-tests.js', "/g'a/run-tests.js", '/g$HOME/`id`/$(id)/run-tests.js', '/g;true x/*.js', '/g\\a"b/run-tests.js'];
  const got = paths.map((p) => shArgs(runTestsCommand(p)));
  return report('through /bin/sh each path stays one argument, unchanged (spaces, quotes, $, `, $(), ;, *, \\)',
    got.every((out, i) => out === `${paths[i]}\n`), show(got));
}

const results = [
  testNoArgsOk(),
  testConcurrencyOk(),
  testOtherOptionsFail(),
  testOtherConcurrencyFormsFail(),
  testBadConcurrencyValuesFail(),
  testMessage(),
  testCommandPlainPath(),
  testCommandQuote(),
  testCommandShellRoundTrip(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
