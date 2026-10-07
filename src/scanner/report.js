/**
 * Runs every scanner against a target repo and assembles the report (PRD.md §3).
 * Used by the CLI (index.js) and the demo exporter (scripts/export-demo.js).
 */

import { scanDependencies } from './dependency-scanner.js';
import { scanPatterns } from './pattern-scanner.js';

export async function scanTarget(targetPath, { log = console.log, logError = console.error } = {}) {
  const findings = [];
  const scanErrors = [];

  // Dependency scanning
  try {
    const { findings: depFindings, errors: depErrors } = await scanDependencies(targetPath);
    findings.push(...depFindings);
    scanErrors.push(...depErrors);
    if (depFindings.length > 0) {
      log(`✓ Dependency scanning: ${depFindings.length} CVE(s) found`);
    } else {
      log('✓ Dependency scanning: no vulnerabilities');
    }
  } catch (error) {
    scanErrors.push(`Dependency scanning failed: ${error.message}`);
    logError(`✗ Dependency scanning failed: ${error.message}`);
  }

  // Pattern scanning
  try {
    const { findings: patternFindings, errors: patternErrors } = await scanPatterns(targetPath);
    findings.push(...patternFindings);
    // Stryker disable next-line all: patternErrors is only non-empty through a scanner bug (see pattern-scanner.js)
    scanErrors.push(...patternErrors);
    if (patternFindings.length > 0) {
      log(`✓ Pattern scanning: ${patternFindings.length} finding(s) detected`);
    } else {
      log('✓ Pattern scanning: no issues found');
    }
  } catch (error) {
    // Stryker disable all: reachable only if scanPatterns itself throws (it catches each scanner's error and returns it in `errors`), which no input does, so a test would have to inject a failing scanPatterns
    scanErrors.push(`Pattern scanning failed: ${error.message}`);
    logError(`✗ Pattern scanning failed: ${error.message}`);
  }
  // Stryker restore all

  // Compute summary
  const summary = {
    total: findings.length,
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };

  const report = {
    timestamp: new Date().toISOString(),
    targetPath,
    findings,
    coverage: {
      // Only categories with a scanner behind them count as checked
      checked: [
        'Dependency CVEs',
        'Hardcoded Secrets',
        'SQL Injection Patterns',
        'XSS Vulnerabilities',
        'Insecure Crypto Usage',
        'Async Footguns',
      ],
      checkedCount: 6,
      notYetChecked: [
        'CORS Misconfiguration',
        'Permission Creep',
        'Logging PII',
      ],
      findingsByType: {
        'dependency-cve': findings.filter((f) => f.type === 'dependency-cve').length,
        'hardcoded-secret': findings.filter((f) => f.type === 'hardcoded-secret').length,
        'sql-injection': findings.filter((f) => f.type === 'sql-injection').length,
        'xss': findings.filter((f) => f.type === 'xss').length,
        'crypto-misuse': findings.filter((f) => f.type === 'crypto-misuse').length,
        'async-footgun': findings.filter((f) => f.type === 'async-footgun').length,
      },
    },
    summary,
    ...(scanErrors.length > 0 && { errors: scanErrors }),
  };

  return report;
}
