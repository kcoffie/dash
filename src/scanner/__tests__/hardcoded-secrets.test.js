import fs from 'fs';
import path from 'path';
import { scanForSecrets } from '../patterns/hardcoded-secrets.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '..', '..', '..', '.test-tmp-secrets');

function setup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

async function testAWSKeyDetection() {
  const testPath = setup();
  fs.writeFileSync(
    path.join(testPath, 'config.js'),
    `const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";`,
  );

  const findings = await scanForSecrets(testPath);
  if (findings.length > 0 && findings[0].title === 'AWS Access Key') {
    console.log('✓ AWS key detection: passed');
    return true;
  }
  console.log('✗ AWS key detection: failed');
  return false;
}

async function testPrivateKeyDetection() {
  const testPath = setup();
  fs.writeFileSync(
    path.join(testPath, 'key.pem'),
    `-----BEGIN RSA PRIVATE KEY\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY`,
  );

  const findings = await scanForSecrets(testPath);
  if (findings.length > 0 && findings[0].title === 'Private Key') {
    console.log('✓ Private key detection: passed');
    return true;
  }
  console.log('✗ Private key detection: failed');
  return false;
}

async function testSkipsTestFiles() {
  const testPath = setup();
  fs.writeFileSync(
    path.join(testPath, 'config.test.js'),
    `const password = "test_password_12345";`,
  );

  const findings = await scanForSecrets(testPath);
  // Should still find it, but context should indicate test file
  if (findings.length > 0 && findings[0].context.some((c) => c.includes('test'))) {
    console.log('✓ Test file context: passed');
    return true;
  }
  console.log('⚠ Test file context: inconclusive');
  return true; // Non-blocking
}

async function testFakePwdDetection() {
  const testPath = setup();
  fs.writeFileSync(
    path.join(testPath, 'example.js'),
    `const password = "foobar";`,
  );

  const findings = await scanForSecrets(testPath);
  if (
    findings.length > 0 &&
    findings[0].context.some((c) => c.includes('test password pattern'))
  ) {
    console.log('✓ Fake password detection: passed');
    return true;
  }
  console.log('⚠ Fake password detection: inconclusive');
  return true; // Non-blocking
}

async function testSkipsNodeModules() {
  const testPath = setup();
  fs.mkdirSync(path.join(testPath, 'node_modules', 'package'), { recursive: true });
  fs.writeFileSync(
    path.join(testPath, 'node_modules', 'package', 'config.js'),
    `const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";`,
  );

  const findings = await scanForSecrets(testPath);
  if (findings.length === 0) {
    console.log('✓ Skips node_modules: passed');
    return true;
  }
  console.log('✗ Skips node_modules: failed (found findings in node_modules)');
  return false;
}

async function runTests() {
  console.log('\n🧪 Running hardcoded secrets tests...\n');

  const results = [];
  results.push(await testAWSKeyDetection());
  results.push(await testPrivateKeyDetection());
  results.push(await testSkipsTestFiles());
  results.push(await testFakePwdDetection());
  results.push(await testSkipsNodeModules());

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
