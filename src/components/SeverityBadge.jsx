export const SEVERITY_STYLES = {
  critical: 'bg-red-100 text-red-800 ring-red-300',
  high: 'bg-orange-100 text-orange-800 ring-orange-300',
  medium: 'bg-amber-100 text-amber-800 ring-amber-300',
  low: 'bg-sky-100 text-sky-800 ring-sky-300',
  info: 'bg-gray-100 text-gray-700 ring-gray-300',
};

export default function SeverityBadge({ severity }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info}`}>
      {severity}
    </span>
  );
}
