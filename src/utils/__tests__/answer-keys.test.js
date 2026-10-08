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
const only = (result, kind, text) => JSON.stringify(kinds(result)) === JSON.stringify([kind]) && result.failures[0].message.includes(text);
// validateKey on a key with one entry; true when it reports a problem containing `text`
const rejects = (k, text) => validateKey(k).some((p) => p.includes(text));

// --- Comparison ---

function testFoundEntryInRangeAtSeverityPasses() {
  const result = compareToKey(key([found('sql-injection', 'app.js', [10, 11], 'critical', ['SQLi'])]), {
    findings: [finding('sql-injection', 'app.js', 11, 'critical')],
  });
  return report('Found entry reported in range at its severity → pass, challenge recalled',
    result.failures.length === 0 && result.recall.SQLi === true, JSON.stringify(result));
}

function testMissingFoundEntryFails() {
  const result = compareToKey(key([found('xss', 'a.ejs', [20, 20], 'medium', ['Reflected'])]), { findings: [] });
  return report('Found entry not reported → missing, names file:range, type and severity; challenge not recalled',
    only(result, 'missing', 'a.ejs:20-20 xss (medium)') && result.recall.Reflected === false, JSON.stringify(result));
}

function testMovedIsSeparateFromMissing() {
  const result = compareToKey(key([found('xss', 'a.ejs', [20, 20], 'medium')]), {
    findings: [finding('xss', 'a.ejs', 25, 'medium')],
  });
  return report('Same type reported elsewhere in the file → moved (not missing), names the entry and the line',
    only(result, 'moved', 'a.ejs:20-20 xss') && result.failures[0].message.includes('line(s) 25'), JSON.stringify(result));
}

function testSiblingSiteIsNotAMove() {
  // DVNA stored XSS: products.ejs:49-53 are separate sites; losing :51 is missing, not moved
  const result = compareToKey(key([found('xss', 'p.ejs', [50, 50], 'medium'), found('xss', 'p.ejs', [51, 51], 'medium')]), {
    findings: [finding('xss', 'p.ejs', 50, 'medium')],
  });
  return report('A lost site whose file still has other keyed sites → missing (a keyed sibling is not a move)',
    only(result, 'missing', 'p.ejs:51-51'), JSON.stringify(result));
}

function testNotFlaggedFindingStillCountsAsAMove() {
  // Only found/reviewed entries claim a finding; one matched by a not-flagged entry is still "the same type elsewhere in the file"
  const notFlagged = { status: 'not flagged', type: 'xss', file: 'a.ejs', lines: [25, 25], why: 'test' };
  const result = compareToKey(key([found('xss', 'a.ejs', [20, 20], 'medium'), notFlagged]), {
    findings: [finding('xss', 'a.ejs', 25, 'medium')],
  });
  return report('Lost entry whose file has the same type at a not-flagged line → moved (and not-flagged appears), not missing',
    JSON.stringify(kinds(result)) === JSON.stringify(['moved', 'not flagged appears']), JSON.stringify(result));
}

function testFoundEntryWithoutChallengesAddsNoRecall() {
  const entry = found('sql-injection', 'app.js', [3, 3], 'high');
  delete entry.challenges;
  const result = compareToKey(key([entry]), { findings: [finding('sql-injection', 'app.js', 3, 'high')] });
  return report('A found entry with no challenges field passes and adds nothing to recall',
    result.failures.length === 0 && JSON.stringify(result.recall) === '{}', JSON.stringify(result));
}

function testOtherTypeInFileIsNotAMove() {
  const result = compareToKey(key([found('xss', 'a.js', [5, 5], 'medium')]), {
    findings: [finding('async-footgun', 'a.js', 9, 'medium'), finding('xss', 'b.js', 5, 'medium')],
  });
  return report('A different type in the same file, or the same type in another file, is not a move → missing',
    only(result, 'missing', 'a.js:5-5'), JSON.stringify(result));
}

function testWrongSeverityFails() {
  const result = compareToKey(key([found('crypto-misuse', 'auth.js', [49, 49], 'high')]), {
    findings: [finding('crypto-misuse', 'auth.js', 49, 'medium')],
  });
  return report('Found entry at a different severity → wrong severity, names file:line, type, actual and expected',
    only(result, 'wrong severity', 'auth.js:49 crypto-misuse: medium, expected high'), JSON.stringify(result));
}

function testChallengeNeedsEverySiteAtSeverity() {
  const result = compareToKey(key([found('xss', 'p.ejs', [49, 53], 'medium', ['Stored'])]), {
    findings: [finding('xss', 'p.ejs', 49, 'medium'), finding('xss', 'p.ejs', 50, 'low')],
  });
  return report('A challenge with one site at the wrong severity is not recalled',
    result.recall.Stored === false && JSON.stringify(kinds(result)) === '["wrong severity"]', JSON.stringify(result));
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
  return report('Finding in a not-flagged file pattern → not flagged appears, names the finding and the entry (other files ignored)',
    only(result, 'not flagged appears', 'codefixes/x_correct.ts:3 xss') && result.failures[0].message.includes('*_correct.ts'),
    JSON.stringify(result));
}

function testKnownMissFoundFails() {
  const result = compareToKey(key([{ status: 'known miss', type: 'xss', file: 'userProfile.ts', lines: [73, 73], why: 'test' }]), {
    findings: [finding('xss', 'userProfile.ts', 73, 'medium')],
  });
  return report('Known miss now reported → known miss found, asks to update the key',
    only(result, 'known miss found', 'update the answer key'), JSON.stringify(result));
}

function testReviewedEntries() {
  const reviewed = { status: 'reviewed', type: 'xss', file: 'f.ejs', lines: [7, 7], severity: 'medium', reason: 'r', why: 'w', challenges: ['Not a challenge'] };
  const result = compareToKey(key([reviewed, found('xss', 'f.ejs', [20, 20], 'medium')]), {
    findings: [finding('xss', 'f.ejs', 7, 'medium')],
  });
  return report('Reviewed entries: their finding is claimed (the lost found entry is missing, not moved) and they never count as challenge recall',
    JSON.stringify(kinds(result)) === '["missing"]' && !('Not a challenge' in result.recall), JSON.stringify(result));
}

function testScannerErrorsFail() {
  const result = compareToKey(key([]), { findings: [], errors: ['Insecure crypto scanning failed: boom'] });
  return report('Any scanner error → fail (a crashed scan must not read as clean)',
    only(result, 'scanner error', 'Insecure crypto scanning failed'), JSON.stringify(result));
}

function testDependencyFindingsIgnored() {
  const result = compareToKey(key([], { rules: { maxSeverity: 'low' } }), {
    findings: [finding('dependency-cve', 'package.json', null, 'critical')],
  });
  return report('Dependency CVEs are out of scope: ignored by every check, rules included',
    result.failures.length === 0, JSON.stringify(result));
}

// --- Unkeyed loud findings, non-production cap, spec rules ---

function testUnkeyedCriticalInProductionFails() {
  const result = compareToKey(key([]), { findings: [finding('crypto-misuse', 'lib/new.js', 5, 'critical')] });
  return report('An unkeyed critical in production code → unkeyed high', only(result, 'unkeyed high', 'lib/new.js:5 crypto-misuse (critical)'), JSON.stringify(result));
}

function testUnkeyedHighInProductionFails() {
  const result = compareToKey(key([]), { findings: [finding('xss', 'lib/a.js', 1, 'high')] });
  return report('An unkeyed high (not only critical) in production code → unkeyed high', only(result, 'unkeyed high', 'lib/a.js:1'), JSON.stringify(result));
}

function testKeyedOrMediumIsNotUnkeyedHigh() {
  const result = compareToKey(key([found('hardcoded-secret', 'server.js', [24, 24], 'high')]), {
    findings: [finding('hardcoded-secret', 'server.js', 24, 'high'), finding('xss', 'lib/ok.js', 9, 'medium')],
  });
  return report('A keyed high, or an unkeyed medium, is fine', result.failures.length === 0, JSON.stringify(result));
}

function testHighOutsideSecretsInNonProductionIsCapRule() {
  const result = compareToKey(key([], { nonProduction: [{ startsWith: 'test/' }] }), { findings: [finding('xss', 'test/x.js', 5, 'high')] });
  return report('A high XSS in non-production code is the cap rule\'s job, not unkeyed high',
    JSON.stringify(kinds(result)) === '["non-production above low"]', JSON.stringify(result));
}

function testHighSecretInNonProductionNeedsEntry() {
  // DESIGN: generic secret values in test/example files → LOW; only provider formats keep their severity there
  const result = compareToKey(key([], { nonProduction: [{ startsWith: 'test/' }] }), {
    findings: [finding('hardcoded-secret', 'test/c.js', 1, 'critical')],
  });
  return report('A high/critical secret in non-production code with no entry → unkeyed high (provider formats must be keyed)',
    only(result, 'unkeyed high', 'test/c.js:1 hardcoded-secret'), JSON.stringify(result));
}

function testNonProductionCappedAtLowExceptSecrets() {
  const result = compareToKey(key([found('hardcoded-secret', 'test/c.js', [1, 1], 'critical')], { nonProduction: [{ startsWith: 'test/' }] }), {
    findings: [
      finding('xss', 'test/a.js', 1, 'medium'),
      finding('xss', 'test/b.js', 1, 'low'),
      finding('hardcoded-secret', 'test/c.js', 1, 'critical'),
    ],
  });
  return report('Non-production finding above low → fail, except secrets (provider formats keep their severity anywhere)',
    only(result, 'non-production above low', 'test/a.js:1 xss is medium'), JSON.stringify(result));
}

function testNoFindingsOfTypeRule() {
  const result = compareToKey(key([], { rules: { noFindingsOfType: ['sql-injection'] } }), {
    findings: [finding('sql-injection', 'test/q.js', 3, 'low'), finding('xss', 'test/q.js', 3, 'low')],
  });
  return report('Spec rule: a type the spec says has none → fail with the count', only(result, 'spec rule', '1 sql-injection'), JSON.stringify(result));
}

function testMaxSeverityRule() {
  const result = compareToKey(key([], { rules: { maxSeverity: 'low' } }), { findings: [finding('xss', 'examples/x.js', 1, 'medium')] });
  return report('Spec rule: a finding above the max severity → fail, names an example', only(result, 'spec rule', 'above low, e.g. examples/x.js:1'), JSON.stringify(result));
}

// --- Key validation ---

function testValidKeyHasNoProblems() {
  const good = key([
    found('xss', 'a.ejs', [1, 1], 'low', ['A challenge']),
    { status: 'known miss', type: 'xss', file: 'b.ts', lines: [73, 73], why: 'x' },
    { status: 'not flagged', type: 'xss', pattern: { startsWith: 'codefixes/', endsWith: '_correct.ts' }, why: 'x' },
  ], { nonProduction: [{ startsWith: 'test/' }], rules: { noFindingsOfType: ['sql-injection'], maxSeverity: 'low' } });
  return report('A well-formed key (all statuses, patterns, rules) has no problems', validateKey(good).length === 0, JSON.stringify(validateKey(good)));
}

function testCommitMustBeFullSha() {
  const bad = ['1618a61', `x${COMMIT}`, `${COMMIT}0`, undefined].filter((c) => !rejects({ commit: c, entries: [] }, 'full 40-character SHA'));
  return report('Commit must be exactly a 40-character SHA (short, prefixed, suffixed, missing → rejected)', bad.length === 0, JSON.stringify(bad));
}

function testEntriesRequired() {
  return report('A key without an entries list → rejected (not a crash later)', rejects({ commit: COMMIT }, 'entries must be an array'));
}

function testNonArrayEntriesIsOneProblem() {
  const problems = validateKey({ commit: COMMIT, entries: 'x' });
  return report('entries that isn\'t an array → exactly one problem (no per-entry noise)',
    JSON.stringify(problems) === JSON.stringify(['entries must be an array']), JSON.stringify(problems));
}

function testStringPatternsRejected() {
  // A string has .startsWith/.endsWith methods, so a loose check would accept a glob that then matches nothing
  const glob = key([{ status: 'not flagged', type: 'xss', pattern: '**/*_correct.ts', why: 'x' }]);
  const emptyObject = key([{ status: 'not flagged', type: 'xss', pattern: {}, why: 'x' }]);
  const nonString = key([{ status: 'not flagged', type: 'xss', pattern: { endsWith: 5 }, why: 'x' }]);
  const nonProd = key([], { nonProduction: ['test/'] });
  return report('Patterns must be { startsWith, endsWith } with string values: a glob string, {}, or a number → rejected',
    rejects(glob, 'entry 0: pattern must be') && rejects(emptyObject, 'entry 0: pattern must be') && rejects(nonString, 'entry 0: pattern must be')
      && rejects(nonProd, 'nonProduction must be'));
}

function testPatternEdgesRejected() {
  const bad = [null, ['test/'], { startsWith: 'a', foo: 'b' }, { endsWith: '' }]
    .filter((pattern) => !rejects(key([{ status: 'not flagged', type: 'xss', pattern, why: 'x' }]), 'entry 0: pattern must be'));
  return report('Patterns: null, an array, an unknown key, or an empty value → rejected (no crash)', bad.length === 0, JSON.stringify(bad));
}

function testOptionalFieldsMayBeOmitted() {
  return report('A key without nonProduction or rules is valid', validateKey(key([found('xss', 'a', [1, 1], 'low')])).length === 0,
    JSON.stringify(validateKey(key([found('xss', 'a', [1, 1], 'low')]))));
}

function testRulesValidated() {
  return report('Rules: unknown rule name, unknown type, or unknown severity → rejected',
    rejects(key([], { rules: { noFindingsOfTypes: ['xss'] } }), 'unknown rule "noFindingsOfTypes"')
      && rejects(key([], { rules: { noFindingsOfType: ['sqli'] } }), 'noFindingsOfType must list known types')
      && rejects(key([], { rules: { noFindingsOfType: 'xss' } }), 'noFindingsOfType must list known types')
      && rejects(key([], { rules: { noFindingsOfType: ['xss', 'sqli'] } }), 'noFindingsOfType must list known types')
      && rejects(key([], { rules: { maxSeverity: 'none' } }), 'maxSeverity must be a severity'));
}

function testEntryStatusAndType() {
  return report('Entry: unknown status or type → rejected',
    rejects(key([{ status: 'fixed', type: 'xss', file: 'a', why: 'x' }]), 'entry 0: unknown status')
      && rejects(key([{ status: 'not flagged', type: 'sqli', file: 'a', why: 'x' }]), 'entry 0: unknown type'));
}

function testEntryFileOrPattern() {
  return report('Entry: needs exactly one of file or pattern (neither, or both → rejected)',
    rejects(key([{ status: 'not flagged', type: 'xss', why: 'x' }]), 'needs exactly one of file or pattern')
      && rejects(key([{ status: 'not flagged', type: 'xss', file: 'a', pattern: { endsWith: '.ts' }, why: 'x' }]), 'needs exactly one of file or pattern'));
}

function testEntryLines() {
  const lines = [[0, 3], ['1', 3], [1, 2.5], [5, 3]].filter((l) => !rejects(key([{ status: 'not flagged', type: 'xss', file: 'a', lines: l, why: 'x' }]), 'lines must be'));
  return report('Entry: lines must be integers with 1 <= start <= end', lines.length === 0, JSON.stringify(lines));
}

function testEntryChallengesAndWhy() {
  return report('Entry: challenges must be a list of names; why is required',
    rejects(key([{ ...found('xss', 'a', [1, 1], 'low'), challenges: 'Stored' }]), 'challenges must be a list')
      && rejects(key([{ ...found('xss', 'a', [1, 1], 'low'), challenges: ['Stored', 5] }]), 'challenges must be a list')
      && rejects(key([{ status: 'not flagged', type: 'xss', file: 'a' }]), 'why is required'));
}

function testFoundAndReviewedNeedSeverityFileLines() {
  return report('Found/reviewed: need a severity, an exact file and lines; reviewed needs a reason',
    rejects(key([{ status: 'found', type: 'xss', file: 'a', lines: [1, 1], why: 'x' }]), 'found needs a severity')
      && rejects(key([{ status: 'found', type: 'xss', file: 'a', severity: 'low', why: 'x' }]), 'found needs a file and lines')
      && rejects(key([{ status: 'found', type: 'xss', pattern: { endsWith: '.ejs' }, lines: [1, 1], severity: 'low', why: 'x' }]), 'found needs a file and lines')
      && rejects(key([{ status: 'reviewed', type: 'xss', file: 'a', severity: 'low', reason: 'r', why: 'x' }]), 'reviewed needs a file and lines')
      && rejects(key([{ status: 'reviewed', type: 'xss', file: 'a', lines: [1, 1], severity: 'low', why: 'x' }]), 'reviewed needs a reason'));
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
  testNotFlaggedFindingStillCountsAsAMove(),
  testFoundEntryWithoutChallengesAddsNoRecall(),
  testOtherTypeInFileIsNotAMove(),
  testWrongSeverityFails(),
  testChallengeNeedsEverySiteAtSeverity(),
  testTypeMustMatch(),
  testNotFlaggedAppearsFails(),
  testKnownMissFoundFails(),
  testReviewedEntries(),
  testScannerErrorsFail(),
  testDependencyFindingsIgnored(),
  testUnkeyedCriticalInProductionFails(),
  testUnkeyedHighInProductionFails(),
  testKeyedOrMediumIsNotUnkeyedHigh(),
  testHighOutsideSecretsInNonProductionIsCapRule(),
  testHighSecretInNonProductionNeedsEntry(),
  testNonProductionCappedAtLowExceptSecrets(),
  testNoFindingsOfTypeRule(),
  testMaxSeverityRule(),
  testValidKeyHasNoProblems(),
  testCommitMustBeFullSha(),
  testEntriesRequired(),
  testNonArrayEntriesIsOneProblem(),
  testStringPatternsRejected(),
  testPatternEdgesRejected(),
  testOptionalFieldsMayBeOmitted(),
  testRulesValidated(),
  testEntryStatusAndType(),
  testEntryFileOrPattern(),
  testEntryLines(),
  testEntryChallengesAndWhy(),
  testFoundAndReviewedNeedSeverityFileLines(),
  testTypesWithFoundEntries(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
