import { CATEGORY_TYPES } from '../utils/findings.js';

// What the scan looked for, so "0 findings" reads as "checked and clean" rather than "never checked"
export default function CoverageReport({ coverage, typeCounts, errors }) {
  if (!coverage) return null;
  const notYetChecked = coverage.notYetChecked ?? [];

  return (
    <details className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <summary className="cursor-pointer font-semibold">
        Coverage: checked {coverage.checked.length} {coverage.checked.length === 1 ? 'category' : 'categories'}
        {notYetChecked.length > 0 && <span className="font-normal"> · {notYetChecked.length} not yet supported</span>}
        {errors?.length > 0 && <span className="font-normal text-red-700"> · {errors.length} scan {errors.length === 1 ? 'error' : 'errors'}</span>}
      </summary>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 font-medium">Checked</h3>
          <ul className="space-y-1">
            {coverage.checked.map((category) => {
              const count = typeCounts[CATEGORY_TYPES[category]] ?? 0;
              return (
                <li key={category} className="flex justify-between gap-4">
                  <span><span className="text-green-700">✓</span> {category}</span>
                  <span className="tabular-nums text-blue-700">{count === 0 ? 'clean' : `${count} found`}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {notYetChecked.length > 0 && (
          <div>
            <h3 className="mb-2 font-medium">Not yet checked</h3>
            <ul className="space-y-1 text-blue-700/70">
              {notYetChecked.map((category) => <li key={category}>– {category}</li>)}
            </ul>
          </div>
        )}
      </div>

      {errors?.length > 0 && (
        <div className="mt-4 rounded bg-red-50 p-3 text-red-800">
          <h3 className="mb-1 font-medium">Scan errors</h3>
          <ul className="list-disc pl-5">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}
    </details>
  );
}
