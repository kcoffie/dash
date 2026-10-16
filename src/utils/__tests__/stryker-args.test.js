import { strykerArgsError } from '../stryker-args.js';

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

const results = [
  testNoArgsOk(),
  testConcurrencyOk(),
  testOtherOptionsFail(),
  testOtherConcurrencyFormsFail(),
  testBadConcurrencyValuesFail(),
  testMessage(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
