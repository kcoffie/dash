import { SEVERITIES, typeLabel } from '../utils/findings.js';

const INPUT = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200';

export default function FilterBar({ filters, onChange, types, shown, total }) {
  const update = (field) => (event) => onChange({ ...filters, [field]: event.target.value });
  const isFiltered = filters.query || filters.severity !== 'all' || filters.type !== 'all';

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <input
        type="search"
        placeholder="Search title, file, code, package…"
        aria-label="Search findings"
        value={filters.query}
        onChange={update('query')}
        className={`${INPUT} sm:flex-1`}
      />
      <select aria-label="Filter by severity" value={filters.severity} onChange={update('severity')} className={INPUT}>
        <option value="all">All severities</option>
        {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity[0].toUpperCase() + severity.slice(1)}</option>)}
      </select>
      <select aria-label="Filter by type" value={filters.type} onChange={update('type')} className={INPUT}>
        <option value="all">All types</option>
        {types.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
      </select>
      <div className="flex items-center gap-3 text-sm text-gray-600 sm:ml-2">
        <span className="whitespace-nowrap tabular-nums">{shown} of {total}</span>
        {isFiltered && (
          <button type="button" onClick={() => onChange({ query: '', severity: 'all', type: 'all' })} className="text-blue-700 hover:underline">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
