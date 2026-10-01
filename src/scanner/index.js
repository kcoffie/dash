#!/usr/bin/env node
/**
 * Security Audit Scanner
 * Scans a target repository for vulnerabilities:
 * - Dependency CVEs
 * - Hardcoded secrets
 * - Code patterns (SQL injection, XSS, etc.)
 */

import fs from 'fs';
import path from 'path';
import { scanDependencies } from './dependency-scanner.js';
import { scanPatterns } from './pattern-scanner.js';

const targetPath = process.argv[2];

if (!targetPath) {
  console.error('Usage: node src/scanner/index.js <target-repo-path>');
  process.exit(1);
}

if (!fs.existsSync(targetPath)) {
  console.error(`Error: Path not found: ${targetPath}`);
  process.exit(1);
}

async function scan() {
  const findings = [];
  const scanErrors = [];

  console.log(`\n🔍 Scanning ${targetPath}...\n`);

  // Dependency scanning
  try {
    const { findings: depFindings, errors: depErrors } = await scanDependencies(targetPath);
    findings.push(...depFindings);
    scanErrors.push(...depErrors);
    if (depFindings.length > 0) {
      console.log(`✓ Dependency scanning: ${depFindings.length} CVE(s) found`);
    } else {
      console.log('✓ Dependency scanning: no vulnerabilities');
    }
  } catch (error) {
    scanErrors.push(`Dependency scanning failed: ${error.message}`);
    console.error(`✗ Dependency scanning failed: ${error.message}`);
  }

  // Pattern scanning
  try {
    const { findings: patternFindings, errors: patternErrors } = await scanPatterns(targetPath);
    findings.push(...patternFindings);
    scanErrors.push(...patternErrors);
    if (patternFindings.length > 0) {
      console.log(`✓ Pattern scanning: ${patternFindings.length} finding(s) detected`);
    } else {
      console.log('✓ Pattern scanning: no issues found');
    }
  } catch (error) {
    scanErrors.push(`Pattern scanning failed: ${error.message}`);
    console.error(`✗ Pattern scanning failed: ${error.message}`);
  }

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
      checked: [
        'Dependency CVEs',
        'Hardcoded Secrets',
        'SQL Injection Patterns',
        'XSS Vulnerabilities',
        'Insecure Crypto Usage',
        'CORS Misconfiguration',
        'Async Footguns',
        'Permission Creep',
        'Logging PII',
      ],
      checkedCount: 9,
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

  const outputPath = 'scanner-output.json';
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to ${outputPath}`);
  console.log(`\n📊 Summary: ${summary.total} finding(s)`);
  if (summary.critical > 0) console.log(`   🔴 Critical: ${summary.critical}`);
  if (summary.high > 0) console.log(`   🟠 High: ${summary.high}`);
  if (summary.medium > 0) console.log(`   🟡 Medium: ${summary.medium}`);
  if (summary.low > 0) console.log(`   🟢 Low: ${summary.low}`);
  console.log();
}

scan().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
