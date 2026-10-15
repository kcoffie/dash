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

// User decision 2026-10-13: Stryker reads break: null as "gate off"; on the base it fails closed, so turning the
// ratchet off takes a deliberate workflow change
function testBaseNullBreakFailsClosed() {
  const d = decide(config(null), config(0));
  return report('base break null → fails, even when the PR\'s break is 0', d.ok === false && d.message.startsWith('base thresholds.break is null'), show(d));
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

function testNonStringRefFails() {
  const ds = [undefined, null, 42].map((ref) => {
    try {
      // Not through decide(): its default parameter would turn undefined into REF
      return ratchetDecision({ ref, baseText: config(60), headText: config(60) });
    } catch (error) {
      return { threw: error.message };
    }
  });
  return report('ref undefined, null or a number → fails (no crash)', ds.every((d) => d.ok === false && d.message.includes('not a usable base ref')), show(ds));
}

// --- Other keys: only output keys and thresholds may change (user decision 2026-10-15) ---

// The repo's config today, as the base; each test changes a copy for the PR
const BASE = {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  testRunner: 'command',
  commandRunner: { command: 'node scripts/run-tests.js' },
  mutate: ['src/scanner/**/*.js', 'src/utils/**/*.js', '!src/**/__tests__/**', '!src/scanner/index.js'],
  ignorePatterns: ['/targets'],
  reporters: ['clear-text', 'progress-append-only', 'html', 'json'],
  htmlReporter: { fileName: 'out/mutation.html' },
  jsonReporter: { fileName: 'out/mutation.json' },
  concurrency: 8,
  timeoutMS: 20000,
  thresholds: { high: 80, low: 65, break: 60 },
};
const pr = (edit) => {
  const head = structuredClone(BASE);
  edit(head);
  return JSON.stringify(head);
};
const decideBase = (headText) => decide(JSON.stringify(BASE), headText);
const notChangeable = (d, keys) => d.ok === false
  && d.message.startsWith(`this PR changes stryker.config.json key(s) a PR may not change: ${keys}`);

// Reproduced 2026-10-15 (real Stryker 10.0.0): the PR's dryRunOnly: true passed this step and mutate:changed with no mutants
function testAddedKeyFails() {
  const ds = [true, false, null].map((value) => decideBase(pr((c) => { c.dryRunOnly = value; })));
  return report('PR adds dryRunOnly (true, false or null) → fails, names dryRunOnly', ds.every((d) => notChangeable(d, 'dryRunOnly (')), show(ds));
}

function testNestedKeyFails() {
  const d = decideBase(pr((c) => { c.mutator = { excludedMutations: ['StringLiteral'] }; c.commandRunner.command = 'true'; }));
  return report('PR adds mutator.excludedMutations and changes commandRunner.command → fails, names both paths, sorted',
    notChangeable(d, 'commandRunner.command, mutator ('), show(d));
}

function testNestedKeyInsideAddedObjectNamed() {
  const base = { ...BASE, mutator: { plugins: [] } };
  const d = decide(JSON.stringify(base), JSON.stringify({ ...base, mutator: { plugins: [], excludedMutations: ['StringLiteral'] } }));
  return report('a key added inside an object both sides have is named by its full path', notChangeable(d, 'mutator.excludedMutations ('), show(d));
}

function testRemovedKeyFails() {
  const d = decideBase(pr((c) => { delete c.ignorePatterns; delete c.timeoutMS; }));
  return report('PR removes ignorePatterns and timeoutMS → fails, names both', notChangeable(d, 'ignorePatterns, timeoutMS ('), show(d));
}

function testArrayChangeFails() {
  const ds = [
    pr((c) => { c.mutate.pop(); }),
    pr((c) => { c.mutate.reverse(); }),
    pr((c) => { c.mutate = c.mutate.join(','); }),
  ].map(decideBase);
  return report('PR shortens, reorders or replaces the mutate array → fails, names mutate', ds.every((d) => notChangeable(d, 'mutate (')), show(ds));
}

function testTypeChangeFails() {
  const ds = [pr((c) => { c.commandRunner = 'node scripts/run-tests.js'; }), pr((c) => { c.timeoutMS = '20000'; })].map(decideBase);
  return report('PR turns an object into a string, or a number into a string → fails, names the key',
    notChangeable(ds[0], 'commandRunner (') && notChangeable(ds[1], 'timeoutMS ('), show(ds));
}

function testThresholdsExtraKeyFails() {
  const d = decideBase(pr((c) => { c.thresholds.extra = 1; }));
  return report('PR adds thresholds.extra → fails (only high, low and break may change)', notChangeable(d, 'thresholds.extra ('), show(d));
}

// A key is matched as a list of names, not a dotted string: a literal "thresholds.high" key isn't thresholds.high
function testDottedKeyNotAllowed() {
  const d = decideBase(pr((c) => { c['thresholds.high'] = 1; c['htmlReporter.fileName'] = 'x'; }));
  return report('PR adds literal keys "thresholds.high" / "htmlReporter.fileName" → fails, shown quoted',
    notChangeable(d, '"htmlReporter.fileName", "thresholds.high" ('), show(d));
}

// JSON.parse makes "__proto__" an own key; read through the prototype, the base's value would be Object.prototype
function testProtoKeyFails() {
  const d = decideBase(JSON.stringify(BASE).replace(/^\{/, '{"__proto__":{"dryRunOnly":true},'));
  return report('PR adds a "__proto__" key → fails, names __proto__', notChangeable(d, '__proto__ ('), show(d));
}

function testMessageSaysHowToWiden() {
  const d = decideBase(pr((c) => { c.dryRunOnly = true; }));
  return report('the message lists the keys that may change and where to widen the list',
    d.message === 'this PR changes stryker.config.json key(s) a PR may not change: dryRunOnly (only $schema, concurrency, reporters, '
      + 'htmlReporter, jsonReporter, clearTextReporter, thresholds.high, thresholds.low and thresholds.break may; '
      + 'to change another, add it to CHANGEABLE in src/utils/ratchet-check.js in this PR, where the diff shows it)', show(d));
}

function testLoweredWinsOverKeys() {
  const d = decideBase(pr((c) => { c.thresholds.break = 50; c.dryRunOnly = true; }));
  return report('break lowered and another key changed → fails with "lowered"', d.ok === false && d.message === 'thresholds.break was lowered (60 -> 50)', show(d));
}

function testChangeableKeysPass() {
  const d = decideBase(pr((c) => {
    c.$schema = 'x.json';
    c.concurrency = 2;
    c.reporters = ['html'];
    c.htmlReporter.fileName = 'out/x.html';
    c.jsonReporter = { fileName: 'out/x.json' };
    c.clearTextReporter = { allowColor: false };
    c.thresholds = { high: 90, low: 70, break: 61 };
  }));
  return report('PR changes only $schema, concurrency, reporters, htmlReporter, jsonReporter, clearTextReporter and thresholds (break up) → ok',
    d.ok === true && d.message === 'break: base 60, this PR 61', show(d));
}

function testChangeableKeysRemovedPass() {
  const d = decideBase(pr((c) => { delete c.$schema; delete c.concurrency; delete c.htmlReporter; delete c.thresholds.high; delete c.thresholds.low; }));
  return report('PR removes changeable keys → ok', d.ok === true, show(d));
}

function testKeyOrderAndSpacingIgnored() {
  const reordered = Object.fromEntries(Object.entries(BASE).reverse());
  reordered.thresholds = { break: 60, low: 65, high: 80 };
  const d = decide(JSON.stringify(BASE), JSON.stringify(reordered, null, 4));
  return report('same keys and values in another order, indented differently → ok', d.ok === true, show(d));
}

const results = [
  testAddedKeyFails(),
  testNestedKeyFails(),
  testNestedKeyInsideAddedObjectNamed(),
  testRemovedKeyFails(),
  testArrayChangeFails(),
  testTypeChangeFails(),
  testThresholdsExtraKeyFails(),
  testDottedKeyNotAllowed(),
  testProtoKeyFails(),
  testMessageSaysHowToWiden(),
  testLoweredWinsOverKeys(),
  testChangeableKeysPass(),
  testChangeableKeysRemovedPass(),
  testKeyOrderAndSpacingIgnored(),
  testEqualPasses(),
  testRaisedPasses(),
  testLoweredFails(),
  testBoundsAccepted(),
  testBaseUnreadableFails(),
  testBaseInvalidJsonFails(),
  testBaseBadBreakFails(),
  testBaseNullBreakFailsClosed(),
  testBaseBadBreakShowsValue(),
  testBaseMissingBreakShowsMissing(),
  testHeadUnreadableFails(),
  testHeadInvalidJsonFails(),
  testHeadBadBreakFails(),
  testOptionLikeRefFails(),
  testNonStringRefFails(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
