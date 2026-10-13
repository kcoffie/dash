import { ratchetDecision } from '../ratchet-check.js';

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// baseText: `git show <ref>:stryker.config.json` output, or null when git failed. headText: the PR's file, or null.
const REF = 'origin/main';
const config = (brk) => JSON.stringify({ thresholds: { high: 80, low: 65, break: brk } });
const decide = (baseText, headText, ref = REF) => ratchetDecision({ ref, baseText, headText });
const show = (d) => JSON.stringify(d);

// --- Today's comparison ---

function testEqualPasses() {
  const d = decide(config(60), config(60));
  return report('base 60, head 60 → ok, logs both values', d.ok === true && d.base === 60 && d.head === 60 && d.message === 'break: base 60, this PR 60', show(d));
}

function testRaisedPasses() {
  const d = decide(config(60), config(70));
  return report('base 60, head 70 → ok', d.ok === true && d.message === 'break: base 60, this PR 70', show(d));
}

function testLoweredFails() {
  const d = decide(config(60), config(59.99));
  return report('base 60, head 59.99 → fails, says lowered (60 -> 59.99)',
    d.ok === false && d.message === 'thresholds.break was lowered (60 -> 59.99)', show(d));
}

function testBoundsAccepted() {
  const low = decide(config(0), config(0));
  const high = decide(config(100), config(100));
  return report('0 and 100 are valid values', low.ok === true && high.ok === true, show([low, high]));
}

// --- Base config that can't be used: fail closed (it used to count as break 0) ---

function testBaseUnreadableFails() {
  const d = decide(null, config(10));
  return report('base config unreadable (git failed) → fails, names the ref',
    d.ok === false && d.message.includes('origin/main:stryker.config.json') && d.message.includes('could not be read'), show(d));
}

function testBaseInvalidJsonFails() {
  const d = decide('{"thresholds":', config(10));
  return report('base config not valid JSON → fails, names the base',
    d.ok === false && d.message.startsWith('base ') && d.message.includes('not valid JSON'), show(d));
}

function testBaseBadBreakFails() {
  const cases = [
    JSON.stringify({ thresholds: { high: 80 } }),
    JSON.stringify({}),
    JSON.stringify({ thresholds: null }),
    'null',
    '60',
    config(null), // user decision 2026-10-13: a base with the gate off fails closed too
    config('60'),
    config(-1),
    config(101),
    config(true),
  ];
  const ds = cases.map((text) => decide(text, config(10)));
  return report('base break missing, null, a string, a boolean or outside 0–100 (or no thresholds object) → fails, names the base',
    ds.every((d) => d.ok === false && d.message.startsWith('base ') && d.message.includes('not a number from 0 to 100')), show(ds));
}

function testBaseBadBreakShowsValue() {
  const d = decide(config(null), config(60));
  return report('the message shows the bad value as JSON', d.message === 'base thresholds.break is null, not a number from 0 to 100', show(d));
}

function testBaseMissingBreakShowsMissing() {
  const d = decide(JSON.stringify({ thresholds: {} }), config(60));
  return report('a missing break is shown as "missing"', d.message === 'base thresholds.break is missing, not a number from 0 to 100', show(d));
}

// --- Head config: same checks, named as the PR's ---

function testHeadUnreadableFails() {
  const d = decide(config(60), null);
  return report('head config unreadable → fails, names the PR\'s file',
    d.ok === false && d.message === 'this PR\'s stryker.config.json could not be read', show(d));
}

function testHeadInvalidJsonFails() {
  const d = decide(config(60), '{"thresholds":');
  return report('head config not valid JSON → fails, names the PR',
    d.ok === false && d.message === 'this PR\'s stryker.config.json is not valid JSON', show(d));
}

function testHeadBadBreakFails() {
  const ds = [JSON.stringify({ thresholds: {} }), config(null), config('60'), config(101), config(-0.5)].map((text) => decide(config(0), text));
  return report('head break missing, null, a string or outside 0–100 → fails even against base 0, names the PR',
    ds.every((d) => d.ok === false && d.message.startsWith('this PR\'s thresholds.break is')), show(ds));
}

// --- The ref never reaches git as an option ---

function testOptionLikeRefFails() {
  const ds = ['', '-p', '--output=x'].map((ref) => decide(config(60), config(60), ref));
  return report('empty ref or one starting with "-" → fails', ds.every((d) => d.ok === false && d.message.includes('not a usable base ref')), show(ds));
}

const results = [
  testEqualPasses(),
  testRaisedPasses(),
  testLoweredFails(),
  testBoundsAccepted(),
  testBaseUnreadableFails(),
  testBaseInvalidJsonFails(),
  testBaseBadBreakFails(),
  testBaseBadBreakShowsValue(),
  testBaseMissingBreakShowsMissing(),
  testHeadUnreadableFails(),
  testHeadInvalidJsonFails(),
  testHeadBadBreakFails(),
  testOptionLikeRefFails(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
