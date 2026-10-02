import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import { normalizeReport } from './utils/findings.js';

// The scanner writes scanner-output.json to the directory it runs in; the dev server serves it from the repo root
const DEFAULT_REPORT_URL = '/scanner-output.json';

export default function App() {
  // status: loading → ready | empty (no report found) | error
  const [state, setState] = useState({ status: 'loading', report: null, error: null, source: null });

  useEffect(() => {
    let cancelled = false;

    async function loadDefaultReport() {
      try {
        const response = await fetch(DEFAULT_REPORT_URL);
        // Dev servers and static hosts answer a missing file with index.html (200), so check the type too
        const isJson = response.headers.get('content-type')?.includes('json');
        if (!response.ok || !isJson) {
          if (!cancelled) setState({ status: 'empty', report: null, error: null, source: null });
          return;
        }
        const report = normalizeReport(await response.json());
        if (!cancelled) setState({ status: 'ready', report, error: null, source: 'scanner-output.json' });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', report: null, error: `Couldn't read scanner-output.json: ${error.message}`, source: null });
      }
    }

    loadDefaultReport();
    return () => { cancelled = true; };
  }, []);

  async function loadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const report = normalizeReport(JSON.parse(await file.text()));
      setState({ status: 'ready', report, error: null, source: file.name });
    } catch (error) {
      setState((current) => ({ ...current, error: `Couldn't load ${file.name}: ${error.message}` }));
    }
  }

  const { status, report, error, source } = state;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Security Audit Platform</h1>
            <p className="text-gray-600 dark:text-gray-400">Findings scored by exploitability, not just pattern matches.</p>
            {report && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {report.targetPath && <>Target <span className="font-mono">{report.targetPath}</span> · </>}
                {report.timestamp && <>scanned {new Date(report.timestamp).toLocaleString()} · </>}
                <span className="whitespace-nowrap">{source}</span>
              </p>
            )}
          </div>
          <label className="cursor-pointer self-start rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm ring-1 ring-gray-300 hover:bg-gray-50 sm:self-auto dark:bg-gray-900 dark:ring-gray-700 dark:hover:bg-gray-800">
            Load scan file…
            <input type="file" accept=".json,application/json" onChange={loadFile} className="sr-only" />
          </label>
        </header>

        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900">{error}</p>}

        {status === 'loading' && <p className="py-12 text-center text-gray-500 dark:text-gray-400">Loading findings…</p>}

        {status === 'empty' && (
          <div className="rounded-lg bg-white py-12 text-center shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <p className="mb-2 text-gray-700 dark:text-gray-300">No scan data yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Run <code className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">npm run scan &lt;repo-path&gt;</code> from the repo root, then reload — or use “Load scan file…”.
            </p>
          </div>
        )}

        {status === 'ready' && <Dashboard key={source} report={report} />}
      </div>
    </div>
  );
}
