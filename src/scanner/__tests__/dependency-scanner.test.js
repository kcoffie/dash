import fs from 'fs';
import path from 'path';
import { scanDependencies } from '../dependency-scanner.js';
import { withFakeNpm } from './helpers/fake-npm.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Unique per run, so parallel runs (Stryker workers) don't delete each other's fixtures
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.test-tmp-'));

function setup(dirName) {
  const testPath = path.join(tmpDir, dirName);
  if (fs.existsSync(testPath)) {
    fs.rmSync(testPath, { recursive: true, force: true });
  }
  fs.mkdirSync(testPath, { recursive: true });
  return testPath;
}

async function testMissingPackageJson() {
  const testPath = setup('missing-package-json');
  const { findings, errors } = await scanDependencies(testPath);

  if (findings.length === 0 && errors.length > 0 && errors[0].includes('No package.json')) {
    console.log('✓ Missing package.json: gracefully skipped');
    return true;
  }
  console.log('✗ Missing package.json: should error with no findings');
  return false;
}

async function testMalformedJson() {
  const testPath = setup('malformed-json');
  fs.writeFileSync(path.join(testPath, 'package.json'), '{invalid json}');

  const { findings, errors } = await scanDependencies(testPath);

  if (findings.length === 0 && errors.length > 0 && errors[0].includes('Malformed')) {
    console.log('✓ Malformed JSON: error caught');
    return true;
  }
  console.log('✗ Malformed JSON: should error with no findings');
  return false;
}

async function testNoLockfileWithWorkspaces() {
  // npm audit needs a lockfile; workspaces can't be resolved from package.json alone
  const testPath = setup('workspaces-no-lockfile');
  fs.writeFileSync(path.join(testPath, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }));

  const { findings, errors } = await scanDependencies(testPath);
  if (findings.length === 0 && errors.some((error) => error.includes('workspaces'))) {
    console.log('✓ No lockfile + workspaces: reported as an error, not as zero findings');
    return true;
  }
  console.log(`✗ No lockfile + workspaces: expected an error, got ${JSON.stringify({ findings: findings.length, errors })}`);
  return false;
}

// DVNA's case: no lockfile. node-serialize 0.0.4 has a critical advisory with no fix.
function noLockfileTarget(dirName) {
  const testPath = setup(dirName);
  fs.writeFileSync(path.join(testPath, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'node-serialize': '0.0.4' } }));
  return testPath;
}

function checkNoLockfileResult(name, testPath, { findings, errors }) {
  const finding = findings.find((f) => f.package === 'node-serialize');
  const leftovers = fs.readdirSync(testPath).filter((file) => file !== 'package.json');
  if (errors.length === 0 && finding?.packageVersion === '0.0.4' && finding.severity === 'critical' && finding.devOnly === false && leftovers.length === 0) {
    console.log(`✓ ${name}: resolved in a temp dir, node-serialize@0.0.4 critical, target untouched`);
    return true;
  }
  console.log(`✗ ${name}: ${JSON.stringify({ errors, finding, leftovers })}`);
  return false;
}

async function testNoLockfileResolvesWithoutTouchingTarget() {
  // Recorded npm (see helpers/fake-npm.js): same resolution and audit, no registry
  const testPath = noLockfileTarget('no-lockfile');
  const result = await withFakeNpm('node-serialize-0.0.4', () => scanDependencies(testPath));
  return checkNoLockfileResult('No lockfile', testPath, result);
}

// Opt-in (LIVE_NPM=1): the same case against the real registry, to catch npm changing its
// output. Not part of npm test or mutation runs. Offline is a failure here, not a skip.
async function testNoLockfileLiveRegistry() {
  const testPath = noLockfileTarget('no-lockfile-live');
  return checkNoLockfileResult('No lockfile, live npm registry', testPath, await scanDependencies(testPath));
}

async function runTests() {
  console.log('\n🧪 Running edge case tests...\n');

  const results = [];
  results.push(await testMissingPackageJson());
  results.push(await testMalformedJson());
  results.push(await testNoLockfileWithWorkspaces());
  results.push(await testNoLockfileResolvesWithoutTouchingTarget());
  if (process.env.LIVE_NPM === '1') results.push(await testNoLockfileLiveRegistry());
  else console.log('- No lockfile, live npm registry: not run (set LIVE_NPM=1)');

  console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);

  // Cleanup
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  process.exit(results.every(Boolean) ? 0 : 1);
}

runTests().catch((error) => {
  console.error('Test error:', error.message);
  process.exit(1);
});
