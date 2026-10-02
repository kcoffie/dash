import { summarySeverities } from '../utils/findings.js';
import { SEVERITY_STYLES } from './SeverityBadge.jsx';

// One card per severity; clicking a card filters the table to that severity (click again to clear)
export default function SummaryCards({ counts, selected, onSelect }) {
  const severities = summarySeverities(counts, selected);
  // Four cards: 2×2 on phones. Five: 3 + 2 on phones (a 6-column grid) rather than a lone fifth card.
  const fiveUp = severities.length === 5;

  return (
    <div className={`grid gap-3 ${fiveUp ? 'grid-cols-6 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {severities.map((severity, index) => {
        const isSelected = selected === severity;
        const span = fiveUp ? `${index < 3 ? 'col-span-2' : 'col-span-3'} sm:col-span-1` : '';
        return (
          <button
            key={severity}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? 'all' : severity)}
            className={`${span} rounded-lg p-4 text-left ring-1 ring-inset transition ${SEVERITY_STYLES[severity]} ${isSelected ? 'ring-2 shadow-md' : 'opacity-90 hover:opacity-100'}`}
          >
            <div className="text-3xl font-bold">{counts[severity]}</div>
            <div className="text-sm font-medium capitalize">{severity}</div>
          </button>
        );
      })}
    </div>
  );
}
