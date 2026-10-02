import { useMemo, useState } from 'react';
import SummaryCards from '../components/SummaryCards.jsx';
import TypeChart from '../components/TypeChart.jsx';
import CoverageReport from '../components/CoverageReport.jsx';
import FilterBar from '../components/FilterBar.jsx';
import FindingsTable from '../components/FindingsTable.jsx';
import {
  sortFindings, filterFindings, findingKey, countBySeverity, countByType,
} from '../utils/findings.js';

/**
 * Contextual Scoring Model:
 * Don't just flag a pattern. Score exploitability based on context:
 * - "SQL injection pattern found" (medium) vs
 * - "SQL injection pattern found AND no input sanitization AND endpoint is public API" (critical)
 * Each finding's context factors explain its severity; they're shown when a row is expanded.
 */
export default function Dashboard({ report }) {
  const [filters, setFilters] = useState({ query: '', severity: 'all', type: 'all' });

  const rows = useMemo(
    () => sortFindings(report.findings).map((finding, index) => ({
      key: findingKey(finding, index),
      domId: `finding-${index}`,
      finding,
    })),
    [report.findings],
  );
  const severityCounts = useMemo(() => countBySeverity(report.findings), [report.findings]);
  const typeCounts = useMemo(() => countByType(report.findings), [report.findings]);
  const types = Object.keys(typeCounts).sort();

  const visibleFindings = new Set(filterFindings(report.findings, filters));
  const visibleRows = rows.filter((row) => visibleFindings.has(row.finding));

  return (
    <div className="space-y-6">
      <SummaryCards
        counts={severityCounts}
        selected={filters.severity}
        onSelect={(severity) => setFilters({ ...filters, severity })}
      />
      <TypeChart
        findings={report.findings}
        filters={filters}
        onSelect={(selection) => setFilters({ ...filters, ...selection })}
      />
      <CoverageReport coverage={report.coverage} typeCounts={typeCounts} errors={report.errors} />
      <section className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200 sm:p-6 dark:bg-gray-900 dark:ring-gray-800">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          types={types}
          shown={visibleRows.length}
          total={rows.length}
        />
        <div className="mt-4">
          <FindingsTable rows={visibleRows} />
        </div>
      </section>
    </div>
  );
}
