import fs from 'fs';
import path from 'path';
import { scanForInsecureCrypto } from '../patterns/insecure-crypto.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Unique per run, so parallel runs (Stryker workers) don't delete each other's fixtures
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.test-tmp-crypto-'));

function setup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

// files: { 'relative/path.js': 'source' }
async function scanFiles(files) {
  const testPath = setup();
  for (const [fileName, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(testPath, fileName)), { recursive: true });
    fs.writeFileSync(path.join(testPath, fileName), Array.isArray(source) ? source.join('\n') : source);
  }
  return scanForInsecureCrypto(testPath);
}

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const hasShape = (f) => f.type === 'crypto-misuse' && f.context.length >= 3 && f.remediation && f.references.length > 0
  && f.context.every((factor) => /^[✓⚠?]/.test(factor));

// --- Weak hashes ---

async function testWeakHashHelperTracedToPasswordCallers() {
  // Juice Shop: generic md5 helper in lib/insecurity.ts, passwords hashed with it in other files
  const findings = await scanFiles({
    'lib/insecurity.ts': [
      "import crypto from 'node:crypto'",
      "export const hash = (data: string) => crypto.createHash('md5').update(data).digest('hex')",
    ],
    'models/user.ts': [
      "import * as security from '../lib/insecurity'",
      "this.setDataValue('password', security.hash(clearTextPassword))",
    ],
    'routes/order.ts': [
      "import * as security from '../lib/insecurity'",
      "const orderId = security.hash(email).slice(0, 4)",
    ],
  });
  const f = findings[0];
  return report(
    'MD5 helper whose callers hash passwords → one high finding at the helper',
    findings.length === 1 && f.file === 'lib/insecurity.ts' && f.line === 2 && f.severity === 'high'
      && f.context.some((c) => c.includes('models/user.ts:2')) && !f.context.some((c) => c.includes('order.ts'))
      && hasShape(f),
    JSON.stringify(findings),
  );
}

async function testHelperCallersInOtherModulesIgnored() {
  // A caller that never imports the helper's module is calling some other hash()
  const findings = await scanFiles({
    'lib/insecurity.js': "export const hash = (data) => crypto.createHash('md5').update(data).digest('hex')",
    'routes/other.js': "const stored = hash(req.body.password)",
  });
  return report('Same-named function in an unrelated module not traced', findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testHelperCallersInSnippetsIgnored() {
  const findings = await scanFiles({
    'lib/insecurity.ts': "export const hash = (data: string) => crypto.createHash('md5').update(data).digest('hex')",
    'data/static/codefixes/loginFix_1.ts': [
      "import * as security from '../../../lib/insecurity'",
      "const user = await login(req.body.email, security.hash(req.body.password))",
    ],
  });
  return report('Callers in training snippets don\'t escalate the helper', findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testMd5PackageComparedToRequestToken() {
  // DVNA core/authHandler.js:49 — reset token is md5(login)
  const findings = await scanFiles({
    'core/authHandler.js': [
      "var md5 = require('md5')",
      'module.exports.resetPw = function (req, res) {',
      '  if (req.query.token == md5(req.query.login)) {',
      "    res.render('resetpw')",
      '  }',
      '}',
    ],
  });
  const f = findings[0];
  return report(
    'md5() package call used as a reset token → high',
    findings.length === 1 && f.line === 3 && f.severity === 'high' && hasShape(f),
    JSON.stringify(findings),
  );
}

async function testMd5WithoutPackageImportNotFlagged() {
  const findings = await scanFiles({ 'util.js': 'function md5(x) { return x }\nconst v = md5(name)' });
  return report('md5() without an md5 package import is not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testDirectPasswordHash() {
  const findings = await scanFiles({
    'auth.js': "const stored = crypto.createHash('sha1').update(password).digest('hex')",
  });
  return report('SHA-1 of a password on the same line → high', findings.length === 1 && findings[0].severity === 'high', JSON.stringify(findings));
}

async function testChecksumIsLow() {
  // Juice Shop scripts/package.mjs:121 — release file checksums
  const findings = await scanFiles({
    'scripts/package.mjs': [
      'const content = await fs.readFile(filePath)',
      "const hash = crypto.createHash('md5').update(content).digest('hex')",
      'console.log(`Checksum ${hash} written`)',
    ],
  });
  return report('MD5 file checksum → low', findings.length === 1 && findings[0].severity === 'low' && hasShape(findings[0]), JSON.stringify(findings));
}

async function testUnknownInputIsMedium() {
  const findings = await scanFiles({ 'lib/ids.js': "const digest = crypto.createHash('md5').update(value).digest('hex')" });
  return report('MD5 of an unknown value → medium', findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testStrongHashesAndHmacSha1NotFlagged() {
  const findings = await scanFiles({
    'lib/utils.js': [
      "const a = crypto.createHash('sha256').update(password).digest('hex')",
      // HMAC-SHA1 isn't broken the way plain SHA-1 is (Juice Shop lib/utils.ts:80)
      "const b = crypto.createHmac('sha1', getCtfKey()).update(text).digest('hex')",
      "const c = bcrypt.hashSync(password, 10)",
    ],
  });
  return report('SHA-256, HMAC-SHA1 with a non-literal key, bcrypt not flagged', findings.length === 0, JSON.stringify(findings));
}

// --- Hardcoded keys ---

async function testHmacLiteralKeyIsHigh() {
  // Juice Shop lib/insecurity.ts:42
  const findings = await scanFiles({
    'lib/insecurity.ts': "export const hmac = (data: string) => crypto.createHmac('sha256', 'pa4qacea4VK9t9nGv7yZtwmj').update(data).digest('hex')",
  });
  const f = findings[0];
  return report(
    'HMAC keyed with a string literal → high, key not echoed in factors',
    findings.length === 1 && f.severity === 'high' && hasShape(f)
      && !f.context.join(' ').includes('pa4qacea4VK9t9nGv7yZtwmj'),
    JSON.stringify(findings),
  );
}

async function testCipherLiteralKeyAndBufferFrom() {
  const findings = await scanFiles({
    'lib/crypt.js': [
      "const c1 = crypto.createCipheriv('aes-256-gcm', Buffer.from('0123456789abcdef0123456789abcdef'), iv)",
      "const c2 = crypto.createCipheriv('aes-256-gcm', key, iv)",
    ],
  });
  return report('createCipheriv with Buffer.from(literal) key → high; variable key not flagged', findings.length === 1 && findings[0].line === 1 && findings[0].severity === 'high', JSON.stringify(findings));
}

async function testLiteralKeyInTestFileIsLow() {
  const findings = await scanFiles({ 'examples/hmac.js': "const h = crypto.createHmac('sha256', 'example-key')" });
  return report('Literal key in an example file → low', findings.length === 1 && findings[0].severity === 'low', JSON.stringify(findings));
}

// --- Broken ciphers ---

async function testCreateCipherWithoutIv() {
  const findings = await scanFiles({ 'lib/crypt.js': "const cipher = crypto.createCipher('aes-256-cbc', key)" });
  return report('createCipher (no IV) → high', findings.length === 1 && findings[0].severity === 'high' && hasShape(findings[0]), JSON.stringify(findings));
}

async function testWeakCipherAlgorithms() {
  const findings = await scanFiles({
    'lib/crypt.js': [
      "const a = crypto.createCipheriv('des-ede3-cbc', key, iv)",
      "const b = crypto.createCipheriv('aes-128-ecb', key, null)",
      "const c = CryptoJS.RC4.encrypt(text, key)",
      "const d = crypto.createCipheriv('aes-256-gcm', key, iv)",
    ],
  });
  return report(
    'DES / ECB / RC4 → high; AES-GCM not flagged',
    findings.length === 3 && findings.every((f) => f.severity === 'high') && !findings.some((f) => f.line === 4),
    JSON.stringify(findings),
  );
}

// --- Math.random ---

async function testMathRandomSecretIsMedium() {
  const findings = await scanFiles({ 'lib/auth.js': "const resetToken = Math.random().toString(36).slice(2)" });
  return report('Math.random() for a token → medium', findings.length === 1 && findings[0].severity === 'medium' && hasShape(findings[0]), JSON.stringify(findings));
}

async function testMathRandomInCaptchaFunctionIsLow() {
  // Juice Shop routes/captcha.ts:14
  const findings = await scanFiles({
    'routes/captcha.ts': [
      'export function captchas () {',
      '  return async (req: Request, res: Response) => {',
      '    const firstTerm = Math.floor((Math.random() * 10) + 1)',
      '  }',
      '}',
    ],
  });
  return report('Math.random() in a captcha function → low', findings.length === 1 && findings[0].severity === 'low', JSON.stringify(findings));
}

async function testMathRandomNonSecurityNotFlagged() {
  const findings = await scanFiles({
    'data/datacreator.ts': 'const quantity = Math.floor(Math.random() * 70 + 30)',
    'src/list.jsx': 'const item = <li key={Math.random()}>{name}</li>',
    'src/shuffle.js': 'function shuffle (xs) { return xs.map((x) => ({ x, sort: Math.random() })) }',
  });
  return report('Math.random() for quantities, React keys, shuffles not flagged', findings.length === 0, JSON.stringify(findings));
}

// --- JWT ---

async function testJwtVerifyWithPublicKeyNoAlgorithms() {
  // Juice Shop lib/insecurity.ts:189
  const findings = await scanFiles({
    'lib/insecurity.ts': "jwt.verify(token, publicKey, (err: Error | null, decoded: any) => {})",
  });
  return report('jwt.verify with a public key and no algorithms → high', findings.length === 1 && findings[0].severity === 'high' && hasShape(findings[0]), JSON.stringify(findings));
}

async function testExpressJwtNoAlgorithms() {
  // Juice Shop lib/insecurity.ts:52
  const findings = await scanFiles({
    'lib/insecurity.ts': [
      "import expressJwt from 'express-jwt'",
      'export const isAuthorized = () => expressJwt(({ secret: publicKey }) as any)',
      'export const other = () => expressJwt({ secret: process.env.JWT_SECRET })',
    ],
  });
  const [a, b] = findings;
  return report(
    'express-jwt without algorithms → high with public key, medium otherwise',
    findings.length === 2 && a.line === 2 && a.severity === 'high' && b.line === 3 && b.severity === 'medium',
    JSON.stringify(findings),
  );
}

async function testJwtWithAlgorithmsNotFlagged() {
  const findings = await scanFiles({
    'lib/auth.js': [
      'jwt.verify(token, publicKey, {',
      "  algorithms: ['RS256'],",
      '}, callback)',
      "app.use(expressJwt({ secret: publicKey, algorithms: ['RS256'] }))",
    ],
  });
  return report('jwt.verify / express-jwt with algorithms (even multi-line) not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testJwtNoneAlgorithmIsHigh() {
  const findings = await scanFiles({
    'lib/auth.js': [
      "const t = jwt.sign(payload, '', { algorithm: 'none' })",
      "jwt.verify(token, secret, { algorithms: ['HS256', 'none'] })",
    ],
  });
  return report("'none' algorithm in jwt.sign / allowed in jwt.verify → high", findings.length === 2 && findings.every((f) => f.severity === 'high'), JSON.stringify(findings));
}

async function testJwtSignLiteralSecretIsHigh() {
  const findings = await scanFiles({ 'lib/auth.js': "const t = jwt.sign({ id }, 'shhhhh', { expiresIn: '1h' })" });
  return report('jwt.sign with a literal secret → high', findings.length === 1 && findings[0].severity === 'high', JSON.stringify(findings));
}

// --- Hashids ---

async function testHashidsLiteralSalt() {
  // Juice Shop routes/continueCode.ts:13
  const findings = await scanFiles({
    'routes/continueCode.ts': [
      "const hashids = new Hashids('this is my salt', 60, 'abcdefghijklmnopqrstuvwxyz')",
      'const fromEnv = new Hashids(process.env.HASHIDS_SALT, 60)',
    ],
  });
  return report('Hashids with a literal salt → medium; env salt not flagged', findings.length === 1 && findings[0].line === 1 && findings[0].severity === 'medium' && hasShape(findings[0]), JSON.stringify(findings));
}

// --- Merging, comments, ids ---

async function testOneFindingPerLine() {
  // Juice Shop lib/insecurity.ts:53 — Math.random secret + no algorithms on one line
  const findings = await scanFiles({
    'lib/insecurity.ts': "export const denyAll = () => expressJwt({ secret: '' + Math.random() } as any)",
  });
  const f = findings[0];
  return report(
    'Two issues on one line → one finding, both listed, highest severity (medium)',
    findings.length === 1 && f.severity === 'medium' && f.title.includes('+')
      && f.context.some((c) => c.includes('Math.random')) && f.context.some((c) => c.includes('algorithms')),
    JSON.stringify(findings),
  );
}

async function testCommentsNotFlagged() {
  const findings = await scanFiles({
    'lib/a.js': [
      "// const h = crypto.createHash('md5').update(password)",
      " * crypto.createCipher('aes-256-cbc', key)",
    ],
  });
  return report('Commented-out code not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testIdsUnique() {
  const findings = await scanFiles({
    'lib/a.js': "const x = crypto.createHash('md5').update(password)",
    'lib/b.js': "const x = crypto.createHash('md5').update(password)",
  });
  const ids = new Set(findings.map((f) => f.id));
  return report('Finding ids are unique across files', findings.length === 2 && ids.size === 2, JSON.stringify(findings.map((f) => f.id)));
}

async function runTests() {
  console.log('🧪 Running Insecure Crypto Scanner Tests\n');
  const results = [];

  results.push(await testWeakHashHelperTracedToPasswordCallers());
  results.push(await testHelperCallersInOtherModulesIgnored());
  results.push(await testHelperCallersInSnippetsIgnored());
  results.push(await testMd5PackageComparedToRequestToken());
  results.push(await testMd5WithoutPackageImportNotFlagged());
  results.push(await testDirectPasswordHash());
  results.push(await testChecksumIsLow());
  results.push(await testUnknownInputIsMedium());
  results.push(await testStrongHashesAndHmacSha1NotFlagged());
  results.push(await testHmacLiteralKeyIsHigh());
  results.push(await testCipherLiteralKeyAndBufferFrom());
  results.push(await testLiteralKeyInTestFileIsLow());
  results.push(await testCreateCipherWithoutIv());
  results.push(await testWeakCipherAlgorithms());
  results.push(await testMathRandomSecretIsMedium());
  results.push(await testMathRandomInCaptchaFunctionIsLow());
  results.push(await testMathRandomNonSecurityNotFlagged());
  results.push(await testJwtVerifyWithPublicKeyNoAlgorithms());
  results.push(await testExpressJwtNoAlgorithms());
  results.push(await testJwtWithAlgorithmsNotFlagged());
  results.push(await testJwtNoneAlgorithmIsHigh());
  results.push(await testJwtSignLiteralSecretIsHigh());
  results.push(await testHashidsLiteralSalt());
  results.push(await testOneFindingPerLine());
  results.push(await testCommentsNotFlagged());
  results.push(await testIdsUnique());

  console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);

  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  process.exit(results.every(Boolean) ? 0 : 1);
}

runTests().catch((error) => {
  console.error('Test error:', error.message);
  process.exit(1);
});
