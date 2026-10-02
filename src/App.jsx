import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import { normalizeReport, normalizeDemoManifest, sourceLink } from './utils/findings.js';

// The scanner writes scanner-output.json to the directory it runs in; the dev server serves it from the repo root.
// Deployed builds have no local report and fall back to the committed demo scans (npm run demo:export).
const LOCAL_REPORT_URL = '/scanner-output.json';
const DEMO_DIR = '/demo';

// Dev servers and static hosts answer a missing file with index.html (200), so a non-JSON response means "not there"
async function fetchJson(url) {
  const response = await fetch(url);
  const isJson = response.headers.get('content-type')?.includes('json');
  return response.ok && isJson ? response.json() : null;
}

export default function App() {
  // status: loading → ready | empty (no report found) | error
  const [state, setState] = useState({ status: 'loading', report: null, error: null, source: null });
  const [demos, setDemos] = useState([]);
  const [demoId, setDemoId] = useState(''); // '' when showing a local or uploaded report

  async function loadDemo(demo, isCancelled = () => false) {
    try {
      const data = await fetchJson(`${DEMO_DIR}/${demo.file}`);
      if (!data) throw new Error('file not found');
      const report = normalizeReport(data);
      if (isCancelled()) return;
      setState({ status: 'ready', report, error: null, source: `demo: ${demo.label}` });
      setDemoId(demo.id);
    } catch (error) {
      if (!isCancelled()) setState((current) => ({ ...current, status: current.report ? 'ready' : 'error', error: `Couldn't load the ${demo.label} demo: ${error.message}` }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    async function loadInitialReport() {
      // A missing or broken manifest just means no demo picker
      const manifest = await fetchJson(`${DEMO_DIR}/index.json`).catch(() => null);
      const demoScans = normalizeDemoManifest(manifest);
      if (!cancelled) setDemos(demoScans);

      try {
        const local = await fetchJson(LOCAL_REPORT_URL);
        if (local) {
          const report = normalizeReport(local);
          if (!cancelled) setState({ status: 'ready', report, error: null, source: 'scanner-output.json' });
          return;
        }
      } catch (error) {
        if (!cancelled) setState({ status: 'error', report: null, error: `Couldn't read scanner-output.json: ${error.message}`, source: null });
        return;
      }

      if (demoScans.length > 0) await loadDemo(demoScans[0], isCancelled);
      else if (!cancelled) setState({ status: 'empty', report: null, error: null, source: null });
    }

    loadInitialReport();
    return () => { cancelled = true; };
  }, []);

  async function loadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const report = normalizeReport(JSON.parse(await file.text()));
      setState({ status: 'ready', report, error: null, source: file.name });
      setDemoId('');
    } catch (error) {
      setState((current) => ({ ...current, error: `Couldn't load ${file.name}: ${error.message}` }));
    }
  }

  const { status, report, error, source } = state;
  const scanned = sourceLink(report);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Security Audit Platform</h1>
            <p className="text-gray-600 dark:text-gray-400">Findings scored by exploitability, not just pattern matches.</p>
            {report && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {scanned && (
                  <>Target <a href={scanned.href} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-700 hover:underline dark:text-blue-400">{scanned.label}</a> · </>
                )}
                {!scanned && report.targetPath && <>Target <span className="font-mono">{report.targetPath}</span> · </>}
                {report.timestamp && <>scanned {new Date(report.timestamp).toLocaleString()} · </>}
                <span className="whitespace-nowrap">{source}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3 self-start sm:self-auto">
            {demos.length > 0 && (
              <select
                aria-label="Demo scan"
                value={demoId}
                onChange={(event) => {
                  const demo = demos.find((scan) => scan.id === event.target.value);
                  if (demo) loadDemo(demo);
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-blue-900"
              >
                {demoId === '' && <option value="">Demo scans…</option>}
                {demos.map((demo) => <option key={demo.id} value={demo.id}>{demo.label}{typeof demo.total === 'number' ? ` (${demo.total} findings)` : ''}</option>)}
              </select>
            )}
            <label className="cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm ring-1 ring-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:ring-gray-700 dark:hover:bg-gray-800">
              Load scan file…
              <input type="file" accept=".json,application/json" onChange={loadFile} className="sr-only" />
            </label>
          </div>
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
