import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const [input, ...flags] = process.argv.slice(2);
const usage = 'Usage: node electron/scripts/verify-mac-app.mjs <app-path> [--smoke] [--screenshot <png-path>]';
let screenshot, launch = false;
if (!input) throw new Error(usage);
for (let index = 0; index < flags.length; index++) {
  if (flags[index] === '--smoke') launch = true;
  else if (flags[index] === '--screenshot' && flags[index + 1] && !flags[index + 1].startsWith('--')) screenshot = flags[++index];
  else throw new Error(usage);
}
if (screenshot && !launch) throw new Error('--screenshot requires --smoke.');
if (process.platform !== 'darwin') throw new Error('Packaged app verification requires macOS.');
const appPath = await fs.realpath(input);
await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
console.log('PASS: app and nested code signatures are valid.');
// This verifies integrity, not Developer ID trust or Apple notarization.
if (launch) await smoke();

async function smoke() {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const property = async key => (await exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
  const executable = await property('CFBundleExecutable');
  assert.equal(path.basename(executable), executable);
  const version = await property('CFBundleShortVersionString');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'finder-packaged-smoke-'));
  let child, socket, exited, exitInfo, spawnError, output = '';
  try {
    const profile = path.join(root, 'profile'), photos = path.join(root, 'photos');
    await fs.mkdir(profile); await fs.mkdir(photos);
    await fs.writeFile(path.join(photos, 'A.NEF'), 'reference fixture');
    await fs.writeFile(path.join(photos, 'B.JPG'), 'orphan fixture');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_NO_ASAR;
    child = spawn(path.join(appPath, 'Contents', 'MacOS', executable), [
      `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', error => { spawnError = error; });
    exited = new Promise(resolve => child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data.toString()).slice(-16000); });
    async function waitFor(fn, label) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (exitInfo) throw new Error(`Packaged app exited before ${label}: ${JSON.stringify(exitInfo)}`);
        const result = await fn();
        if (result) return result;
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${label}.`);
    }
    const port = await waitFor(async () => {
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) return match[1];
      try { return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }, 'the isolated debugger');
    assert.match(port, /^\d+$/);
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
      return (await response.json()).find(page => page.type === 'page' && page.url === 'finder-sync://app/index.html');
    }, 'the application window');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await once(socket, 'open', { signal: AbortSignal.timeout(10000) });
    let sequence = 0;
    const exceptions = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    });
    const request = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const cleanup = () => { clearTimeout(timer); socket.removeEventListener('message', receive); };
      const receive = event => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        cleanup();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`${method} timed out.`)); }, 10000);
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.result?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    await request('Runtime.enable'); await request('Page.enable');
    await waitFor(() => evaluate(`document.readyState === 'complete' && !!window.finder &&
      !!document.querySelector('main.workspace nav, aside.sidebar nav') &&
      document.querySelectorAll('aside.sidebar nav button:not(:disabled)').length === 5`), 'the loaded React interface');
    assert.equal(await evaluate('window.finder.version()'), version);
    assert.equal(await evaluate('window.finder.history().then(records => records.length)'), 0);
    assert.equal(await evaluate("document.querySelectorAll('[role=alert]').length"), 0);
    const config = { mode: 'orphans', mixed: true, base: photos, targets: [], referenceExt: 'NEF', recursive: false };
    const plan = await evaluate(`window.finder.preview(${JSON.stringify(config)})`);
    assert.equal(plan.candidates, 1);
    assert.equal(plan.rows.find(row => row.candidate).name, 'B.JPG');
    await evaluate('window.finder.discard()');
    const filterConfig = { mode: 'filter', targets: [photos], nameRegex: '\\.jpg$', ignoreCase: true };
    const filtered = await evaluate(`window.finder.preview(${JSON.stringify(filterConfig)})`);
    assert.equal(filtered.candidates, 1);
    assert.equal(filtered.rows.find(row => row.candidate).name, 'B.JPG');
    await evaluate('window.finder.discard()');
    assert.deepEqual(await fs.readdir(photos), ['A.NEF', 'B.JPG']);
    assert.deepEqual(exceptions, []);
    if (screenshot) {
      const { data } = await request('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(screenshot, Buffer.from(data, 'base64'));
    }
    console.log(`PASS: packaged ${version} launches, renders React, connects IPC and previews fixture files without changing them.`);
  } catch (error) {
    if (output) console.error(output);
    throw error;
  } finally {
    socket?.close();
    if (child?.pid && !exitInfo) {
      child.kill('SIGTERM');
      await Promise.race([exited, delay(5000)]);
      if (!exitInfo) { child.kill('SIGKILL'); await exited; }
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}
