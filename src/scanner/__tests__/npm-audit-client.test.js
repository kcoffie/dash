import { parseAuditResults, parseAuditJson, lockedVersion, firstPatchedVersion, introducedBy, compareVersions } from '../npm-audit-client.js';

// Shapes copied from real `npm audit --json` output (npm 11): Express's dev tooling
// (mocha → serialize-javascript, diff) and DVNA's direct node-serialize dependency.
const EXPRESS_PACKAGE = { name: 'express', dependencies: { qs: '^6.0.0' }, devDependencies: { mocha: '^10.0.0' } };
const EXPRESS_AUDIT = {
  vulnerabilities: {
    diff: {
      name: 'diff', severity: 'low', isDirect: false, effects: ['mocha'], nodes: ['node_modules/diff'],
      via: [{ source: 1112706, title: 'jsdiff has a Denial of Service vulnerability', url: 'https://github.com/advisories/GHSA-73rr-hh4g-fpgx', severity: 'low', cwe: ['CWE-400'], range: '>=6.0.0 <8.0.3' }],
      fixAvailable: { name: 'mocha', version: '12.0.3', isSemVerMajor: true },
    },
    'serialize-javascript': {
      name: 'serialize-javascript', severity: 'high', isDirect: false, effects: ['mocha'], nodes: ['node_modules/serialize-javascript'],
      via: [{ source: 1113686, title: 'Serialize JavaScript is Vulnerable to RCE', url: 'https://github.com/advisories/GHSA-5c6j-r48x-rmvq', severity: 'high', cwe: ['CWE-96'], range: '<=7.0.2' }],
      fixAvailable: { name: 'mocha', version: '12.0.3', isSemVerMajor: true },
    },
    mocha: {
      name: 'mocha', severity: 'moderate', isDirect: true, effects: [], nodes: ['node_modules/mocha'],
      via: ['diff', 'serialize-javascript'], fixAvailable: { name: 'mocha', version: '12.0.3', isSemVerMajor: true },
    },
  },
};
const EXPRESS_LOCKFILE = {
  lockfileVersion: 3,
  packages: {
    'node_modules/diff': { version: '7.0.0', dev: true },
    'node_modules/serialize-javascript': { version: '6.0.2', dev: true },
    'node_modules/mocha': { version: '10.8.2', dev: true },
  },
};

const DVNA_PACKAGE = { name: 'dvna', dependencies: { 'node-serialize': '0.0.4' } };
const DVNA_AUDIT = {
  vulnerabilities: {
    'node-serialize': {
      name: 'node-serialize', severity: 'critical', isDirect: true, effects: [], nodes: ['node_modules/node-serialize'],
      via: [{ source: 1096544, title: 'Code Execution through IIFE in node-serialize', url: 'https://github.com/advisories/GHSA-q4v7-4rhw-9hqm', severity: 'critical', cwe: ['CWE-94'], range: '>=0.0.0' }],
      fixAvailable: false,
    },
  },
};

const audit = (all, prod, lockfile, lockfileSource = 'package-lock.json') => ({ all, prod, lockfile, lockfileSource, otherLockfile: null });

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

function testDevOnlyTransitive() {
  const findings = parseAuditResults(audit(EXPRESS_AUDIT, { vulnerabilities: {} }, EXPRESS_LOCKFILE), EXPRESS_PACKAGE);
  const serialize = findings.find((f) => f.package === 'serialize-javascript');
  return report(
    'Dev-only transitive advisory: low, version from lockfile, traced to mocha',
    findings.length === 2
      && serialize.severity === 'low'
      && serialize.advisorySeverity === 'high'
      && serialize.devOnly === true
      && serialize.packageVersion === '6.0.2'
      && serialize.context.some((c) => c.startsWith('⚠ Dev-only dependency'))
      && serialize.context.includes('✓ Pulled in by mocha')
      && !JSON.stringify(serialize).includes('undefined'),
    JSON.stringify(serialize, null, 1),
  );
}

function testFixNamesTheRightPackage() {
  // npm's fixAvailable for serialize-javascript is mocha@12.0.3, not serialize-javascript@12.0.3
  const [diff] = parseAuditResults(audit(EXPRESS_AUDIT, { vulnerabilities: {} }, EXPRESS_LOCKFILE), EXPRESS_PACKAGE);
  return report(
    'Fix guidance names the package to upgrade (mocha), with the major-version warning',
    diff.remediation === 'Upgrade mocha to 12.0.3 (major version change: check for breaking changes); it depends on diff, and that version no longer pulls in a vulnerable one. Details: https://github.com/advisories/GHSA-73rr-hh4g-fpgx'
      && diff.context.includes('✓ Fix available: upgrade mocha to 12.0.3 (major version change: check for breaking changes)'),
    diff.remediation,
  );
}

function testRuntimeDirectNoFix() {
  const [finding] = parseAuditResults(audit(DVNA_AUDIT, DVNA_AUDIT, { lockfileVersion: 3, packages: { 'node_modules/node-serialize': { version: '0.0.4' } } }), DVNA_PACKAGE);
  return report(
    'Runtime direct dependency keeps advisory severity; no-fix stated',
    finding.severity === 'critical'
      && finding.devOnly === false
      && finding.context.includes('✓ Direct dependency (dependencies)')
      && finding.context.includes('✓ Installed in production (not dev-only)')
      && finding.context.includes('⚠ No fix available yet')
      && finding.patchedVersions === null,
    JSON.stringify(finding.context),
  );
}

function testUnknownWhenProdAuditMissing() {
  const findings = parseAuditResults(audit(EXPRESS_AUDIT, null, EXPRESS_LOCKFILE), EXPRESS_PACKAGE);
  const serialize = findings.find((f) => f.package === 'serialize-javascript');
  return report(
    'Without the production audit: advisory severity kept, dev-only marked unknown',
    serialize.severity === 'high' && serialize.devOnly === null && serialize.context.some((c) => c.startsWith('? Could not tell')),
    JSON.stringify(serialize.context),
  );
}

function testResolvedWithoutLockfile() {
  const [finding] = parseAuditResults(audit(DVNA_AUDIT, DVNA_AUDIT, { lockfileVersion: 3, packages: {} }, 'resolved'), DVNA_PACKAGE);
  return report(
    'No lockfile: says versions are resolved at scan time; unknown version is null, not "undefined"',
    finding.context.some((c) => c.startsWith('? No lockfile'))
      && finding.packageVersion === null
      && finding.context[0] === '✓ node-serialize unknown version is in the affected range >=0.0.0',
    JSON.stringify(finding.context),
  );
}

function testLockedVersion() {
  const v3 = { packages: { 'node_modules/a': { version: '1.0.0' }, 'node_modules/a/node_modules/b': { version: '2.0.0' } } };
  const v1 = { dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '2.0.0' } } } } };
  return report(
    'Lockfile versions: v3 packages and v1 nested dependencies',
    lockedVersion(v3, 'node_modules/a/node_modules/b') === '2.0.0'
      && lockedVersion(v1, 'node_modules/a/node_modules/b') === '2.0.0'
      && lockedVersion(v1, 'node_modules/a') === '1.0.0'
      && lockedVersion(v3, 'node_modules/missing') === null
      && lockedVersion(null, 'node_modules/a') === null,
  );
}

function testMultipleInstalledVersions() {
  const all = {
    vulnerabilities: {
      jsonwebtoken: {
        name: 'jsonwebtoken', severity: 'high', isDirect: true, effects: [], fixAvailable: true,
        nodes: ['node_modules/express-jwt/node_modules/jsonwebtoken', 'node_modules/jsonwebtoken'],
        via: [{ source: 1, title: 'jwt issue', severity: 'high', range: '<9.0.0' }],
      },
    },
  };
  const lockfile = { packages: { 'node_modules/jsonwebtoken': { version: '0.4.0' }, 'node_modules/express-jwt/node_modules/jsonwebtoken': { version: '0.1.0' } } };
  const [finding] = parseAuditResults(audit(all, all, lockfile), { dependencies: { jsonwebtoken: '0.4.0' } });
  return report(
    'Package installed at two paths lists both versions; `npm audit fix` guidance',
    finding.packageVersion === '0.1.0, 0.4.0' && finding.remediation.startsWith('Run `npm audit fix`.') && finding.patchedVersions === '9.0.0',
    `${finding.packageVersion} | ${finding.remediation}`,
  );
}

function testDowngradeIsNotCalledUpgrade() {
  // Real npm output: the "fix" for @cyclonedx/cyclonedx-npm 4.2.1 is 2.0.0, and for cookie (via
  // csurf 1.11.0) it's csurf 1.2.2. Both are downgrades.
  const all = {
    vulnerabilities: {
      '@cyclonedx/cyclonedx-npm': {
        name: '@cyclonedx/cyclonedx-npm', severity: 'high', isDirect: true, effects: [], nodes: ['node_modules/@cyclonedx/cyclonedx-npm'],
        via: [{ source: 2, title: 'cyclonedx issue', severity: 'high', range: '>=2.1.0 <5.0.0' }],
        fixAvailable: { name: '@cyclonedx/cyclonedx-npm', version: '2.0.0', isSemVerMajor: false },
      },
      cookie: {
        name: 'cookie', severity: 'low', isDirect: false, effects: ['csurf'], nodes: ['node_modules/cookie'],
        via: [{ source: 3, title: 'cookie issue', severity: 'low', range: '<0.7.0' }],
        fixAvailable: { name: 'csurf', version: '1.2.2', isSemVerMajor: true },
      },
      csurf: { name: 'csurf', severity: 'low', isDirect: true, effects: [], nodes: ['node_modules/csurf'], via: ['cookie'], fixAvailable: { name: 'csurf', version: '1.2.2', isSemVerMajor: true } },
    },
  };
  const lockfile = { packages: { 'node_modules/@cyclonedx/cyclonedx-npm': { version: '4.2.1' }, 'node_modules/cookie': { version: '0.4.0' }, 'node_modules/csurf': { version: '1.11.0' } } };
  const [cyclonedx, cookie] = parseAuditResults(audit(all, all, lockfile), { dependencies: { csurf: '^1.9.0' }, devDependencies: { '@cyclonedx/cyclonedx-npm': '^4.0.0' } });
  return report(
    'npm fixes that are downgrades say so, and flag a major change even when npm doesn\'t',
    cyclonedx.remediation.startsWith('Downgrade @cyclonedx/cyclonedx-npm from 4.2.1 to 2.0.0 (major version change')
      && cookie.remediation.startsWith('Downgrade csurf from 1.11.0 to 1.2.2')
      && ![cyclonedx, cookie].some((f) => /upgrade/i.test(f.remediation) || f.context.some((c) => /upgrade/i.test(c))),
    `${cyclonedx.remediation} | ${cookie.remediation}`,
  );
}

function testCompareVersions() {
  const cases = [['1.11.0', '1.2.2', 1], ['2.0.0', '4.2.1', -1], ['1.0.0', '1.0.0', 0], ['1.0.0-beta', '1.0.0', -1], ['10.0.0', '9.9.9', 1], ['1.2', '1.2.0', 0]];
  const failures = cases.filter(([a, b, expected]) => Math.sign(compareVersions(a, b)) !== expected);
  return report('Version comparison is numeric, prerelease sorts first', failures.length === 0, JSON.stringify(failures));
}

function testFirstPatchedVersion() {
  const cases = [['>=6.0.0 <8.0.3', '8.0.3'], ['<4.17.21', '4.17.21'], ['<=7.0.2', null], ['>=0.0.0', null], ['<1.0.0 || >=2.0.0 <2.1.0', null], [undefined, null], ['<2.0.0-beta', '2.0.0-beta']];
  const failures = cases.filter(([range, expected]) => firstPatchedVersion(range) !== expected);
  return report('First patched version only from a strict upper bound', failures.length === 0, JSON.stringify(failures));
}

function testIntroducedByHandlesCycles() {
  const vulnerabilities = {
    a: { name: 'a', isDirect: false, effects: ['b'] },
    b: { name: 'b', isDirect: false, effects: ['a', 'c', 'd'] },
    c: { name: 'c', isDirect: true, effects: [] },
    d: { name: 'd', isDirect: true, effects: ['b'] },
  };
  const parents = introducedBy('a', vulnerabilities);
  return report('Traces to direct dependencies through cycles', JSON.stringify(parents) === '["c","d"]', JSON.stringify(parents));
}

function testAuditErrorsThrow() {
  const failures = [];
  const enolock = JSON.stringify({ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } });
  try { parseAuditJson(enolock); failures.push('ENOLOCK did not throw'); } catch (error) { if (!error.message.includes('ENOLOCK')) failures.push(error.message); }
  try { parseAuditJson('not json'); failures.push('garbage did not throw'); } catch { /* expected */ }
  try { parseAuditJson('{}'); failures.push('missing vulnerabilities did not throw'); } catch { /* expected */ }
  return report('npm audit errors throw instead of reading as zero findings', failures.length === 0, JSON.stringify(failures));
}

const results = [
  testDevOnlyTransitive(),
  testFixNamesTheRightPackage(),
  testRuntimeDirectNoFix(),
  testUnknownWhenProdAuditMissing(),
  testResolvedWithoutLockfile(),
  testLockedVersion(),
  testMultipleInstalledVersions(),
  testDowngradeIsNotCalledUpgrade(),
  testCompareVersions(),
  testFirstPatchedVersion(),
  testIntroducedByHandlesCycles(),
  testAuditErrorsThrow(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
