import fs from 'fs';
import path from 'path';
import { runNpmAudit, parseAuditResults } from './npm-audit-client.js';

export async function scanDependencies(targetPath) {
  const findings = [];
  const errors = [];

  // Check if package.json exists
  const packageJsonPath = path.join(targetPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    errors.push('No package.json found. Skipping dependency scan.');
    return { findings, errors };
  }

  // Validate package.json is valid JSON
  let packageJson;
  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content);
  } catch (error) {
    errors.push(`Malformed package.json: ${error.message}`);
    return { findings, errors };
  }

  // Run npm audit
  try {
    const audit = runNpmAudit(targetPath, packageJson);
    const auditFindings = parseAuditResults(audit, packageJson);
    findings.push(...auditFindings);
  } catch (error) {
    errors.push(`Dependency scan failed: ${error.message}`);
  }

  return { findings, errors };
}
