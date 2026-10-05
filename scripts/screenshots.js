#!/usr/bin/env node
/**
 * Captures the README screenshots under docs/screenshots/ from a running dashboard.
 * Drives headless Chrome over the DevTools protocol (no extra dependencies), so the
 * color scheme and viewport are exact.
 *
 * Usage: npm run screenshots [-- <url>]   (default: the live deploy)
 * Set CHROME to the Chrome binary if it isn't at the macOS default path.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const url = process.argv[2] ?? 'https://dash-jade-nine.vercel.app/';
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'screenshots');
const port = 9333;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Separate profile so a running Chrome doesn't lock it
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-shots-'));
const chrome = spawn(chromePath, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const watchdog = setTimeout(() => fail(new Error('timed out after 90s')), 90000);

function fail(error) {
  console.error(`screenshots: ${error.message}`);
  chrome.kill('SIGKILL');
  process.exit(1);
}

async function connect() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting
    }
    await sleep(200);
  }
  throw new Error('could not reach headless Chrome');
}

async function main() {
  const ws = new WebSocket(await connect());
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

  async function load(scheme, width, height) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 500 });
    await send('Page.navigate', { url });
    // The findings count ("138 of 138") appears once a report has loaded
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(String.raw`/\d+ of \d+/.test(document.body.innerText)`)) break;
      await sleep(200);
    }
    await sleep(800);
  }

  async function capture(name, clip) {
    const params = { format: 'png' };
    if (clip) Object.assign(params, { clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    const { data } = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`wrote docs/screenshots/${name}.png`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  await send('Page.enable');

  for (const scheme of ['light', 'dark']) {
    await load(scheme, 1280, 900);
    await capture(`dashboard-${scheme}`);
  }

  // The Juice Shop login SQL injection, expanded to show "Why this severity"
  await load('light', 1280, 900);
  const rect = await evaluate(`(async () => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes('routes/login.ts:34'));
    if (!row) return null;
    row.querySelector('button[aria-expanded]').click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const top = row.getBoundingClientRect();
    const bottom = row.nextElementSibling.getBoundingClientRect();
    const table = row.closest('table').getBoundingClientRect();
    return { x: table.left + scrollX - 8, y: top.top + scrollY - 8, width: table.width + 16, height: bottom.bottom - top.top + 16 };
  })()`);
  if (!rect) throw new Error('routes/login.ts:34 not found; is the Juice Shop demo the default?');
  await capture('finding-details', rect);

  await load('dark', 390, 844);
  await capture('phone-dark');

  ws.close();
}

main()
  .then(async () => {
    clearTimeout(watchdog);
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await exited; // Chrome writes to its profile until it exits
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  })
  .catch(fail);
