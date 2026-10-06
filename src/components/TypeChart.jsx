import { SEVERITIES, severityByType, typeLabel } from '../utils/findings.js';
import { SEVERITY_FILLS } from './severity-styles.js';

const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

// Horizontal bars, one per finding type, split by severity. Clicking a type or a segment filters the table.
export default function TypeChart({ findings, filters, onSelect }) {
  const rows = severityByType(findings);
  if (rows.length === 0) return null;

  const max = rows[0].total;
  const legend = SEVERITIES.filter((severity) => rows.some((row) => row.segments.some((segment) => segment.severity === severity)));

  const toggle = (type, severity) => {
    const isSelected = filters.type === type && filters.severity === severity;
    onSelect(isSelected ? { type: 'all', severity: 'all' } : { type, severity });
  };

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200 sm:p-6 dark:bg-gray-900 dark:ring-gray-800">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="font-semibold">Findings by type</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400" aria-label="Severity legend">
          {legend.map((severity) => (
            <li key={severity} className="flex items-center gap-1.5">
              <span className={`inline-block h-3 w-3 rounded-sm ${SEVERITY_FILLS[severity]}`} aria-hidden="true" />
              {capitalize(severity)}
            </li>
          ))}
        </ul>
      </div>

      <ul className="space-y-3 sm:space-y-1">
        {rows.map(({ type, total, segments }) => {
          const label = typeLabel(type);
          const dimRow = filters.type !== 'all' && filters.type !== type;
          return (
            <li key={type} className={`grid items-center gap-x-3 sm:grid-cols-[10rem_1fr] ${dimRow ? 'opacity-40' : ''}`}>
              <button
                type="button"
                onClick={() => onSelect({ type: filters.type === type && filters.severity === 'all' ? 'all' : type, severity: 'all' })}
                className="truncate text-left text-sm text-gray-700 hover:text-blue-700 sm:text-right dark:text-gray-300 dark:hover:text-blue-400"
              >
                {label}
              </button>
              {/* Right padding reserves room for the total label, so the longest bar's label never overflows */}
              <div className="flex items-center gap-[2px] pr-12">
                {segments.map(({ severity, count }, index) => {
                  const dimSegment = filters.severity !== 'all' && filters.severity !== severity;
                  const isLast = index === segments.length - 1;
                  return (
                    <button
                      key={severity}
                      type="button"
                      onClick={() => toggle(type, severity)}
                      aria-label={`${label}: ${count} ${severity}. Filter the table to these.`}
                      style={{ width: `${(count / max) * 100}%` }}
                      className="group relative flex h-7 min-w-1 items-center focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
                    >
                      <span className={`block h-5 w-full transition group-hover:brightness-110 ${SEVERITY_FILLS[severity] ?? SEVERITY_FILLS.info} ${isLast ? 'rounded-r' : ''} ${dimSegment ? 'opacity-30' : ''}`} />
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-gray-300 shadow-lg group-hover:block group-focus-visible:block dark:bg-gray-700 dark:text-gray-200"
                      >
                        <strong className="text-white">{count}</strong> {severity} · {label}
                      </span>
                    </button>
                  );
                })}
                <span className="ml-1.5 shrink-0 text-sm font-medium text-gray-700 dark:text-gray-300" aria-label={`${total} total`}>{total}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
