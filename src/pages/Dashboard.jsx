import React, { useState } from 'react';

/**
 * Contextual Scoring Model:
 * Don't just flag a pattern. Score exploitability based on context:
 * - "SQL injection pattern found" (medium) vs
 * - "SQL injection pattern found AND no input sanitization AND endpoint is public API" (critical)
 */

export default function Dashboard({ findings, loading }) {
  const [severity, setSeverity] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCoverage, setShowCoverage] = useState(false);

  const filtered = findings.filter(f => {
    const matchesSeverity = severity === 'all' || f.severity === severity;
    const matchesSearch = f.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         f.description?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSeverity && matchesSearch;
  });

  const getSeverityColor = (sev) => {
    const colors = {
      critical: 'bg-red-100 text-red-900 border-red-300',
      high: 'bg-orange-100 text-orange-900 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-900 border-yellow-300',
      low: 'bg-blue-100 text-blue-900 border-blue-300',
      info: 'bg-gray-100 text-gray-900 border-gray-300',
    };
    return colors[sev] || 'bg-gray-100';
  };

  // Example coverage data (will come from scanner)
  const coverage = {
    checked: [
      'Hardcoded Secrets',
      'SQL Injection Patterns',
      'XSS Vulnerabilities',
      'Insecure Crypto Usage',
      'CORS Misconfiguration',
      'Async Footguns (unhandled promises)',
      'Permission Creep (overgrantinig access)',
      'Logging PII',
      'Dependency CVEs',
    ],
    found: findings.length,
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <header className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Security Audit Platform</h1>
        <p className="text-gray-600">Real vulnerability scanner. Contextual scoring to reduce noise.</p>
      </header>

      {/* Coverage Report */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
        <button
          onClick={() => setShowCoverage(!showCoverage)}
          className="flex items-center gap-2 font-semibold text-blue-900 hover:text-blue-700"
        >
          <span>{showCoverage ? '▼' : '▶'}</span>
          Coverage Report
        </button>
        {showCoverage && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-blue-800 font-medium">
              ✅ Checked for {coverage.checked.length} vulnerability types:
            </p>
            <ul className="grid grid-cols-2 gap-2 text-sm text-blue-800">
              {coverage.checked.map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-green-600">✓</span> {item}
                </li>
              ))}
            </ul>
            <p className="text-sm text-blue-800 mt-4 font-medium">
              🔍 Found: {coverage.found} {coverage.found === 1 ? 'finding' : 'findings'}
            </p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <input
            type="text"
            placeholder="Search findings..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600">Loading findings...</p>
          </div>
        ) : findings.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-2">No scan data yet</p>
            <p className="text-sm text-gray-500">Run: <code className="bg-gray-100 px-2 py-1">npm run scan &lt;repo-path&gt;</code></p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-gray-600 mb-4">
              Showing {filtered.length} of {findings.length} findings
            </div>
            {filtered.map((finding, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border ${getSeverityColor(finding.severity)}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold">{finding.title}</h3>
                  <span className="px-3 py-1 rounded-full text-sm font-medium uppercase">
                    {finding.severity}
                  </span>
                </div>
                <p className="mb-3">{finding.description}</p>

                {/* Contextual Scoring: Show exploitability factors */}
                {finding.context && (
                  <div className="bg-black/10 rounded p-3 mb-3 text-sm">
                    <p className="font-medium mb-2">Exploitability Factors:</p>
                    <ul className="space-y-1 ml-4">
                      {finding.context.map((factor, i) => (
                        <li key={i}>• {factor}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {finding.file && (
                  <p className="text-sm opacity-75 mb-2">
                    <span className="font-mono">{finding.file}</span>
                    {finding.line && ` (line ${finding.line})`}
                  </p>
                )}
                {finding.remediation && (
                  <details className="mt-3 cursor-pointer">
                    <summary className="font-medium hover:underline">How to fix</summary>
                    <p className="mt-2 text-sm">{finding.remediation}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
