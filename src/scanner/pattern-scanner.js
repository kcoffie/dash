import { scanForSecrets } from './patterns/hardcoded-secrets.js';
import { scanForSqlInjection } from './patterns/sql-injection.js';
import { scanForXss } from './patterns/xss.js';
import { scanForInsecureCrypto } from './patterns/insecure-crypto.js';
import { scanForAsyncFootguns } from './patterns/async-footguns.js';

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

  // Insecure Crypto
  try {
    const cryptoFindings = await scanForInsecureCrypto(targetPath);
    findings.push(...cryptoFindings);
  } catch (error) {
    errors.push(`Insecure crypto scanning failed: ${error.message}`);
  }

  // Async Footguns
  try {
    const asyncFindings = await scanForAsyncFootguns(targetPath);
    findings.push(...asyncFindings);
  } catch (error) {
    errors.push(`Async footgun scanning failed: ${error.message}`);
  }

  return { findings, errors };
}
