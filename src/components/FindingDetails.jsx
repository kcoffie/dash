import { parseFactor, isSafeUrl } from '../utils/findings.js';

const FACTOR_STYLES = {
  evidence: { icon: '✓', className: 'text-red-700', label: 'Evidence' },
  warning: { icon: '⚠', className: 'text-amber-700', label: 'Note' },
  unknown: { icon: '?', className: 'text-gray-500', label: 'Unknown' },
  note: { icon: '•', className: 'text-gray-500', label: 'Note' },
};

// Expanded view of one finding: why it was scored this way and how to fix it
export default function FindingDetails({ finding }) {
  const references = (finding.references ?? []).filter(isSafeUrl);

  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-700">{finding.description}</p>

      {finding.snippet && (
        <pre className="overflow-x-auto rounded bg-gray-900 p-3 font-mono text-xs text-gray-100"><code>{finding.snippet}</code></pre>
      )}

      {finding.context?.length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold text-gray-900">
            Why this severity
            {typeof finding.confidence === 'number' && (
              <span className="font-normal text-gray-500"> · {Math.round(finding.confidence * 100)}% confidence</span>
            )}
          </h4>
          <ul className="space-y-1">
            {finding.context.map((factor) => {
              const { kind, text } = parseFactor(factor);
              const style = FACTOR_STYLES[kind];
              return (
                <li key={factor} className="flex gap-2">
                  <span className={`w-4 shrink-0 text-center font-bold ${style.className}`} aria-label={style.label}>{style.icon}</span>
                  <span className="text-gray-700">{text}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {finding.remediation && (
        <section className="rounded border border-green-200 bg-green-50 p-3">
          <h4 className="mb-1 font-semibold text-green-900">How to fix</h4>
          <p className="whitespace-pre-wrap text-green-900">{finding.remediation}</p>
        </section>
      )}

      {(references.length > 0 || finding.tags?.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {references.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline hover:text-blue-900">
              {new URL(url).hostname}
            </a>
          ))}
          {finding.tags?.map((tag) => (
            <span key={tag} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
