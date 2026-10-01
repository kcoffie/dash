import fs from 'fs';
import path from 'path';
import { scanForSqlInjection } from '../patterns/sql-injection.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '..', '..', '..', '.test-tmp-sqli');

function setup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

async function scanSource(fileName, source) {
  const testPath = setup();
  fs.mkdirSync(path.dirname(path.join(testPath, fileName)), { recursive: true });
  fs.writeFileSync(path.join(testPath, fileName), source);
  return scanForSqlInjection(testPath);
}

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

async function testConcatenationDetection() {
  const findings = await scanSource('db.js', `const query = 'SELECT * FROM users WHERE id = ' + userId;`);
  return report(
    'String concatenation detection',
    findings.length === 1 && findings[0].title.includes('Concatenation') && findings[0].line === 1,
    JSON.stringify(findings),
  );
}

async function testLowercaseSqlDetection() {
  const findings = await scanSource('db.js', `const q = "select id, name from users where name = '" + name + "'";`);
  return report('Lowercase SQL detection', findings.length === 1, JSON.stringify(findings));
}

async function testTemplateLiteralDetection() {
  const findings = await scanSource('db.js', 'db.query(`SELECT name FROM users WHERE email = \'${email}\'`);');
  return report(
    'Template literal detection',
    findings.length === 1 && findings[0].title.includes('Template'),
    JSON.stringify(findings),
  );
}

async function testUserInputInRouteUpgradesSeverity() {
  const findings = await scanSource('routes.js', [
    "app.get('/users/:id', (req, res) => {",
    "  db.query('SELECT * FROM users WHERE id = ' + req.params.id, (err, rows) => res.json(rows));",
    '});',
  ].join('\n'));
  const finding = findings[0];
  return report(
    'User input in route handler → critical',
    finding?.severity === 'critical'
      && finding.context.some((c) => c.includes('User input'))
      && finding.context.some((c) => c.includes('route handler'))
      && finding.context.length >= 3,
    JSON.stringify(finding),
  );
}

async function testNoUserInputStaysMedium() {
  const findings = await scanSource('report.js', `const sql = "DELETE FROM sessions WHERE user_id = " + userId;`);
  return report('No visible user input → medium', findings[0]?.severity === 'medium', JSON.stringify(findings[0]));
}

async function testEscapingDowngradesSeverity() {
  const findings = await scanSource('safe.js', [
    'const id = parseInt(req.query.id, 10);',
    "const sql = 'SELECT * FROM orders WHERE id = ' + id;",
  ].join('\n'));
  return report(
    'Numeric cast nearby → downgraded',
    findings[0]?.severity === 'medium' && findings[0].context.some((c) => c.includes('Escaping or numeric cast')),
    JSON.stringify(findings[0]),
  );
}

async function testConstantInterpolationIsLow() {
  const findings = await scanSource('pager.js', 'const sql = `SELECT * FROM posts LIMIT ${PAGE_SIZE}`;');
  return report('Constant interpolation → low', findings[0]?.severity === 'low', JSON.stringify(findings[0]));
}

async function testParameterizedQueryNotFlagged() {
  const findings = await scanSource('db.js', [
    "db.query('SELECT * FROM users WHERE id = ?', [userId]);",
    "pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, id]);",
  ].join('\n'));
  return report('Parameterized queries not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testNonSqlStringsNotFlagged() {
  const findings = await scanSource('app.js', [
    "app.use(express.raw());",
    "const msg = 'Please select an option from ' + menuName;",
    "const greeting = `Hello ${user.name}, update your profile`;",
    "request(app).get('/').query('/').expect(200);",
  ].join('\n'));
  return report('Non-SQL strings not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testCommentedCodeNotFlagged() {
  const findings = await scanSource('db.js', `// const query = 'SELECT * FROM users WHERE id = ' + userId;`);
  return report('Commented-out code not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testExampleFileContext() {
  const findings = await scanSource('examples/db.js', `const query = 'SELECT * FROM users WHERE id = ' + userId;`);
  return report(
    'Example file context factor',
    findings[0]?.context.some((c) => c.includes('test/example')),
    JSON.stringify(findings[0]),
  );
}

async function testSkipsNodeModules() {
  const findings = await scanSource('node_modules/orm/index.js', `const query = 'SELECT * FROM t WHERE id = ' + id;`);
  return report('Skips node_modules', findings.length === 0, JSON.stringify(findings));
}

async function runTests() {
  console.log('\n🧪 Running SQL injection tests...\n');

  const results = [];
  results.push(await testConcatenationDetection());
  results.push(await testLowercaseSqlDetection());
  results.push(await testTemplateLiteralDetection());
  results.push(await testUserInputInRouteUpgradesSeverity());
  results.push(await testNoUserInputStaysMedium());
  results.push(await testEscapingDowngradesSeverity());
  results.push(await testConstantInterpolationIsLow());
  results.push(await testParameterizedQueryNotFlagged());
  results.push(await testNonSqlStringsNotFlagged());
  results.push(await testCommentedCodeNotFlagged());
  results.push(await testExampleFileContext());
  results.push(await testSkipsNodeModules());

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
