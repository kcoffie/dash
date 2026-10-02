import { toDemoReport, keyMaterialIn, REDACTED } from '../demo-export.js';

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// Built from parts so this file doesn't itself look like it holds a key
const PEM_HEADER = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
const AWS_EXAMPLE_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE'; // AWS's documented example key

const SOURCE = { name: 'juice-shop', repo: 'https://github.com/juice-shop/juice-shop', commit: '1618a61' };

function scan(findings) {
  return { timestamp: '2026-10-02T00:00:00.000Z', targetPath: '/tmp/juice-shop', findings, summary: { total: findings.length } };
}

const SECRET = {
  id: `secret-${PEM_HEADER.slice(0, 20)}`, type: 'hardcoded-secret', title: 'Private Key', severity: 'critical',
  file: 'lib/insecurity.ts', line: 21, snippet: `const privateKey = '${PEM_HEADER}\\r\\nMIICXAIBAAKBgQDNwqLE…'`,
  context: ['✓ Active code (not in comment)'],
};
const SQLI = {
  id: 'sqli-routes_login_ts-34', type: 'sql-injection', title: 'Potential SQL Injection', severity: 'critical',
  file: 'routes/login.ts', line: 34, snippet: "query(`SELECT * FROM Users WHERE email = '${req.body.email}' AND password = '${hash}'`",
};

function testRedactsSecrets() {
  const demo = toDemoReport(scan([SECRET, SQLI]), SOURCE);
  const [secret, sqli] = demo.findings;
  return report(
    'Secret snippet and id redacted, other findings untouched',
    secret.snippet === REDACTED && secret.id === 'secret-lib/insecurity.ts-21'
      && secret.title === 'Private Key' && secret.line === 21
      && sqli === SQLI, // same object: nothing about non-secret findings changes
    JSON.stringify(demo.findings),
  );
}

function testReplacesLocalPath() {
  const demo = toDemoReport(scan([SQLI]), SOURCE);
  return report(
    'Local scan path replaced by the repo name; source recorded',
    demo.targetPath === 'juice-shop' && demo.source.repo === SOURCE.repo && demo.source.commit === '1618a61'
      && demo.timestamp === '2026-10-02T00:00:00.000Z',
    JSON.stringify(demo),
  );
}

function testDoesNotMutateInput() {
  const original = scan([{ ...SECRET }]);
  toDemoReport(original, SOURCE);
  return report('Input report is not modified', original.findings[0].snippet === SECRET.snippet && original.targetPath === '/tmp/juice-shop');
}

function testRefusesKeyMaterialOutsideSecrets() {
  const leaky = { ...SQLI, type: 'xss', file: 'src/config.js', line: 7, snippet: `el.innerHTML = '${AWS_EXAMPLE_KEY}'` };
  let message = '';
  try { toDemoReport(scan([leaky]), SOURCE); } catch (error) { message = error.message; }
  return report(
    'Key material in a non-secret finding stops the export, naming where',
    message.includes('xss at src/config.js:7') && message.includes('AWS Access Key'),
    message,
  );
}

function testKeyDetection() {
  const found = keyMaterialIn({ snippet: PEM_HEADER });
  const twice = keyMaterialIn({ snippet: PEM_HEADER }); // global regexes: lastIndex must not leak between calls
  const sqlWithPasswordColumn = keyMaterialIn(SQLI);
  return report(
    'Detects key formats, ignores ordinary code with password columns',
    found.join() === 'Private Key' && twice.join() === 'Private Key' && sqlWithPasswordColumn.length === 0,
    JSON.stringify({ found, twice, sqlWithPasswordColumn }),
  );
}

const results = [
  testRedactsSecrets(),
  testReplacesLocalPath(),
  testDoesNotMutateInput(),
  testRefusesKeyMaterialOutsideSecrets(),
  testKeyDetection(),
];

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
