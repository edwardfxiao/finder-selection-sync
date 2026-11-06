import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopService, normalizeConfig } from '../service.js';
import { canPreview } from '../preview-controller.js';
import { describeError } from '../messages.js';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'finder-filter-test-')));
  const first = path.join(root, 'first'), second = path.join(root, 'second'), trash = path.join(root, 'trash');
  await Promise.all([first, second, trash].map(dir => fs.mkdir(dir)));
  const moved = [], written = [], read = [], tags = new Map();
  const service = new DesktopService({
    readTags: async file => { read.push(file); return tags.get(file) ?? []; },
    writeTags: async (file, values) => { written.push({ file, tags: [...values] }); tags.set(file, [...values]); },
    trash: async file => { await fs.rename(file, path.join(trash, path.basename(file))); moved.push(file); },
  });
  t.after(async () => { await service.discardAll(); await fs.rm(root, { recursive: true, force: true }); });
  async function file(relative, contents = 'fixture', date) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
    if (date) await fs.utimes(file, new Date(date), new Date(date));
    return file;
  }
  return { root, first, second, trash, service, file, moved, written, read, tags, config: { mode: 'filter', targets: [first] } };
}
const candidates = plan => plan.rows.filter(row => row.candidate);

test('independent filter tags read only checked matches and keep the cleanup plan through cancellation', async t => {
  const f = await fixture(t);
  const a = await f.file('first/a.jpg'), b = await f.file('first/b.jpg'), outside = await f.file('first/c.txt');
  f.tags.set(a, ['Blue\n4', 'Custom']);
  const plan = await f.service.preview({ ...f.config, includeExt: '.jpg' });
  assert.deepEqual(f.read, []);
  const row = plan.rows.find(row => row.file === a), excluded = plan.rows.find(row => row.file === outside);
  await assert.rejects(f.service.selectedTags(plan.id, [excluded.id]), /error.notCandidate/);
  await assert.rejects(f.service.tagSelected(plan.id, [excluded.id], { colors: ['red'] }), /error.notCandidate/);
  await assert.rejects(f.service.selectedTags(plan.id, [row.id, row.id]), /error.selection/);
  await assert.rejects(f.service.selectedTags(plan.id, ['missing']), /error.notCandidate/);
  const selected = await f.service.selectedTags(plan.id, [row.id]);
  assert.deepEqual(f.read, [a]);
  assert.deepEqual(selected[0].currentTags, ['Blue\n4', 'Custom']);
  assert.equal(f.service.active.id, plan.id); assert.equal(f.service.active.options.filterAction, 'trash');
  assert.equal(plan.rows.find(row => row.file === a).currentTags, undefined);
  const options = { colors: ['green', 'red'], mergeTags: true };
  assert.deepEqual(await f.service.tagSelected(plan.id, [row.id], options, { confirm: async summary => {
    assert.equal(summary.action, 'tags'); assert.deepEqual(summary.files, [a]); return false;
  } }), { declined: true });
  assert.equal(f.service.active.id, plan.id); assert.equal(f.service.active.options.filterAction, 'trash');
  assert.deepEqual(f.written, []); assert.deepEqual(f.moved, []);
  const run = await f.service.tagSelected(plan.id, [row.id], options);
  assert.equal(run.completed, 1); assert.equal(run.mode, 'filter'); assert.equal(run.action, 'tags');
  assert.deepEqual(f.written, [{ file: a, tags: ['Blue\n4', 'Custom', 'Green\n2', 'Red\n6'] }]);
  assert.equal(f.tags.has(b), false); assert.equal(f.tags.has(outside), false); assert.deepEqual(f.moved, []);
});

test('independent filter Clear file tags removes only selected tags and leaves untagged rows untouched', async t => {
  const f = await fixture(t);
  const a = await f.file('first/a.jpg'), b = await f.file('first/b.jpg'), empty = await f.file('first/empty.jpg');
  f.tags.set(a, ['Blue\n4', 'Custom']); f.tags.set(b, ['Red\n6']);
  const plan = await f.service.preview(f.config);
  const ids = plan.rows.filter(row => [a, empty].includes(row.file)).map(row => row.id);
  await f.service.selectedTags(plan.id, ids);
  const run = await f.service.tagSelected(plan.id, ids, { colors: [], clearTags: true });
  assert.equal(run.completed, 1); assert.equal(run.action, 'tags');
  assert.deepEqual(f.written, [{ file: a, tags: [] }]); assert.deepEqual(f.tags.get(b), ['Red\n6']);
  assert.deepEqual(f.moved, []);
});

test('opening filter tags validates only selected snapshots; applying still validates the whole plan', async t => {
  const f = await fixture(t), a = await f.file('first/a.jpg'), b = await f.file('first/b.jpg');
  const plan = await f.service.preview(f.config);
  const id = plan.rows.find(row => row.file === a).id;
  await fs.appendFile(b, 'unselected change');
  assert.equal((await f.service.selectedTags(plan.id, [id]))[0].file, a);
  assert.deepEqual(f.read, [a]);
  await assert.rejects(f.service.tagSelected(plan.id, [id], { colors: ['green'] }), /File changed/);
  assert.deepEqual(f.written, []); assert.deepEqual(f.moved, []);
});

test('independent filter tags reject stale displayed tags, changed files and hard links', async t => {
  const f = await fixture(t), a = await f.file('first/a.jpg');
  f.tags.set(a, ['Blue\n4']);
  let plan = await f.service.preview(f.config);
  const id = plan.rows[0].id;
  await f.service.selectedTags(plan.id, [id]);
  f.tags.set(a, ['Red\n6']);
  await assert.rejects(f.service.tagSelected(plan.id, [id], { colors: [], clearTags: true }), /error.stale/);
  await fs.appendFile(a, 'changed');
  await assert.rejects(f.service.selectedTags(plan.id, [id]), /File changed/);
  await fs.link(a, path.join(f.root, 'hard-link'));
  plan = await f.service.preview(f.config);
  await assert.rejects(f.service.selectedTags(plan.id, [plan.rows[0].id]), /selection.hardLinks/);
  await assert.rejects(f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: ['green'] }, {
    confirm: async () => assert.fail('A checked hard link cannot reach confirmation'),
  }), /selection.hardLinks/);
  assert.deepEqual(f.written, []); assert.deepEqual(f.moved, []);
});

test('independent filter tags verify again after native confirmation', async t => {
  const f = await fixture(t), a = await f.file('first/a.jpg');
  const plan = await f.service.preview(f.config), id = plan.rows[0].id;
  await f.service.selectedTags(plan.id, [id]);
  const run = await f.service.tagSelected(plan.id, [id], { colors: ['green'] }, { confirm: async () => {
    f.tags.set(a, ['Red\n6']); return true;
  } });
  assert.equal(run.completed, 0); assert.equal(run.error.key, 'error.stale');
  assert.deepEqual(f.written, []); assert.deepEqual(f.moved, []);
});

test('filter tags: previews multiple tags and updates only checked matches after confirmation', async t => {
  const f = await fixture(t);
  const a = await f.file('first/a.jpg'), b = await f.file('second/b.jpg'), outside = await f.file('first/c.txt');
  f.tags.set(a, ['Blue\n4', 'Favorite']);
  const plan = await f.service.preview({ ...f.config, targets: [f.first, f.second], includeExt: '.jpg', filterAction: 'tags', colors: ['red', 'green', 'red'] });
  assert.equal(plan.action, 'tags'); assert.equal(plan.matched, 2); assert.equal(plan.candidates, 2);
  const row = plan.rows.find(row => row.file === a);
  assert.deepEqual(row.nextTags, ['Blue\n4', 'Favorite', 'Red\n6', 'Green\n2']);
  assert.equal(plan.rows.find(row => row.file === outside).matched, false);
  const confirmation = async summary => { assert.equal(summary.action, 'tags'); assert.deepEqual(summary.files, [a]); return false; };
  assert.deepEqual(await f.service.execute(plan.id, [row.id], { confirm: confirmation }), { declined: true });
  assert.deepEqual(f.written, []); assert.equal(f.service.active.id, plan.id);
  const run = await f.service.execute(plan.id, [row.id], { confirm: async () => true });
  assert.equal(run.completed, 1); assert.equal(run.mode, 'filter'); assert.equal(run.action, 'tags');
  assert.deepEqual(f.written, [{ file: a, tags: row.nextTags }]); assert.deepEqual(f.moved, []);
  assert.equal(f.tags.has(b), false); assert.equal(f.tags.has(outside), false);
  assert.deepEqual(run.records[0].beforeTags, ['Blue\n4', 'Favorite']);
  assert.deepEqual(run.records[0].afterTags, row.nextTags);
});

test('filter tags: replacement skips equivalent sets but still displays matching files', async t => {
  const f = await fixture(t);
  const a = await f.file('first/a.jpg'), b = await f.file('first/b.jpg');
  f.tags.set(a, ['Blue\n4', 'Favorite']); f.tags.set(b, ['Green\n2', 'Red\n6']);
  const config = { ...f.config, filterAction: 'tags', colors: ['red', 'green'], mergeTags: false };
  const plan = await f.service.preview(config);
  assert.equal(plan.matched, 2); assert.equal(plan.candidates, 1);
  const unchanged = plan.rows.find(row => row.file === b);
  assert.equal(unchanged.matched, true); assert.equal(unchanged.action, 'keep');
  await assert.rejects(f.service.execute(plan.id, [unchanged.id]), /error.notCandidate/);
  const run = await f.service.execute(plan.id, candidates(plan).map(row => row.id));
  assert.equal(run.completed, 1); assert.deepEqual(f.tags.get(a), ['Red\n6', 'Green\n2']);
  for (const colors of [['invalid'], ['red', null]]) await assert.rejects(f.service.preview({ ...config, colors }), /error.color/);
  const pending = await f.service.preview({ ...config, colors: [] });
  assert.equal(pending.requiresTags, true); assert.equal(pending.total, 2);
  assert.equal(pending.candidates, 2);
  for (const row of pending.rows) assert.deepEqual(row.nextTags, row.currentTags);
  await assert.rejects(f.service.execute(pending.id, candidates(pending).map(row => row.id)), /selection.chooseTagsHint/);
  assert.equal(canPreview({ ...config, colors: [] }), true);
  assert.equal(canPreview({ ...config, colors: ['blue'] }), true);
  assert.throws(() => normalizeConfig({ ...config, filterAction: 'invalid' }), /error.option/);
});

test('filter tags: hard links are excluded and tags changed during confirmation are not overwritten', async t => {
  const f = await fixture(t);
  const a = await f.file('first/a.jpg'), b = await f.file('first/b.jpg');
  await fs.link(b, path.join(f.first, 'b-alias.jpg'));
  const plan = await f.service.preview({ ...f.config, filterAction: 'tags', colors: ['green'] });
  assert.equal(plan.matched, 3); assert.equal(plan.candidates, 1);
  assert.equal(plan.warnings[0].key, 'warning.hardLinks');
  const run = await f.service.execute(plan.id, candidates(plan).map(row => row.id), { confirm: async () => { f.tags.set(a, ['Red\n6']); return true; } });
  assert.equal(run.error.key, 'error.stale'); assert.equal(run.completed, 0);
  assert.deepEqual(f.written, []); assert.deepEqual(f.moved, []);
});

test('filter tags: a replaced file during confirmation prevents tag writes', async t => {
  const f = await fixture(t);
  const a = await f.file('first/a.jpg');
  const plan = await f.service.preview({ ...f.config, filterAction: 'tags', colors: ['blue'] });
  const run = await f.service.execute(plan.id, candidates(plan).map(row => row.id), { confirm: async () => { await fs.appendFile(a, 'changed'); return true; } });
  assert.equal(run.error.key, 'error.stale'); assert.equal(run.completed, 0);
  assert.deepEqual(f.written, []); assert.deepEqual(f.moved, []);
});

test('filter desktop: multiple roots, recursive/depth limits and overlapping roots form a deduplicated union', async t => {
  const f = await fixture(t);
  const a = await f.file('first/A.JPG'), b = await f.file('first/nested/B.png'), c = await f.file('first/nested/deeper/C.jpg'), d = await f.file('second/D.jpg');
  await f.file('first/.hidden.jpg'); await f.file('first/.hidden/sub.jpg');
  await fs.symlink(f.second, path.join(f.first, 'alias'));
  await fs.symlink(d, path.join(f.first, 'link.jpg'));
  assert.equal(canPreview(f.config), true);
  let plan = await f.service.preview({ ...f.config, targets: [f.first, f.second], recursive: false });
  assert.deepEqual(plan.rows.map(row => row.file), [a, d]);
  plan = await f.service.preview({ ...f.config, depth: '0' });
  assert.deepEqual(plan.rows.map(row => row.file), [a]);
  plan = await f.service.preview({ ...f.config, depth: '1' });
  assert.deepEqual(plan.rows.map(row => row.file), [a, b]);
  plan = await f.service.preview({ ...f.config, targets: [f.first, path.join(f.first, 'nested'), f.second] });
  assert.deepEqual(plan.rows.map(row => row.file), [a, b, c, d]);
  assert.equal(plan.candidates, 4);
  assert.equal(f.moved.length, 0);
  plan = await f.service.preview({ ...f.config, nameContains: 'missing' });
  assert.equal(plan.candidates, 0);
});

test('filter desktop: inclusive local modification dates, size units, regex and inversion match real files', async t => {
  const f = await fixture(t);
  const a = await f.file('first/IMG_01.JPG', '1234', '2026-03-08T00:00:00');
  const b = await f.file('first/IMG_02.jpg', '12345678', '2026-03-08T23:59:59');
  await f.file('first/IMG_03.jpg', '1234', '2026-03-09T00:00:00');
  await f.file('first/IMG_04.jpg', '1234', '2026-03-07T23:59:59');
  await f.file('first/IMG_05.xmp', '1234', '2026-03-08T12:00:00');
  const config = { ...f.config, modifiedFrom: '2026-03-08', modifiedTo: '2026-03-08',
    sizeMin: '4', sizeMax: '8', sizeUnit: 'B', nameRegex: '^img_\\d+\\.jpg$', includeExt: '.JPG', ignoreCase: true };
  let plan = await f.service.preview(config);
  assert.deepEqual(candidates(plan).map(row => row.file), [a, b]);
  assert.equal(plan.rows.find(row => row.file === a).modifiedMs, new Date('2026-03-08T00:00:00').getTime());
  plan = await f.service.preview({ ...config, invertFilter: true });
  assert.deepEqual(candidates(plan).map(row => row.name), ['IMG_03.jpg', 'IMG_04.jpg', 'IMG_05.xmp']);
  assert.equal(normalizeConfig({ ...config, sizeMin: '1.5', sizeMax: '', sizeUnit: 'KB' }).filters.sizeMin, 1536);
  assert.equal(f.moved.length, 0);
});

test('filter desktop: validates all fields before scanning, localizes errors, and recovers from invalid regex', async t => {
  const f = await fixture(t);
  for (const [patch, key] of [
    [{ nameRegex: '[' }, 'error.filterRegex'], [{ nameContains: 42 }, 'error.filterText'],
    [{ sizeMin: '-1' }, 'error.filterSize'], [{ sizeMin: '2', sizeMax: '1' }, 'error.filterSize'],
    [{ modifiedFrom: '2026-02-30' }, 'error.filterDate'], [{ modifiedFrom: '2026-05-02', modifiedTo: '2026-05-01' }, 'error.filterDate'],
    [{ includeExt: '[".js"]' }, 'error.extensions'], [{ depth: '-1' }, 'error.depth'],
  ]) {
    await assert.rejects(f.service.preview({ ...f.config, ...patch }), error => describeError(error).key === key);
    assert.equal(f.service.active, null); assert.equal(f.service.busy, false);
  }
  await f.file(`first/${'a'.repeat(100)}!`);
  await assert.rejects(f.service.preview({ ...f.config, nameRegex: '^(a+)+$' }), error => describeError(error).key === 'error.filterRegexTimeout');
  const plan = await f.service.preview(f.config);
  assert.equal(plan.total, 1);
  assert.deepEqual(f.moved, []);
});

test('filter desktop: confirmation is required by the adapter; only valid checked matches move to Trash', async t => {
  const f = await fixture(t);
  const a = await f.file('first/a.jpg'); await f.file('first/b.jpg'); await f.file('first/c.txt');
  const plan = await f.service.preview({ ...f.config, includeExt: '.jpg' });
  await assert.rejects(f.service.execute(plan.id, [plan.rows.find(row => row.name === 'c.txt').id]), /error.notCandidate/);
  const selected = [plan.rows.find(row => row.file === a).id];
  assert.deepEqual(await f.service.execute(plan.id, selected, { confirm: async summary => {
    assert.equal(summary.action, 'trash'); assert.deepEqual(summary.files, [a]); return false;
  } }), { declined: true });
  assert.deepEqual(f.moved, []);
  assert.equal(f.service.active.id, plan.id);
  const result = await f.service.execute(plan.id, selected, { confirm: async () => true });
  assert.equal(result.mode, 'filter'); assert.equal(result.completed, 1); assert.equal(result.error, null);
  assert.deepEqual(f.moved, [a]); assert.deepEqual(await fs.readdir(f.first), ['b.jpg', 'c.txt']);
  assert.equal(f.service.history[0], result);
});

for (const change of ['size', 'mtime', 'inventory', 'symlink']) {
  test(`filter desktop: ${change} changes during confirmation prevent all mutations`, async t => {
    const f = await fixture(t);
    const file = await f.file('first/a.txt'), other = await f.file('second/other.txt');
    const plan = await f.service.preview(f.config);
    const result = await f.service.execute(plan.id, candidates(plan).map(row => row.id), { confirm: async () => {
      if (change === 'size') await fs.appendFile(file, 'changed');
      if (change === 'mtime') await fs.utimes(file, new Date(0), new Date(0));
      if (change === 'inventory') await f.file('first/new.txt');
      if (change === 'symlink') { await fs.unlink(file); await fs.symlink(other, file); }
      return true;
    } });
    assert.equal(result.completed, 0); assert.equal(result.error.key, 'error.stale'); assert.deepEqual(f.moved, []);
  });
}
