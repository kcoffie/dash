import fs from 'fs';
import path from 'path';
import { scanForSecrets } from '../patterns/hardcoded-secrets.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '..', '..', '..', '.test-tmp-secrets');

// Fake credentials in the documented formats. Built from parts so this file doesn't
// itself contain a matchable key (GitHub push protection scans it).
const AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const GITHUB_TOKEN = ['ghp', '_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');
const GITLAB_TOKEN = ['glpat', '-', 'xY9zW8vU7tS6rQ5pO4nM'].join('');
const PEM = (label) => ['-----BEGIN ', label, '-----'].join('');

// Writes { relativePath: content } under a fresh tmp dir and scans it
async function scanFiles(files) {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tmpDir, file)), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, file), content);
  }
  return scanForSecrets(tmpDir);
}

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const summary = (findings) => JSON.stringify(findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity, file: f.file, line: f.line, context: f.context })), null, 1);

async function testAwsKey() {
  const findings = await scanFiles({ 'config.js': `const AWS_KEY = "${AWS_KEY}";` });
  const [finding] = findings;
  return report(
    'AWS key in app code → critical, file-based id, 3+ factors',
    findings.length === 1 && finding.title === 'AWS Access Key' && finding.severity === 'critical'
      && finding.id === 'secret-config_js-1' && finding.context.length >= 3,
    summary(findings),
  );
}

async function testPrivateKeyFormats() {
  const findings = await scanFiles({
    'keys/pkcs8.pem': `${PEM('PRIVATE KEY')}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n`,
    'keys/rsa.pem': `${PEM('RSA PRIVATE KEY')}\nMIIEpAIBAAKCAQEA\n`,
    'keys/encrypted.pem': `${PEM('ENCRYPTED PRIVATE KEY')}\nMIIFHzBJBgkqhkiG\n`,
    'keys/public.pem': `${PEM('PUBLIC KEY')}\nMIIBIjANBgkqhkiG\n`,
  });
  const files = findings.filter((f) => f.title === 'Private Key').map((f) => f.file).sort();
  return report(
    'Private keys: PKCS#8, RSA, encrypted detected; public key not',
    JSON.stringify(files) === JSON.stringify(['keys/encrypted.pem', 'keys/pkcs8.pem', 'keys/rsa.pem']) && findings.length === 3,
    summary(findings),
  );
}

async function testGitTokens() {
  const findings = await scanFiles({ 'ci.js': `const gh = "${GITHUB_TOKEN}";\nconst gl = "${GITLAB_TOKEN}";` });
  return report(
    'GitHub ghp_ and GitLab glpat- tokens → critical',
    findings.length === 2 && findings.every((f) => f.title === 'GitHub/GitLab Token' && f.severity === 'critical'),
    summary(findings),
  );
}

async function testInterpolatedValuesIgnored() {
  // From Juice Shop: none of these is a hardcoded secret, the value is computed or templated
  const findings = await scanFiles({
    'routes/login.ts': "models.sequelize.query(`SELECT * FROM Users WHERE email = '${req.body.email}' AND password = '${security.hash(req.body.password)}'`)",
    'terraform/main.tf': 'creation_token = "${var.project_name}-sqlite-data"',
    'app/complaint.ts': "authToken: `Bearer ${localStorage.getItem('token')}`,",
    'chart/values.yaml': 'password: "{{ .Values.dbPassword }}"',
  });
  return report('Interpolated / templated values are not reported', findings.length === 0, summary(findings));
}

async function testPlaceholderVsRealPassword() {
  const findings = await scanFiles({
    'src/db.js': [
      "const a = { password: 'foobar' };",
      "const b = { password: 'changeme' };",
      "const c = { password: 'OhG0dPlease1nsertLiquor!' };",
      "const d = { password: 'admin123' };",
    ].join('\n'),
    'config/production.json': '{ "db": { "user": "app", "password": "Pr0d-Db-Passw0rd!" } }',
  });
  const json = findings.find((f) => f.file === 'config/production.json');
  const byLine = Object.fromEntries(findings.filter((f) => f.file === 'src/db.js').map((f) => [f.line, f.severity]));
  const placeholder = findings.find((f) => f.file === 'src/db.js' && f.line === 1);
  return report(
    'Placeholder passwords → low; real (even weak) passwords stay high, JSON keys included',
    JSON.stringify(byLine) === JSON.stringify({ 1: 'low', 2: 'low', 3: 'high', 4: 'high' })
      && json?.severity === 'high'
      && placeholder.context.some((c) => c.startsWith('⚠ Value looks like a placeholder')),
    summary(findings),
  );
}

async function testGenericSecretInTestOrExampleIsLow() {
  const findings = await scanFiles({
    'examples/auth/index.js': "hash({ password: 'hunter2hunter2' }, function () {})",
    'src/login.spec.ts': "const user = { email: 'a@b.c', password: 'ncc-1701' }",
    'data/static/codefixes/fix_1.ts': "const apiKey = 'Zk3pQ9xV7mN2bL8cR4tY6wE1'",
  });
  const files = findings.map((f) => `${f.file}:${f.severity}`).sort();
  return report(
    'Generic secrets: example and snippet files → low; .spec./.test. files not reported',
    JSON.stringify(files) === JSON.stringify(['data/static/codefixes/fix_1.ts:low', 'examples/auth/index.js:low']),
    summary(findings),
  );
}

async function testProviderKeyInTestFileKeepsSeverity() {
  const findings = await scanFiles({ 'test/aws.test.js': `const key = "${AWS_KEY}";` });
  const [finding] = findings;
  return report(
    'Provider key in a test file is still critical (a real key leaks wherever it is)',
    findings.length === 1 && finding.severity === 'critical' && finding.context.some((c) => c.includes('test/example file')),
    summary(findings),
  );
}

async function testSeedDataIsMedium() {
  const findings = await scanFiles({
    'data/static/users.yml': "-\n  email: admin@juice-sh.op\n  password: 'admin123'\n",
    'seeders/20240101-users.json': '{ "email": "a@b.c", "password": "Sup3rS3cret!" }',
  });
  return report(
    'Passwords in seed data files → medium with a seed-data factor',
    findings.length === 2 && findings.every((f) => f.severity === 'medium' && f.context.some((c) => c.startsWith('⚠ Seed data file'))),
    summary(findings),
  );
}

async function testIdsUniqueOnOneLine() {
  const findings = await scanFiles({ 'keys.js': `const a = "${AWS_KEY}", b = "${AWS_KEY.replace('EXAMPLE', 'EXAMPL2')}";` });
  const ids = findings.map((f) => f.id);
  return report('Two secrets on one line get distinct ids', ids.length === 2 && new Set(ids).size === 2, JSON.stringify(ids));
}

async function testOverlappingPatternsReportOnce() {
  const findings = await scanFiles({ 'config.js': `const api_key = "${GITHUB_TOKEN}";` });
  return report(
    'A GitHub token assigned to api_key is one finding (the specific format), not two',
    findings.length === 1 && findings[0].title === 'GitHub/GitLab Token',
    summary(findings),
  );
}

async function testValuesNeverEchoed() {
  const strongPassword = 'mDLx94T1CfVfZMzwsJ9fs3L6lbMqE70FfI854jb';
  const findings = await scanFiles({ 'config.js': `const AWS_KEY = "${AWS_KEY}";\nconst db = { password: '${strongPassword}' };` });
  const leaked = findings.filter((f) => [f.id, f.title, f.description, f.remediation, ...f.context].join(' ').match(new RegExp(`${AWS_KEY.slice(0, 8)}|${strongPassword.slice(0, 8)}`)));
  return report('Secret values (even a prefix) appear only in the snippet, never in id/title/factors', findings.length === 2 && leaked.length === 0, summary(leaked));
}

async function testLowEntropyTokenIsLow() {
  const findings = await scanFiles({
    'src/client.js': "const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa';\nconst api_key = 'q8Zr2Lm9Xv4Tn7Wb1Kc5Hy3Pd6';",
  });
  const byLine = Object.fromEntries(findings.map((f) => [f.line, f.severity]));
  return report('Low-entropy token → low; random-looking token stays high', JSON.stringify(byLine) === JSON.stringify({ 1: 'low', 2: 'high' }), summary(findings));
}

async function testUrlIsNotAComment() {
  const webhook = ['https://hooks.slack.com/services/', 'T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX'].join('');
  const findings = await scanFiles({ 'notify.js': `const url = "${webhook}";\n// const old = "${webhook}";` });
  const [code, comment] = findings;
  return report(
    "A URL's // isn't a comment; a commented-out line is",
    findings.length === 2
      && !code.context.some((c) => c.includes('In a comment'))
      && comment.context.some((c) => c.includes('In a comment')),
    summary(findings),
  );
}

async function testTranslationFilesOnlyProviderKeys() {
  // Juice Shop's frontend/src/assets/i18n/*.json: 500+ label keys like "LABEL_PASSWORD"
  const findings = await scanFiles({
    'frontend/src/assets/i18n/en.json': '{ "LABEL_PASSWORD": "Password", "MANDATORY_NEW_PASSWORD": "Please provide a new password.", "LABEL_TWO_FACTOR_AUTH_TOKEN": "Two-factor authentication token" }',
    'locales/de/common.json': `{ "aws": "${AWS_KEY}" }`,
  });
  return report(
    'Translation files: label keys ignored, provider keys still found',
    findings.length === 1 && findings[0].title === 'AWS Access Key' && findings[0].file === 'locales/de/common.json',
    summary(findings),
  );
}

async function testSessionSecret() {
  // DVNA server.js: express-session signs cookies with this; Express's examples/ use the same idiom
  const findings = await scanFiles({
    'server.js': "app.use(session({\n  secret: 'keyboard cat',\n  resave: true\n}))",
    'examples/session/index.js': "app.use(session({ secret: 'keyboard cat' }))",
    'src/auth.js': "const JWT_SECRET = 'r8Kq2zVn5Lw9Xb3Tc7Hm1Py4';",
  });
  const byFile = Object.fromEntries(findings.map((f) => [f.file, `${f.title}:${f.severity}`]));
  return report(
    'Hardcoded session / JWT secrets: app code high, examples low',
    JSON.stringify(byFile) === JSON.stringify({ 'examples/session/index.js': 'Secret Key:low', 'server.js': 'Secret Key:high', 'src/auth.js': 'Secret Key:high' }),
    summary(findings),
  );
}

async function testFactorNamesWholeIdentifier() {
  // Juice Shop login.component.ts: the factor should name testingPassword, not just "Password"
  const findings = await scanFiles({ 'src/login.component.ts': "  public testingPassword = 'IamUsedForTesting'" });
  return report(
    'Factor names the whole identifier',
    findings.length === 1 && findings[0].context[0] === '✓ `testingPassword` is assigned a literal value',
    summary(findings),
  );
}

async function testPassphraseIsNotPlaceholder() {
  // Juice Shop users.yml: a real passphrase that starts with "my "
  const findings = await scanFiles({ 'src/users.js': "const u = { password: 'my little nest of vipers' };\nconst v = { password: 'my_password_here' };" });
  const byLine = Object.fromEntries(findings.map((f) => [f.line, f.severity]));
  return report('"my little nest of vipers" is a passphrase; "my_password_here" is a placeholder', JSON.stringify(byLine) === JSON.stringify({ 1: 'high', 2: 'low' }), summary(findings));
}

async function testEnvFiles() {
  // .env values are usually unquoted, which the assignment patterns (quotes required) never matched
  const findings = await scanFiles({
    '.env': [
      'DB_PASSWORD=hunter2hunter2',
      'export STRIPE_SECRET_KEY="Zk3pQ9xV7mN2bL8cR4tY6wE1"',
      'API_KEY=',
      'DEBUG=true',
      '# OLD_TOKEN=Qm8Zr2Lm9Xv4Tn7Wb1Kc5Hy3',
    ].join('\n'),
    '.env.example': 'DB_PASSWORD=changeme\nJWT_SECRET=s3cr3tvalue123',
    'deploy/prod.env': 'GITHUB_TOKEN=Qm8Zr2Lm9Xv4Tn7Wb1Kc5Hy3\nGITHUB_TOKEN_NAME=deploy-bot\nTOKEN_TTL=3600\nPASSWORD_MIN_LENGTH=12',
    'src/settings.js': 'const note = "set PASSWORD=hunter2 in your shell";',
  });
  const got = findings.map((f) => `${f.file}:${f.line}:${f.severity}`).sort();
  const expected = ['.env.example:1:low', '.env.example:2:low', '.env:1:high', '.env:2:high', '.env:5:high', 'deploy/prod.env:1:high'];
  const real = findings.find((f) => f.file === '.env' && f.line === 1);
  const commented = findings.find((f) => f.file === '.env' && f.line === 5);
  const example = findings.find((f) => f.file === '.env.example' && f.line === 2);
  return report(
    '.env files: unquoted values found; empty and non-secret keys (TOKEN_TTL) ignored; .env.example is an example',
    JSON.stringify(got) === JSON.stringify(expected)
      && real.title === 'Env File Secret'
      && real.context.some((c) => c.startsWith('? In a .env file'))
      && real.context[0] === '✓ `DB_PASSWORD` is assigned a literal value'
      && commented.context.some((c) => c.startsWith('? In a comment'))
      && example.context.some((c) => c.startsWith('⚠ In a test/example file'))
      && !example.context.some((c) => c.startsWith('? In a .env file')),
    summary(findings),
  );
}

async function testSkipsNodeModules() {
  const findings = await scanFiles({ 'node_modules/pkg/config.js': `const AWS_KEY = "${AWS_KEY}";` });
  return report('Skips node_modules', findings.length === 0, summary(findings));
}

const results = [];
for (const test of [
  testAwsKey, testPrivateKeyFormats, testGitTokens, testInterpolatedValuesIgnored, testPlaceholderVsRealPassword,
  testGenericSecretInTestOrExampleIsLow, testProviderKeyInTestFileKeepsSeverity, testSeedDataIsMedium,
  testIdsUniqueOnOneLine, testOverlappingPatternsReportOnce, testValuesNeverEchoed, testLowEntropyTokenIsLow,
  testUrlIsNotAComment, testTranslationFilesOnlyProviderKeys, testSessionSecret, testFactorNamesWholeIdentifier,
  testPassphraseIsNotPlaceholder, testEnvFiles, testSkipsNodeModules,
]) {
  results.push(await test());
}

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
