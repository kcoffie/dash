import { scanForSecrets } from './patterns/hardcoded-secrets.js';
import { scanForSqlInjection } from './patterns/sql-injection.js';
import { scanForXss } from './patterns/xss.js';

export async function scanPatterns(targetPath) {
  const findings = [];
  const errors = [];

  // Hardcoded Secrets
  try {
    const secretFindings = await scanForSecrets(targetPath);
    findings.push(...secretFindings);
  } catch (error) {
    errors.push(`Secret scanning failed: ${error.message}`);
  }

  // SQL Injection
  try {
    const sqlFindings = await scanForSqlInjection(targetPath);
    findings.push(...sqlFindings);
  } catch (error) {
    errors.push(`SQL injection scanning failed: ${error.message}`);
  }

  // XSS
  try {
    const xssFindings = await scanForXss(targetPath);
    findings.push(...xssFindings);
  } catch (error) {
    errors.push(`XSS scanning failed: ${error.message}`);
  }

  // TODO: Insecure Crypto patterns (Task #2.4)
  // TODO: Async Footguns patterns (Task #2.5)

  return { findings, errors };
}
