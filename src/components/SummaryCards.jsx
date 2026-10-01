import { SEVERITIES } from '../utils/findings.js';
import { SEVERITY_STYLES } from './SeverityBadge.jsx';

// One card per severity; clicking a card filters the table to that severity (click again to clear)
export default function SummaryCards({ counts, selected, onSelect }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {SEVERITIES.map((severity) => {
        const isSelected = selected === severity;
        return (
          <button
            key={severity}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? 'all' : severity)}
            className={`rounded-lg p-4 text-left ring-1 ring-inset transition ${SEVERITY_STYLES[severity]} ${isSelected ? 'ring-2 shadow-md' : 'opacity-90 hover:opacity-100'}`}
          >
            <div className="text-3xl font-bold tabular-nums">{counts[severity]}</div>
            <div className="text-sm font-medium capitalize">{severity}</div>
          </button>
        );
      })}
    </div>
  );
}
