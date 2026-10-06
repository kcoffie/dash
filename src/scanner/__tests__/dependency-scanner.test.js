import fs from 'fs';
import path from 'path';
import { scanDependencies } from '../dependency-scanner.js';
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

function isOffline(errors) {
  return errors.some((error) => /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(error));
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

async function testNoLockfileResolvesWithoutTouchingTarget() {
  // DVNA's case: no lockfile. node-serialize 0.0.4 has a critical advisory with no fix.
  const testPath = setup('no-lockfile');
  fs.writeFileSync(path.join(testPath, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'node-serialize': '0.0.4' } }));

  const { findings, errors } = await scanDependencies(testPath);
  if (isOffline(errors)) {
    console.log(`⚠ No lockfile: skipped, npm registry unreachable (${errors[0]})`);
    return true;
  }
  const finding = findings.find((f) => f.package === 'node-serialize');
  const leftovers = fs.readdirSync(testPath).filter((name) => name !== 'package.json');
  if (errors.length === 0 && finding?.packageVersion === '0.0.4' && finding.severity === 'critical' && finding.devOnly === false && leftovers.length === 0) {
    console.log('✓ No lockfile: resolved in a temp dir, node-serialize@0.0.4 critical, target untouched');
    return true;
  }
  console.log(`✗ No lockfile: ${JSON.stringify({ errors, finding, leftovers })}`);
  return false;
}

async function runTests() {
  console.log('\n🧪 Running edge case tests...\n');

  const results = [];
  results.push(await testMissingPackageJson());
  results.push(await testMalformedJson());
  results.push(await testNoLockfileWithWorkspaces());
  results.push(await testNoLockfileResolvesWithoutTouchingTarget());

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
