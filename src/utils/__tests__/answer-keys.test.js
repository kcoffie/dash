import { compareToKey, validateKey, typesWithFoundEntries } from '../answer-keys.js';

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const finding = (type, file, line, severity) => ({ type, file, line, severity });
const key = (entries, extra = {}) => ({ commit: COMMIT, entries, ...extra });
const found = (type, file, lines, severity, challenges = []) => ({ status: 'found', type, file, lines, severity, challenges, why: 'test' });
const kinds = (result) => result.failures.map((f) => f.kind);

function testFoundEntryInRangeAtSeverityPasses() {
  const result = compareToKey(key([found('sql-injection', 'app.js', [10, 11], 'critical', ['SQLi'])]), {
    findings: [finding('sql-injection', 'app.js', 11, 'critical')],
  });
  return report('Found entry reported in range at its severity → pass, challenge recalled',
    result.failures.length === 0 && result.recall.SQLi === true, JSON.stringify(result));
}

function testMissingFoundEntryFails() {
  const result = compareToKey(key([found('xss', 'a.ejs', [20, 20], 'medium', ['Reflected'])]), { findings: [] });
  return report('Found entry not reported anywhere in its file → missing, challenge not recalled',
    JSON.stringify(kinds(result)) === '["missing"]' && result.recall.Reflected === false, JSON.stringify(result));
}

function testMovedIsSeparateFromMissing() {
  const result = compareToKey(key([found('xss', 'a.ejs', [20, 20], 'medium')]), {
    findings: [finding('xss', 'a.ejs', 25, 'medium')],
  });
  return report('Same type reported elsewhere in the file → moved (not missing), names the line',
    JSON.stringify(kinds(result)) === '["moved"]' && result.failures[0].message.includes('25'), JSON.stringify(result));
}

function testSiblingSiteIsNotAMove() {
  // DVNA stored XSS: products.ejs:49-53 are separate sites; losing :51 is missing, not moved
  const result = compareToKey(key([found('xss', 'p.ejs', [50, 50], 'medium'), found('xss', 'p.ejs', [51, 51], 'medium')]), {
    findings: [finding('xss', 'p.ejs', 50, 'medium')],
  });
  return report('A lost site whose file still has other keyed sites → missing (a keyed sibling is not a move)',
    JSON.stringify(kinds(result)) === '["missing"]', JSON.stringify(result));
}

function testWrongSeverityFails() {
  const result = compareToKey(key([found('crypto-misuse', 'auth.js', [49, 49], 'high')]), {
    findings: [finding('crypto-misuse', 'auth.js', 49, 'medium')],
  });
  return report('Found entry at a different severity → wrong severity',
    JSON.stringify(kinds(result)) === '["wrong severity"]', JSON.stringify(result));
}

function testTypeMustMatch() {
  // routes/search.ts:47 in Juice Shop is an async finding but must not be a SQLi one
  const result = compareToKey(key([
    { status: 'not flagged', type: 'sql-injection', file: 'search.ts', lines: [47, 47], why: 'test' },
    found('async-footgun', 'search.ts', [47, 47], 'medium'),
  ]), { findings: [finding('async-footgun', 'search.ts', 47, 'medium')] });
  return report('Entries match on type: an async finding on a not-flagged-for-SQLi line → pass',
    result.failures.length === 0, JSON.stringify(result));
}

function testNotFlaggedAppearsFails() {
  const result = compareToKey(key([{ status: 'not flagged', type: 'xss', pattern: { endsWith: '_correct.ts' }, why: 'test' }]), {
    findings: [finding('xss', 'codefixes/x_correct.ts', 3, 'low'), finding('xss', 'codefixes/x_1.ts', 3, 'low')],
  });
  return report('Finding in a not-flagged file pattern → not flagged appears (other files ignored)',
    JSON.stringify(kinds(result)) === '["not flagged appears"]', JSON.stringify(result));
}

function testKnownMissFoundFails() {
  const result = compareToKey(key([{ status: 'known miss', type: 'xss', file: 'userProfile.ts', lines: [73, 73], why: 'test' }]), {
    findings: [finding('xss', 'userProfile.ts', 73, 'medium')],
  });
  return report('Known miss now reported → known miss found, asks to update the key',
    JSON.stringify(kinds(result)) === '["known miss found"]' && result.failures[0].message.includes('update the answer key'), JSON.stringify(result));
}

function testScannerErrorsFail() {
  const result = compareToKey(key([]), { findings: [], errors: ['Insecure crypto scanning failed: boom'] });
  return report('Any scanner error → fail (a crashed scan must not read as clean)',
    JSON.stringify(kinds(result)) === '["scanner error"]', JSON.stringify(result));
}

function testUnkeyedHighInProductionFails() {
  const result = compareToKey(key([found('hardcoded-secret', 'server.js', [24, 24], 'high')], { nonProduction: [{ startsWith: 'test/' }] }), {
    findings: [
      finding('hardcoded-secret', 'server.js', 24, 'high'),
      finding('crypto-misuse', 'lib/new.js', 5, 'critical'),
      finding('xss', 'test/x.js', 5, 'high'),
      finding('xss', 'lib/ok.js', 9, 'medium'),
      finding('dependency-cve', 'package.json', null, 'critical'),
    ],
  });
  const unkeyed = result.failures.filter((f) => f.kind === 'unkeyed high');
  return report('Unkeyed high/critical in production code → fail; keyed, medium, non-production and dependency findings don\'t count here',
    unkeyed.length === 1 && unkeyed[0].message.startsWith('lib/new.js:5'), JSON.stringify(result));
}

function testNonProductionCappedAtLowExceptSecrets() {
  const result = compareToKey(key([], { nonProduction: [{ startsWith: 'test/' }] }), {
    findings: [
      finding('xss', 'test/a.js', 1, 'medium'),
      finding('xss', 'test/b.js', 1, 'low'),
      finding('hardcoded-secret', 'test/c.js', 1, 'critical'),
    ],
  });
  const capped = result.failures.filter((f) => f.kind === 'non-production above low');
  return report('Non-production finding above low → fail, except secrets (provider formats keep their severity anywhere)',
    capped.length === 1 && capped[0].message.startsWith('test/a.js:1'), JSON.stringify(result));
}

function testSpecRules() {
  const result = compareToKey(key([], { rules: { noFindingsOfType: ['sql-injection'], maxSeverity: 'low' } }), {
    findings: [finding('sql-injection', 'test/q.js', 3, 'low'), finding('xss', 'examples/x.js', 1, 'medium')],
  });
  const msgs = result.failures.filter((f) => f.kind === 'spec rule').map((f) => f.message);
  return report('Spec rules: a type the spec says has none, or a finding above the max severity → fail',
    msgs.length === 2 && msgs[0].includes('sql-injection') && msgs[1].includes('above low'), JSON.stringify(result));
}

function testValidateKey() {
  const good = key([found('xss', 'a.ejs', [1, 2], 'medium')]);
  const bad = {
    commit: '1618a61',
    nonProduction: [{}],
    entries: [
      { status: 'found', type: 'xss', file: 'a.ejs', lines: [1, 2], why: 'x' },
      { status: 'fixed', type: 'xss', file: 'a.ejs', why: 'x' },
      { status: 'not flagged', type: 'sqli', pattern: {}, why: 'x' },
      { status: 'reviewed', type: 'xss', file: 'a.ejs', lines: [5, 3], severity: 'low', why: 'x' },
      { status: 'not flagged', type: 'xss', file: 'a.ejs', pattern: { endsWith: '.ts' } },
      { status: 'found', type: 'xss', pattern: { endsWith: '.ejs' }, severity: 'low', why: 'x' },
    ],
  };
  const problems = validateKey(bad).join('\n');
  const expected = ['full 40-character SHA', 'nonProduction pattern', 'entry 0: found needs a severity', 'entry 1: unknown status',
    'entry 2: unknown type', 'entry 2: pattern needs', 'entry 3: lines must be', 'entry 3: reviewed needs a reason',
    'entry 4: needs exactly one of file or pattern', 'entry 4: why is required', 'entry 5: found needs a file and lines'];
  const missing = expected.filter((e) => !problems.includes(e));
  return report('Key validation catches short commits, unknown status/type, bad ranges, missing why/severity/reason/file',
    validateKey(good).length === 0 && missing.length === 0, JSON.stringify({ missing, problems }));
}

function testUnkeyedHighCountsNotJustCritical() {
  const result = compareToKey(key([]), { findings: [finding('xss', 'lib/a.js', 1, 'high')] });
  return report('An unkeyed high (not only critical) in production code → fail',
    JSON.stringify(kinds(result)) === '["unkeyed high"]', JSON.stringify(result));
}

function testChallengeNeedsEverySiteAtSeverity() {
  const result = compareToKey(key([found('xss', 'p.ejs', [49, 53], 'medium', ['Stored'])]), {
    findings: [finding('xss', 'p.ejs', 49, 'medium'), finding('xss', 'p.ejs', 50, 'low')],
  });
  return report('A challenge with one site at the wrong severity is not recalled',
    result.recall.Stored === false && JSON.stringify(kinds(result)) === '["wrong severity"]', JSON.stringify(result));
}

function testOtherTypeInFileIsNotAMove() {
  const result = compareToKey(key([found('xss', 'a.js', [5, 5], 'medium')]), {
    findings: [finding('async-footgun', 'a.js', 9, 'medium'), finding('xss', 'b.js', 5, 'medium')],
  });
  return report('A different type in the same file, or the same type in another file, is not a move → missing',
    JSON.stringify(kinds(result)) === '["missing"]', JSON.stringify(result));
}

function testValidateKeyEdges() {
  const good = key([
    found('xss', 'a.ejs', [1, 1], 'low'),
    { status: 'known miss', type: 'xss', file: 'b.ts', lines: [73, 73], why: 'x' },
  ]);
  const cases = {
    'commit with a prefix': { commit: `x${COMMIT}`, entries: [] },
    'commit with a suffix': { commit: `${COMMIT}0`, entries: [] },
    'neither file nor pattern': key([{ status: 'not flagged', type: 'xss', why: 'x' }]),
    'line 0': key([{ status: 'not flagged', type: 'xss', file: 'a', lines: [0, 3], why: 'x' }]),
    'non-integer start': key([{ status: 'not flagged', type: 'xss', file: 'a', lines: ['1', 3], why: 'x' }]),
    'non-integer end': key([{ status: 'not flagged', type: 'xss', file: 'a', lines: [1, 2.5], why: 'x' }]),
    'found without lines': key([{ status: 'found', type: 'xss', file: 'a', severity: 'low', why: 'x' }]),
    'reviewed without lines': key([{ status: 'reviewed', type: 'xss', file: 'a', severity: 'low', reason: 'r', why: 'x' }]),
    'found by pattern': key([{ status: 'found', type: 'xss', pattern: { endsWith: '.ejs' }, lines: [1, 1], severity: 'low', why: 'x' }]),
  };
  const passedBad = Object.entries(cases).filter(([, k]) => validateKey(k).length === 0).map(([name]) => name);
  return report('Key validation: full-match commit, file or pattern required, integer lines from 1, found/reviewed need lines; known miss and low are valid',
    validateKey(good).length === 0 && passedBad.length === 0, JSON.stringify({ good: validateKey(good), passedBad }));
}

function testReviewedEntries() {
  const reviewed = { status: 'reviewed', type: 'xss', file: 'f.ejs', lines: [7, 7], severity: 'medium', reason: 'r', why: 'w', challenges: ['Not a challenge'] };
  const result = compareToKey(key([reviewed, found('xss', 'f.ejs', [20, 20], 'medium')]), {
    findings: [finding('xss', 'f.ejs', 7, 'medium')],
  });
  return report('Reviewed entries: their finding is claimed (the lost found entry is missing, not moved) and they never count as challenge recall',
    JSON.stringify(kinds(result)) === '["missing"]' && !('Not a challenge' in result.recall), JSON.stringify(result));
}

function testTypesWithFoundEntries() {
  const types = typesWithFoundEntries([
    key([found('xss', 'a', [1, 1], 'low'), { status: 'reviewed', type: 'sql-injection', file: 'b', lines: [1, 1], severity: 'low', reason: 'r', why: 'w' }]),
    key([found('async-footgun', 'c', [1, 1], 'medium')]),
  ]);
  return report('Types with a found entry: reviewed entries don\'t count',
    JSON.stringify(types) === '["xss","async-footgun"]', JSON.stringify(types));
}

const results = [
  testFoundEntryInRangeAtSeverityPasses(),
  testMissingFoundEntryFails(),
  testMovedIsSeparateFromMissing(),
  testSiblingSiteIsNotAMove(),
  testWrongSeverityFails(),
  testTypeMustMatch(),
  testNotFlaggedAppearsFails(),
  testKnownMissFoundFails(),
  testScannerErrorsFail(),
  testUnkeyedHighInProductionFails(),
  testNonProductionCappedAtLowExceptSecrets(),
  testSpecRules(),
  testValidateKey(),
  testUnkeyedHighCountsNotJustCritical(),
  testChallengeNeedsEverySiteAtSeverity(),
  testOtherTypeInFileIsNotAMove(),
  testValidateKeyEdges(),
  testReviewedEntries(),
  testTypesWithFoundEntries(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
