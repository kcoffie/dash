import fs from 'fs';
import path from 'path';
import { walkDir } from '../file-utils.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Unique per run, so parallel runs (Stryker workers) don't delete each other's fixtures
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.test-tmp-utils-'));

// Creates the given files (relative paths) under root and returns root
function makeTree(root, files) {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const file of files) {
    const fullPath = path.join(root, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, '// fixture\n');
  }
  return root;
}

const relativeFiles = (root, options) => walkDir(root, options).map((file) => path.relative(root, file)).sort();

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

function testTargetInsideSkippedNameIsScanned() {
  // Skip rules apply inside the target, not to the folders it happens to live in
  const root = makeTree(path.join(tmpDir, 'build', 'my.test.app'), ['src/app.js']);
  const files = relativeFiles(root);
  return report('Target under build/ and named *.test.* is still scanned', files.includes('src/app.js'), JSON.stringify(files));
}

function testGitDirSkippedButGithubScanned() {
  const root = makeTree(path.join(tmpDir, 'repo'), ['.git/config', '.github/workflows/ci.yml', '.gitignore', 'index.js']);
  const files = relativeFiles(root);
  const expected = ['.github/workflows/ci.yml', '.gitignore', 'index.js'];
  return report('.git/ skipped; .github/ and .gitignore scanned', JSON.stringify(files) === JSON.stringify(expected), JSON.stringify(files));
}

function testSkipsDependenciesAndBuildOutput() {
  const root = makeTree(path.join(tmpDir, 'repo'), [
    'node_modules/pkg/index.js', 'dist/bundle.js', 'build/out.js', 'lib/redistribute.js', 'vendor.min.js', 'README.md',
  ]);
  const files = relativeFiles(root);
  return report('Skips node_modules, dist/, build/, .min.js, docs; keeps lib/redistribute.js', JSON.stringify(files) === JSON.stringify(['lib/redistribute.js']), JSON.stringify(files));
}

function testTestFilesOptIn() {
  const root = makeTree(path.join(tmpDir, 'repo'), ['app.js', 'app.test.js', 'app.spec.ts']);
  const byDefault = relativeFiles(root);
  const withTests = relativeFiles(root, { includeTests: true });
  return report(
    'Test files skipped by default, included with includeTests',
    JSON.stringify(byDefault) === JSON.stringify(['app.js'])
      && JSON.stringify(withTests) === JSON.stringify(['app.js', 'app.spec.ts', 'app.test.js']),
    `default ${JSON.stringify(byDefault)}, includeTests ${JSON.stringify(withTests)}`,
  );
}

const results = [
  testTargetInsideSkippedNameIsScanned(),
  testGitDirSkippedButGithubScanned(),
  testSkipsDependenciesAndBuildOutput(),
  testTestFilesOptIn(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
