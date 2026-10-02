export const SEVERITY_STYLES = {
  critical: 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
  high: 'bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800',
  medium: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
  low: 'bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800',
  info: 'bg-gray-100 text-gray-700 ring-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600',
};

// Solid fills for chart marks. Checked with the dataviz palette validator (adjacent pairs, CVD + normal vision)
// against white and gray-900; the light amber/orange sit below 3:1 on white, so the chart always labels values.
export const SEVERITY_FILLS = {
  critical: 'bg-red-700 dark:bg-red-500',
  high: 'bg-orange-500 dark:bg-orange-400',
  medium: 'bg-amber-400 dark:bg-amber-300',
  low: 'bg-sky-600 dark:bg-sky-400',
  info: 'bg-gray-400 dark:bg-gray-500',
};

export default function SeverityBadge({ severity }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info}`}>
      {severity}
    </span>
  );
}
