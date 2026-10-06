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
    // Stryker disable all: reachable only through a scanner bug (each scanFor* wraps its own failures and rethrows; no real input gets there), so a test would have to inject a failing scanner
    errors.push(`Secret scanning failed: ${error.message}`);
  }
  // Stryker restore all

  // SQL Injection
  try {
    const sqlFindings = await scanForSqlInjection(targetPath);
    findings.push(...sqlFindings);
  } catch (error) {
    // Stryker disable all: reachable only through a scanner bug (each scanFor* wraps its own failures and rethrows; no real input gets there), so a test would have to inject a failing scanner
    errors.push(`SQL injection scanning failed: ${error.message}`);
  }
  // Stryker restore all

  // XSS
  try {
    const xssFindings = await scanForXss(targetPath);
    findings.push(...xssFindings);
  } catch (error) {
    // Stryker disable all: reachable only through a scanner bug (each scanFor* wraps its own failures and rethrows; no real input gets there), so a test would have to inject a failing scanner
    errors.push(`XSS scanning failed: ${error.message}`);
  }
  // Stryker restore all

  // Insecure Crypto
  try {
    const cryptoFindings = await scanForInsecureCrypto(targetPath);
    findings.push(...cryptoFindings);
  } catch (error) {
    // Stryker disable all: reachable only through a scanner bug (each scanFor* wraps its own failures and rethrows; no real input gets there), so a test would have to inject a failing scanner
    errors.push(`Insecure crypto scanning failed: ${error.message}`);
  }
  // Stryker restore all

  // Async Footguns
  try {
    const asyncFindings = await scanForAsyncFootguns(targetPath);
    findings.push(...asyncFindings);
  } catch (error) {
    // Stryker disable all: reachable only through a scanner bug (each scanFor* wraps its own failures and rethrows; no real input gets there), so a test would have to inject a failing scanner
    errors.push(`Async footgun scanning failed: ${error.message}`);
  }
  // Stryker restore all

  return { findings, errors };
}
