import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareFolderFiles } from '../../src/compare.js';
import { DesktopService } from '../service.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'finder-cross-state-')));
  const target = path.join(root, 'target');
  await fs.mkdir(target);
  const file = path.join(target, 'photo.jpg');
  await fs.writeFile(file, 'fixture only');
  const tags = new Map(), writes = [], progress = [];
  const service = new DesktopService({
    tempRoot: root,
    readTags: async file => tags.get(file) ?? [],
    writeTags: async (file, values) => { writes.push({ file, tags: [...values] }); tags.set(file, [...values]); },
    trash: async () => assert.fail('The audit must never move files to Trash'),
    onProgress: value => progress.push(value),
  });
  t.after(async () => { await service.discardAll(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, target, file, service, progress, writes };
}

test('native confirmation announces its own phase before awaiting the answer', async t => {
  const f = await fixture(t);
  const plan = await f.service.preview({ mode: 'filter', targets: [f.target], filterAction: 'tags', colors: ['green'] });
  f.progress.length = 0;
  const result = await f.service.execute(plan.id, [plan.rows[0].id], {
    confirm: async () => {
      assert.deepEqual(f.progress.map(value => value.phase), ['confirm']);
      assert.equal(f.progress.at(-1).detail.key, 'progress.confirm');
      assert.equal(f.progress.at(-1).total, 1);
      return false;
    },
  });
  assert.deepEqual(result, { declined: true });
  assert.equal(f.service.active.id, plan.id);
  assert.deepEqual(f.writes, []);
});

test('independent tagging reports cancellable preparation, native confirmation, then execution', async t => {
  const f = await fixture(t);
  const plan = await f.service.preview({ mode: 'filter', targets: [f.target] });
  await f.service.selectedTags(plan.id, [plan.rows[0].id]);
  f.progress.length = 0;
  let confirmIndex = -1;
  const result = await f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: ['green'] }, {
    confirm: async () => {
      assert.equal(f.progress[0].phase, 'verify');
      assert.equal(f.progress[0].detail.key, 'progress.verify');
      assert.equal(f.progress.at(-1).phase, 'confirm');
      assert.ok(f.progress.some(value => value.phase === 'tags'));
      confirmIndex = f.progress.length - 1;
      return true;
    },
  });
  assert.equal(result.completed, 1);
  assert.deepEqual(f.progress.slice(confirmIndex).map(value => value.phase), ['confirm', 'verify', 'execute']);
  assert.deepEqual(f.writes, [{ file: f.file, tags: ['Green\n2'] }]);
});

for (const mode of ['orphans', 'tags', 'list', 'filter', 'compare']) {
  test(`${mode}: cancellation during directory enumeration stops before visiting children`, async t => {
    const f = await fixture(t), base = path.join(f.root, 'base');
    await fs.mkdir(base);
    await fs.writeFile(path.join(base, 'photo.NEF'), 'reference');
    for (let i = 0; i < 12; i++) {
      const directory = path.join(f.target, `child-${i}`);
      await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'photo.jpg'), 'fixture');
    }
    const config = { mode, base, targets: [f.target], referenceExt: 'NEF',
      tagAction: 'sync', compareAction: 'review', listSource: 'text', listText: 'photo.jpg', listMode: 'keep' };
    const original = fs.readdir, visited = [];
    fs.readdir = async (...args) => {
      const value = await original(...args);
      if (String(args[0]).startsWith(f.root)) {
        visited.push(args[0]);
        f.service.cancel();
      }
      return value;
    };
    try { await assert.rejects(f.service.preview(config), error => error.key === 'error.cancelled'); }
    finally { fs.readdir = original; }
    assert.ok(visited.length > 0);
    assert.equal(visited.some(directory => path.relative(f.root, directory).includes(path.sep)), false,
      'no child directory may be visited after cancellation');
    assert.equal(f.service.busy, false); assert.equal(f.service.active, null);
    assert.equal((await fs.readdir(f.root)).some(name => name.startsWith('finder-selection-list-')), false);
    assert.deepEqual(f.writes, []);
    const next = await f.service.preview({ mode: 'filter', targets: [f.target] });
    assert.equal(next.rows.length, 13, 'the next workflow starts with a fresh cancellation state');
  });
}

for (const mode of ['orphans', 'tags', 'list']) {
  test(`${mode}: parallel directory reads drain before the cancelled preview releases its lock`, async t => {
    const f = await fixture(t), base = path.join(f.root, 'base'), second = path.join(f.root, 'second');
    await fs.mkdir(base); await fs.mkdir(second);
    await fs.writeFile(path.join(base, 'photo.NEF'), 'reference');
    await fs.writeFile(path.join(second, 'other.jpg'), 'fixture');
    const firstStarted = deferred(), secondStarted = deferred(), release = deferred();
    const original = fs.readdir;
    fs.readdir = async (...args) => {
      const value = await original(...args);
      if (args[0] === f.target) {
        firstStarted.resolve(); await secondStarted.promise;
        f.service.cancel();
      } else if (args[0] === second) {
        secondStarted.resolve(); await release.promise;
      }
      return value;
    };
    let settled = false;
    const pending = f.service.preview({ mode, base, targets: [f.target, second], referenceExt: 'NEF', tagAction: 'sync',
      listSource: 'text', listText: 'photo.jpg', listMode: 'keep' });
    pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      await firstStarted.promise; await secondStarted.promise; await tick();
      assert.equal(settled, false, 'a cancelled sibling cannot finish while another scan still reads');
      assert.equal(f.service.busy, true);
    } finally { release.resolve(); fs.readdir = original; }
    await assert.rejects(pending, error => error.key === 'error.cancelled');
    assert.equal(f.service.busy, false);
    assert.equal(f.service.active, null);
    const next = await f.service.preview({ mode: 'filter', targets: [f.target] });
    assert.equal(next.rows.length, 1);
  });
}

for (const action of ['trash', 'tags']) {
  test(`${action}: stopping during execution verification records cancellation without an error or mutation`, async t => {
    const f = await fixture(t);
    const plan = await f.service.preview({ mode: 'filter', targets: [f.target], filterAction: action, colors: ['green'] });
    const original = fs.readdir;
    let visited = 0;
    fs.readdir = async (...args) => {
      const value = await original(...args);
      if (args[0] === f.target) { visited++; f.service.cancel(); }
      return value;
    };
    let result;
    try { result = await f.service.execute(plan.id, [plan.rows[0].id]); }
    finally { fs.readdir = original; }
    assert.equal(visited, 1);
    assert.equal(result.cancelled, true); assert.equal(result.completed, 0);
    assert.equal(result.failed, 0); assert.equal(result.unattempted, 1); assert.equal(result.error, null);
    assert.equal(result.records[0].error, undefined);
    assert.deepEqual(f.writes, []);
    assert.equal(await fs.readFile(f.file, 'utf8'), 'fixture only');
  });

  test(`${action}: a real verification I/O error is not hidden by a simultaneous cancellation`, async t => {
    const f = await fixture(t);
    const plan = await f.service.preview({ mode: 'filter', targets: [f.target], filterAction: action, colors: ['green'] });
    const original = fs.readdir;
    fs.readdir = async (...args) => {
      if (args[0] === f.target) { f.service.cancel(); throw Object.assign(new Error('audit I/O failure'), { code: 'EIO' }); }
      return original(...args);
    };
    let result;
    try { result = await f.service.execute(plan.id, [plan.rows[0].id]); }
    finally { fs.readdir = original; }
    assert.equal(result.cancelled, false); assert.equal(result.completed, 0);
    assert.ok(result.error); assert.match(result.error.raw ?? result.error.params?.detail, /audit I\/O failure/);
    assert.deepEqual(f.writes, []);
  });
}

test('independent tagging can stop during preparation without consuming its source preview', async t => {
  const f = await fixture(t), plan = await f.service.preview({ mode: 'filter', targets: [f.target] });
  const original = fs.readdir;
  fs.readdir = async (...args) => {
    const value = await original(...args);
    if (args[0] === f.target) f.service.cancel();
    return value;
  };
  try {
    await assert.rejects(f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: ['green'] }), error => error.key === 'error.cancelled');
  } finally { fs.readdir = original; }
  assert.equal(f.service.active.id, plan.id); assert.equal(f.service.busy, false);
  assert.deepEqual(f.service.history, []); assert.deepEqual(f.writes, []);
});

test('orphan cleanup can stop inside its final live-reference check without moving a file', async t => {
  const f = await fixture(t), base = path.join(f.root, 'base');
  await fs.mkdir(base); await fs.writeFile(path.join(base, 'other.NEF'), 'reference');
  const plan = await f.service.preview({ mode: 'orphans', base, targets: [f.target], referenceExt: 'NEF', matchBy: 'name' });
  const original = fs.readdir;
  let referenceReads = 0;
  fs.readdir = async (...args) => {
    const value = await original(...args);
    // The first read validates the inventory; the second checks for a new
    // matching reference immediately before moving the checked candidate.
    if (args[0] === base && ++referenceReads === 2) f.service.cancel();
    return value;
  };
  let result;
  try { result = await f.service.execute(plan.id, [plan.rows[0].id]); }
  finally { fs.readdir = original; }
  assert.equal(referenceReads, 2);
  assert.equal(result.cancelled, true); assert.equal(result.completed, 0); assert.equal(result.failed, 0); assert.equal(result.error, null);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'fixture only');
});

test('comparison match samples preserve every file and common/unique classification', () => {
  const left = Array.from({ length: 100 }, (_, i) => `/left/${i}/same.jpg`);
  const right = Array.from({ length: 100 }, (_, i) => `/right/${i}/same.jpg`);
  left.push('/left/unique.txt'); right.push('/right/other.txt');
  const options = { rootA: '/left', rootB: '/right' };
  const complete = compareFolderFiles(left, right, options);
  const sampled = compareFolderFiles(left, right, { ...options, matchesLimit: 2 });
  assert.deepEqual(sampled.map(({ matches, ...row }) => row), complete.map(({ matches, ...row }) => row));
  assert.ok(complete.filter(row => row.group === 'common').every(row => row.matches.length === 100), 'the default API remains complete');
  assert.ok(sampled.every(row => row.matches.length <= 2));
  assert.ok(sampled.filter(row => row.group === 'common').every(row => row.matches.length === 2));
  assert.deepEqual(compareFolderFiles(left, right, { ...options, matchesLimit: 0 }).map(row => row.group), complete.map(row => row.group));
  for (const matchesLimit of [-1, 0.5, NaN, '2']) {
    assert.throws(() => compareFolderFiles(left, right, { ...options, matchesLimit }));
  }
});

test('desktop comparison bounds match data even for many identical basenames', async t => {
  const f = await fixture(t), base = path.join(f.root, 'base');
  await fs.mkdir(base);
  for (const root of [base, f.target]) {
    for (let i = 0; i < 30; i++) {
      const directory = path.join(root, `child-${i}`);
      await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'same.jpg'), 'fixture');
    }
  }
  const plan = await f.service.preview({ mode: 'compare', base, targets: [f.target], compareAction: 'review', compareSelection: 'common' });
  assert.equal(plan.rows.length, 61); assert.equal(plan.matched, 60);
  assert.equal(plan.rows.filter(row => row.candidate).length, 60);
  assert.ok(plan.rows.every(row => row.matches.length <= 2));
  assert.equal(plan.rows.filter(row => row.reason.key === 'compare.common').length, 60);
  assert.equal(f.service.active.plan.snapshots.length, 61, 'limiting display examples never omits safety snapshots');
});
