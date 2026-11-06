import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopService } from '../service.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'finder-plan-cache-')));
  const base = path.join(root, 'base'), target = path.join(root, 'target'), tempRoot = path.join(root, 'temp');
  await Promise.all([base, target, tempRoot].map(directory => fs.mkdir(directory)));
  await Promise.all([
    ['base/A.NEF', 'original'], ['base/Common.txt', 'reference'],
    ['target/A.jpg', 'export'], ['target/Common.txt', 'copy'], ['target/Extra.txt', 'extra'],
  ].map(([relative, data]) => fs.writeFile(path.join(root, relative), data)));
  const tags = new Map(), reads = [], writes = [], moved = [], progress = [];
  const service = new DesktopService({ tempRoot,
    readTags: async file => { reads.push(file); return tags.get(file) ?? []; },
    writeTags: async (file, values) => { writes.push(file); tags.set(file, [...values]); },
    trash: async file => { moved.push(file); await fs.rename(file, path.join(root, path.basename(file))); },
    onProgress: value => progress.push(value),
  });
  t.after(async () => { await service.discardAll(); await fs.rm(root, { recursive: true, force: true }); });
  const configs = {
    orphans: { mode: 'orphans', base, targets: [target], referenceExt: 'NEF', matchBy: 'name' },
    tags: { mode: 'tags', base, targets: [target], tagAction: 'color', colors: ['green'] },
    list: { mode: 'list', targets: [target], listSource: 'text', listText: 'A.jpg', listMode: 'keep' },
    filter: { mode: 'filter', targets: [target] },
    compare: { mode: 'compare', base, targets: [target], compareAction: 'review' },
  };
  return { root, base, target, tempRoot, service, configs, reads, writes, moved, progress };
}

test('workflow plans resume without rescanning or reading tags, while only the active plan can execute', async t => {
  const f = await fixture(t);
  const filter = await f.service.preview(f.configs.filter);
  const compare = await f.service.preview(f.configs.compare);
  await assert.rejects(f.service.execute(filter.id, [filter.rows[0].id]), /error.expired/);
  const readCount = f.reads.length, progressCount = f.progress.length;
  await fs.writeFile(path.join(f.target, 'new-after-preview.txt'), 'new');
  await f.service.discard();
  assert.equal(f.service.active, null);
  assert.deepEqual(await f.service.activate(filter.id), filter);
  assert.deepEqual(await f.service.activate(compare.id), compare);
  assert.equal(f.reads.length, readCount); assert.equal(f.progress.length, progressCount);
  await f.service.activate(filter.id);
  const run = await f.service.execute(filter.id, [filter.rows[0].id]);
  assert.equal(run.completed, 0); assert.equal(run.error.key, 'error.stale');
  assert.deepEqual(f.moved, []); assert.deepEqual(f.writes, []);
});

test('the native cache keeps at most one plan per workflow and disposes replaced inline lists', async t => {
  const f = await fixture(t), plans = {};
  for (const [mode, config] of Object.entries(f.configs)) plans[mode] = await f.service.preview(config);
  assert.equal(f.service.plans.size, 5);
  await f.service.activate(plans.list.id);
  const oldTemp = f.service.active.tempDirectory;
  await fs.access(path.join(oldTemp, 'selection.txt'));
  const replacement = await f.service.preview({ ...f.configs.list, listText: 'Common.txt' });
  const newTemp = f.service.active.tempDirectory;
  assert.equal(f.service.plans.size, 5);
  await assert.rejects(fs.access(oldTemp), { code: 'ENOENT' });
  assert.equal(await f.service.activate(plans.list.id), null);
  assert.equal((await f.service.activate(replacement.id)).id, replacement.id);
  assert.equal((await f.service.activate(plans.filter.id)).id, plans.filter.id);
  await f.service.discardAll();
  assert.equal(f.service.active, null); assert.equal(f.service.plans.size, 0);
  await assert.rejects(fs.access(newTemp), { code: 'ENOENT' });
  for (const plan of [...Object.values(plans), replacement]) assert.equal(await f.service.activate(plan.id), null);
});

test('invalidating edited or cleared workflow settings disposes only that workflow cache and temporary list', async t => {
  const f = await fixture(t), list = await f.service.preview(f.configs.list), tempDirectory = f.service.active.tempDirectory;
  const filter = await f.service.preview(f.configs.filter);
  await f.service.activate(list.id);
  await f.service.discard('list');
  assert.equal(f.service.active, null);
  assert.equal(await f.service.activate(list.id), null);
  assert.deepEqual(await f.service.activate(filter.id), filter);
  await assert.rejects(fs.access(tempDirectory), { code: 'ENOENT' });
  await assert.rejects(f.service.discard('unknown'), /error.option/);
  assert.equal(f.service.active.id, filter.id);
});

test('declining confirmation preserves every cached workflow, accepted writes invalidate all of them', async t => {
  const f = await fixture(t);
  const list = await f.service.preview(f.configs.list), listTemp = f.service.active.tempDirectory;
  const filter = await f.service.preview(f.configs.filter);
  const compare = await f.service.preview(f.configs.compare);
  await f.service.activate(filter.id);
  const id = filter.rows[0].id;
  await f.service.selectedTags(filter.id, [id]);
  assert.deepEqual(await f.service.tagSelected(filter.id, [id], { colors: ['green'] }, { confirm: async () => false }), { declined: true });
  for (const plan of [list, filter, compare]) assert.equal((await f.service.activate(plan.id)).id, plan.id);
  await f.service.activate(filter.id);
  const run = await f.service.tagSelected(filter.id, [id], { colors: ['green'] });
  assert.equal(run.completed, 1); assert.equal(f.writes.length, 1); assert.deepEqual(f.moved, []);
  assert.equal(f.service.plans.size, 0);
  for (const plan of [list, filter, compare]) assert.equal(await f.service.activate(plan.id), null);
  await assert.rejects(fs.access(listTemp), { code: 'ENOENT' });
});

test('independent list tags keep their temporary list until the operation finishes', async t => {
  const f = await fixture(t), plan = await f.service.preview(f.configs.list);
  const tempDirectory = f.service.active.tempDirectory;
  const write = f.service.writeTags;
  f.service.writeTags = async (...args) => { await fs.access(path.join(tempDirectory, 'selection.txt')); return write(...args); };
  const run = await f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: ['green'] });
  assert.equal(run.completed, 1); assert.equal(f.writes.length, 1);
  await assert.rejects(fs.access(tempDirectory), { code: 'ENOENT' });
});

test('discardAll during a selected-tag read cancels the request and cannot republish cached plans', async t => {
  const f = await fixture(t), list = await f.service.preview(f.configs.list), tempDirectory = f.service.active.tempDirectory;
  const filter = await f.service.preview(f.configs.filter), started = deferred(), finish = deferred();
  f.service.readTags = async () => { started.resolve(); await finish.promise; return []; };
  const pending = f.service.selectedTags(filter.id, [filter.rows[0].id]);
  await started.promise;
  await f.service.discardAll();
  assert.equal(f.service.busy, true);
  await assert.rejects(f.service.activate(list.id), /error.busy/);
  finish.resolve();
  await assert.rejects(pending, /error.cancelled/);
  assert.equal(f.service.busy, false); assert.equal(f.service.active, null); assert.equal(f.service.plans.size, 0);
  assert.equal(await f.service.activate(list.id), null); assert.equal(await f.service.activate(filter.id), null);
  await assert.rejects(fs.access(tempDirectory), { code: 'ENOENT' });
  assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
});

test('workflow invalidation during a selected-tag read waits for cancellation before removing temporary files', async t => {
  const f = await fixture(t), filter = await f.service.preview(f.configs.filter);
  const list = await f.service.preview(f.configs.list), tempDirectory = f.service.active.tempDirectory;
  const started = deferred(), finish = deferred();
  f.service.readTags = async () => { started.resolve(); await finish.promise; return []; };
  const pending = f.service.selectedTags(list.id, [list.rows[0].id]);
  await started.promise;
  await f.service.discard('list');
  await fs.access(path.join(tempDirectory, 'selection.txt'));
  finish.resolve();
  await assert.rejects(pending, /error.cancelled/);
  await assert.rejects(fs.access(tempDirectory), { code: 'ENOENT' });
  assert.equal(f.service.active, null); assert.equal(await f.service.activate(list.id), null);
  assert.deepEqual(await f.service.activate(filter.id), filter);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
});

test('discard cancels an in-flight scan but leaves other workflows available for activation', async t => {
  const f = await fixture(t), filter = await f.service.preview(f.configs.filter), started = deferred(), finish = deferred();
  f.service.readTags = async () => { started.resolve(); await finish.promise; return []; };
  const pending = f.service.preview({ ...f.configs.compare, compareAction: 'tags', colors: ['green'] });
  await started.promise;
  await f.service.discard();
  finish.resolve();
  await assert.rejects(pending, /error.cancelled/);
  assert.equal(f.service.active, null); assert.equal(f.service.busy, false);
  assert.deepEqual(await f.service.activate(filter.id), filter);
});

test('discardAll while an independent tag confirmation is open never restores the cancelled source plan', async t => {
  const f = await fixture(t), list = await f.service.preview(f.configs.list), tempDirectory = f.service.active.tempDirectory;
  const started = deferred(), answer = deferred();
  const pending = f.service.tagSelected(list.id, [list.rows[0].id], { colors: ['green'] }, {
    confirm: async () => { started.resolve(); return answer.promise; },
  });
  await started.promise;
  await f.service.discardAll();
  answer.resolve(true);
  assert.deepEqual(await pending, { declined: true });
  assert.equal(f.service.active, null); assert.equal(f.service.plans.size, 0); assert.equal(f.service.busy, false);
  assert.equal(await f.service.activate(list.id), null);
  await assert.rejects(fs.access(tempDirectory), { code: 'ENOENT' });
  assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
});
