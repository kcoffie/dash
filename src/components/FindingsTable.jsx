import { Fragment, useState } from 'react';
import SeverityBadge from './SeverityBadge.jsx';
import FindingDetails from './FindingDetails.jsx';
import { location, typeLabel } from '../utils/findings.js';

// rows: [{ key, domId, finding }] — keys are assigned on the unfiltered list so expanded rows survive filtering
export default function FindingsTable({ rows }) {
  const [expanded, setExpanded] = useState(() => new Set());

  const toggle = (key) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (rows.length === 0) {
    return <p className="py-12 text-center text-gray-500 dark:text-gray-400">No findings match these filters.</p>;
  }

  return (
    <table className="w-full table-fixed text-left text-sm">
      <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <tr>
          <th className="w-24 py-2 pr-3 font-medium">Severity</th>
          <th className="py-2 pr-3 font-medium">Finding</th>
          <th className="hidden w-2/5 py-2 pr-3 font-medium md:table-cell">Location</th>
          <th className="hidden w-24 py-2 text-right font-medium sm:table-cell">Confidence</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, domId, finding }) => {
          const isOpen = expanded.has(key);
          const detailsId = `${domId}-details`;
          return (
            <Fragment key={key}>
              <tr
                onClick={() => toggle(key)}
                className={`cursor-pointer border-b border-gray-100 align-top hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60 ${isOpen ? 'bg-gray-50 dark:bg-gray-800/60' : ''}`}
              >
                <td className="py-3 pr-3"><SeverityBadge severity={finding.severity} /></td>
                <td className="py-3 pr-3">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={detailsId}
                    onClick={(event) => { event.stopPropagation(); toggle(key); }}
                    className="text-left font-medium text-gray-900 hover:text-blue-700 dark:text-gray-100 dark:hover:text-blue-400"
                  >
                    <span className="mr-1 inline-block w-3 text-gray-400 dark:text-gray-500">{isOpen ? '▾' : '▸'}</span>
                    {finding.title}
                  </button>
                  <div className="ml-4 text-xs text-gray-500 dark:text-gray-400">{typeLabel(finding.type)}</div>
                  {/* On small screens the location column is hidden, so show it under the title */}
                  <div className="ml-4 break-all font-mono text-xs text-gray-500 md:hidden dark:text-gray-400">{location(finding)}</div>
                </td>
                <td className="hidden break-all py-3 pr-3 font-mono text-xs text-gray-600 md:table-cell dark:text-gray-400">{location(finding)}</td>
                <td className="hidden py-3 text-right tabular-nums text-gray-600 sm:table-cell dark:text-gray-400">
                  {typeof finding.confidence === 'number' ? `${Math.round(finding.confidence * 100)}%` : '—'}
                </td>
              </tr>
              {isOpen && (
                <tr id={detailsId} className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60">
                  <td colSpan={4} className="px-4 pb-5 pt-1 sm:pl-28">
                    <FindingDetails finding={finding} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
