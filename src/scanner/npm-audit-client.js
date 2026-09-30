import { execSync } from 'child_process';
import path from 'path';

export async function runNpmAudit(targetPath) {
  try {
    const output = execSync(`cd "${targetPath}" && npm audit --json`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } catch (error) {
    // npm audit exits with non-zero when vulnerabilities found
    // Attempt to parse stderr output
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        throw new Error(`Failed to parse npm audit output: ${error.message}`);
      }
    }
    throw error;
  }
}

export function parseAuditResults(auditData, targetPath) {
  const findings = [];
  const seen = new Set();

  if (!auditData.vulnerabilities || Object.keys(auditData.vulnerabilities).length === 0) {
    return findings;
  }

  Object.entries(auditData.vulnerabilities).forEach(([packageName, vulnData]) => {
    if (Array.isArray(vulnData.via)) {
      vulnData.via.forEach((vuln) => {
        // Skip string references (e.g., "qs") and only process objects
        if (typeof vuln === 'object' && vuln.title) {
          const findingId = `${packageName}-${vuln.source || vuln.url}`;
          if (!seen.has(findingId)) {
            seen.add(findingId);
            findings.push({
              id: vuln.source || vuln.url?.split('/').pop() || `npm-${packageName}`,
              type: 'dependency-cve',
              title: vuln.title,
              severity: mapSeverity(vuln.severity),
              confidence: 0.95,
              description: vuln.description || 'Known vulnerability in dependency',
              package: packageName,
              packageVersion: vulnData.installed,
              patchedVersions: vuln.fixed || vulnData.fixAvailable?.version || 'Unknown',
              file: 'package.json',
              line: null,
              context: [
                `✓ Vulnerable dependency detected: ${packageName}@${vulnData.installed}`,
                `⚠ Severity: ${vuln.severity}`,
                `✓ Vulnerability: ${vuln.title}`,
                vulnData.fixAvailable ? `✓ Fix available: upgrade to ${vulnData.fixAvailable.version}` : '⚠ No automatic fix',
              ],
              remediation: `Update ${packageName} to ${vulnData.fixAvailable?.version || 'latest version'}. See ${vuln.url} for details.`,
              references: vuln.url ? [vuln.url] : [],
              tags: ['dependency', 'npm-audit', vuln.cwe?.[0] || 'vulnerability'],
            });
          }
        }
      });
    }
  });

  return findings;
}

function mapSeverity(npmSeverity) {
  const severityMap = {
    critical: 'critical',
    high: 'high',
    moderate: 'medium',
    low: 'low',
    info: 'info',
  };
  return severityMap[npmSeverity?.toLowerCase()] || 'medium';
}
