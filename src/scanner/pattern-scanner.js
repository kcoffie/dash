import { scanForSecrets } from './patterns/hardcoded-secrets.js';

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

  // TODO: SQL Injection patterns (Task #2.2)
  // TODO: XSS patterns (Task #2.3)
  // TODO: Insecure Crypto patterns (Task #2.4)
  // TODO: Async Footguns patterns (Task #2.5)

  return { findings, errors };
}
