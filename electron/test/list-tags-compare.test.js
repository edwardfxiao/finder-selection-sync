import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopService, normalizeConfig } from '../service.js';
import { canPreview } from '../preview-controller.js';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'finder-compare-test-')));
  const a = path.join(root, 'a'), b = path.join(root, 'b');
  await fs.mkdir(a); await fs.mkdir(b);
  const tags = new Map(), writes = [], moved = [], reads = [];
  const service = new DesktopService({ tempRoot: root, readTags: async file => { reads.push(file); return tags.get(file) ?? []; },
    writeTags: async (file, values) => { writes.push(file); tags.set(file, [...values]); }, trash: async file => moved.push(file) });
  t.after(async () => { await service.discardAll(); await fs.rm(root, { recursive: true, force: true }); });
  async function add(relative) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, relative); return file; }
  return { root, a, b, tags, writes, moved, reads, service, add, compare: { mode: 'compare', base: a, targets: [b], colors: ['green', 'red'] },
    list: { mode: 'list', targets: [a], listSource: 'text', listText: 'same.jpg', listMode: 'delete', listAction: 'tags', colors: ['green'] } };
}
const selected = plan => plan.rows.filter(row => row.candidate).map(row => row.id);
const matchedFiles = plan => plan.rows.filter(row => row.matched).map(row => row.file).sort();

test('comparison review scans without reading tags and shares the selected-file set/clear workflow', async t => {
  const f = await fixture(t), a = await f.add('a/shared.jpg'), b = await f.add('b/sub/shared.jpg');
  await f.add('a/only-a.jpg');
  f.tags.set(a, ['Blue\n4', 'Custom']); f.tags.set(b, ['Red\n6']);
  const config = { ...f.compare, compareAction: 'review', colors: [] };
  let plan = await f.service.preview(config);
  assert.equal(plan.action, 'review'); assert.equal(plan.requiresTags, false);
  assert.equal(plan.matched, 2); assert.equal(plan.candidates, 2); assert.deepEqual(f.reads, []);
  assert.ok(plan.rows.every(row => row.action === 'keep' && row.currentTags === undefined));
  await assert.rejects(f.service.execute(plan.id, selected(plan)), /error.option/);
  const id = plan.rows.find(row => row.file === a).id;
  const rows = await f.service.selectedTags(plan.id, [id]);
  assert.deepEqual(f.reads, [a]); assert.deepEqual(rows[0].currentTags, ['Blue\n4', 'Custom']);
  assert.deepEqual(await f.service.tagSelected(plan.id, [id], { colors: ['green'], mergeTags: true }, {
    confirm: async summary => { assert.equal(summary.action, 'tags'); assert.deepEqual(summary.files, [a]); return false; },
  }), { declined: true });
  assert.equal(f.service.active.id, plan.id); assert.equal(f.service.active.options.compareAction, 'review');
  let run = await f.service.tagSelected(plan.id, [id], { colors: ['green'], mergeTags: true });
  assert.equal(run.mode, 'compare'); assert.equal(run.action, 'tags'); assert.equal(run.completed, 1);
  assert.deepEqual(f.tags.get(a), ['Blue\n4', 'Custom', 'Green\n2']); assert.deepEqual(f.tags.get(b), ['Red\n6']);
  plan = await f.service.preview(config);
  const clearId = plan.rows.find(row => row.file === a).id;
  await f.service.selectedTags(plan.id, [clearId]);
  run = await f.service.tagSelected(plan.id, [clearId], { colors: [], clearTags: true });
  assert.equal(run.completed, 1); assert.deepEqual(f.tags.get(a), []); assert.deepEqual(f.tags.get(b), ['Red\n6']);
  assert.deepEqual(f.writes, [a, a]); assert.deepEqual(f.moved, []);
});

test('comparison independent tags respect shared/unique selection and folder scope', async t => {
  const f = await fixture(t), a = await f.add('a/shared.jpg'), b = await f.add('b/shared.jpg'), unique = await f.add('a/unique.jpg');
  const plan = await f.service.preview({ ...f.compare, compareAction: 'review', scope: 'base' });
  assert.deepEqual(matchedFiles(plan), [a]);
  for (const file of [b, unique]) {
    const id = plan.rows.find(row => row.file === file).id;
    await assert.rejects(f.service.selectedTags(plan.id, [id]), /error.notCandidate/);
    await assert.rejects(f.service.tagSelected(plan.id, [id], { colors: ['green'] }), /error.notCandidate/);
  }
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
  assert.throws(() => normalizeConfig({ ...f.compare, compareAction: 'invalid' }), /error.option/);
});

test('comparison independent tags guard stale tags, hard links and post-confirmation changes', async t => {
  const f = await fixture(t), a = await f.add('a/shared.jpg'); await f.add('b/shared.jpg');
  const config = { ...f.compare, compareAction: 'review', scope: 'base' };
  let plan = await f.service.preview(config), id = plan.rows.find(row => row.file === a).id;
  await f.service.selectedTags(plan.id, [id]);
  f.tags.set(a, ['Red\n6']);
  await assert.rejects(f.service.tagSelected(plan.id, [id], { colors: [], clearTags: true }), /error.stale/);
  await f.service.selectedTags(plan.id, [id]);
  const run = await f.service.tagSelected(plan.id, [id], { colors: ['green'] }, { confirm: async () => {
    await f.add('b/new.jpg'); return true;
  } });
  assert.equal(run.completed, 0); assert.ok(run.error); assert.deepEqual(f.writes, []);
  await fs.link(a, path.join(f.root, 'hard-link'));
  plan = await f.service.preview(config); id = plan.rows.find(row => row.file === a).id;
  await assert.rejects(f.service.tagSelected(plan.id, [id], { colors: ['green'] }), /selection.hardLinks/);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
});

test('comparison classifies both sides, filters shared/unique files, and confirms only checked writes', async t => {
  const f = await fixture(t);
  const a = await f.add('a/same.jpg'), b = await f.add('b/sub/same.jpg'), onlyA = await f.add('a/only-a.jpg'), onlyB = await f.add('b/only-b.jpg');
  f.tags.set(a, ['Blue\n4']);
  const plan = await f.service.preview(f.compare);
  assert.equal(plan.mode, 'compare'); assert.equal(plan.action, 'tags');
  assert.deepEqual(matchedFiles(plan), [a, b].sort()); assert.equal(plan.candidates, 2);
  const row = plan.rows.find(row => row.file === a);
  assert.deepEqual(row.nextTags, ['Blue\n4', 'Green\n2', 'Red\n6']);
  await assert.rejects(f.service.execute(plan.id, [plan.rows.find(row => row.file === onlyA).id]), /error.notCandidate/);
  assert.deepEqual(await f.service.execute(plan.id, [row.id], { confirm: async info => { assert.deepEqual(info.files, [a]); return false; } }), { declined: true });
  assert.deepEqual(f.writes, []);
  const run = await f.service.execute(plan.id, [row.id]);
  assert.equal(run.completed, 1); assert.equal(run.mode, 'compare'); assert.deepEqual(f.writes, [a]); assert.deepEqual(f.moved, []);
  for (const [selection, expected] of [['unique', [onlyA, onlyB]], ['onlyA', [onlyA]], ['onlyB', [onlyB]]]) {
    const next = await f.service.preview({ ...f.compare, compareSelection: selection });
    assert.deepEqual(matchedFiles(next), expected.sort());
  }
});
test('comparison scopes, relative paths, case and scan depth are respected', async t => {
  const f = await fixture(t);
  const a = await f.add('a/Same.JPG'), b = await f.add('b/sub/same.jpg');
  let plan = await f.service.preview(f.compare); assert.equal(plan.matched, 0);
  plan = await f.service.preview({ ...f.compare, ignoreCase: true, scope: 'base' }); assert.deepEqual(matchedFiles(plan), [a]);
  plan = await f.service.preview({ ...f.compare, ignoreCase: true, scope: 'targets' }); assert.deepEqual(matchedFiles(plan), [b]);
  plan = await f.service.preview({ ...f.compare, ignoreCase: true, matchBy: 'relative' }); assert.equal(plan.matched, 0);
  for (const scan of [{ recursive: false }, { depth: '0' }]) {
    plan = await f.service.preview({ ...f.compare, ...scan, compareSelection: 'unique' }); assert.deepEqual(matchedFiles(plan), [a]);
  }
  plan = await f.service.preview({ ...f.compare, depth: '1', compareSelection: 'unique' }); assert.deepEqual(matchedFiles(plan), [a, b].sort());
});
test('comparison accepts an empty folder, rejects overlap and limits the second side to one folder', async t => {
  const f = await fixture(t); const a = await f.add('a/file.jpg');
  const plan = await f.service.preview({ ...f.compare, compareSelection: 'onlyA', scope: 'targets' });
  assert.deepEqual(matchedFiles(plan), [a]);
  for (const targets of [[f.a], [f.root]]) await assert.rejects(f.service.preview({ ...f.compare, targets }), /error.overlapCompare/);
  assert.throws(() => normalizeConfig({ ...f.compare, targets: [f.a, f.b] }), /error.singlePath/);
  assert.equal(canPreview({ ...f.compare, base: '' }), false);
  assert.equal(canPreview({ ...f.compare, colors: [] }), true);
});
for (const mode of ['list', 'compare']) {
  test(`${mode}: clearing chosen colors keeps rows selectable without planning or allowing tag removal`, async t => {
    const f = await fixture(t); const a = await f.add('a/same.jpg'); await f.add('b/same.jpg');
    f.tags.set(a, ['Blue\n4']);
    const config = mode === 'list' ? f.list : f.compare;
    const plan = await f.service.preview({ ...config, colors: [], mergeTags: false });
    assert.equal(plan.requiresTags, true); assert.ok(plan.candidates > 0);
    assert.deepEqual(plan.rows.find(row => row.file === a).nextTags, ['Blue\n4']);
    await assert.rejects(f.service.execute(plan.id, selected(plan)), /selection.chooseTagsHint/);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
  });
  test(`${mode}: hard links are excluded from tag changes`, async t => {
    const f = await fixture(t); const a = await f.add('a/same.jpg'); await f.add('b/same.jpg');
    await fs.link(a, path.join(f.a, 'alias.jpg'));
    const plan = await f.service.preview(mode === 'list' ? { ...f.list, listText: 'same.jpg\nalias.jpg' } : f.compare);
    assert.equal(plan.rows.find(row => row.file === a).candidate, false);
    assert.equal(plan.warnings[0].key, 'warning.hardLinks');
  });
}
test('list tags supports listed/unlisted selections, extension filters, protected lists and checked-only execution', async t => {
  const f = await fixture(t), a = await f.add('a/same.jpg'), other = await f.add('a/other.jpg');
  const sidecar = await f.add('a/same.xmp'), list = await f.add('a/list.txt');
  await fs.writeFile(list, 'same.jpg\nlist.txt');
  const config = { ...f.list, listSource: 'file', list, includeExt: '.jpg', excludeExt: '.xmp' };
  let plan = await f.service.preview(config); assert.deepEqual(matchedFiles(plan), [a]);
  assert.equal(plan.rows.find(row => row.file === list).candidate, false);
  assert.equal(plan.rows.find(row => row.file === sidecar).candidate, false);
  const run = await f.service.execute(plan.id, selected(plan)); assert.equal(run.action, 'tags'); assert.equal(run.mode, 'list'); assert.deepEqual(f.writes, [a]);
  plan = await f.service.preview({ ...config, listMode: 'keep' }); assert.deepEqual(matchedFiles(plan), [other]);
  const unchanged = await f.service.preview(config); assert.equal(unchanged.matched, 1); assert.equal(unchanged.candidates, 0);
  assert.deepEqual(f.moved, []);
});
test('list tag matching respects filename, relative path and stem rules', async t => {
  const f = await fixture(t), a = await f.add('a/sub/same.JPG'); await f.add('a/other/same.jpg');
  let plan = await f.service.preview({ ...f.list, ignoreCase: true }); assert.equal(plan.matched, 2);
  plan = await f.service.preview({ ...f.list, matchBy: 'relative', listText: 'sub/same.JPG' }); assert.deepEqual(matchedFiles(plan), [a]);
  plan = await f.service.preview({ ...f.list, matchBy: 'stem', listText: 'same.NEF' }); assert.equal(plan.matched, 2);
});
for (const change of ['list', 'inventory', 'tags', 'file']) {
  test(`list tags: ${change} changes during confirmation block mutations`, async t => {
    const f = await fixture(t), a = await f.add('a/same.jpg'), list = await f.add('list.txt'); await fs.writeFile(list, 'same.jpg');
    const plan = await f.service.preview({ ...f.list, listSource: 'file', list });
    const run = await f.service.execute(plan.id, selected(plan), { confirm: async () => {
      if (change === 'list') await fs.appendFile(list, '\nother.jpg');
      if (change === 'inventory') await f.add('a/new.jpg');
      if (change === 'tags') f.tags.set(a, ['Red\n6']);
      if (change === 'file') await fs.appendFile(a, 'changed');
      return true;
    } });
    assert.equal(run.completed, 0); assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []); assert.ok(run.error);
  });
}
test('comparison refuses stale results when a previously unique name appears in the other folder', async t => {
  const f = await fixture(t); await f.add('a/same.jpg');
  const plan = await f.service.preview({ ...f.compare, compareSelection: 'onlyA' });
  const run = await f.service.execute(plan.id, selected(plan), { confirm: async () => { await f.add('b/same.jpg'); return true; } });
  assert.equal(run.completed, 0); assert.ok(run.error); assert.deepEqual(f.writes, []);
});

test('independent list tagging includes kept and extension-excluded rows without allowing them to be trashed', async t => {
  const f = await fixture(t), a = await f.add('a/same.jpg'), b = await f.add('a/other.txt');
  const plan = await f.service.preview({ ...f.list, listAction: 'trash', listMode: 'keep', includeExt: '.png' });
  assert.equal(plan.candidates, 0);
  const ids = plan.rows.map(row => row.id), options = { colors: ['green','red'], mergeTags: true };
  await assert.rejects(f.service.execute(plan.id, ids), /error.notCandidate/);
  await assert.rejects(f.service.tagSelected(plan.id, ['unknown'], options), /error.notCandidate/);
  await assert.rejects(f.service.tagSelected(plan.id, ids, { colors: [] }), /error.tagsRequired/);
  assert.deepEqual(await f.service.tagSelected(plan.id, ids, options, { confirm: async summary => { assert.equal(summary.action,'tags'); assert.deepEqual(summary.files,[b,a]); return false; } }), { declined: true });
  assert.equal(f.service.active.id, plan.id); assert.deepEqual(f.writes, []);
  const result = await f.service.tagSelected(plan.id, ids, options);
  assert.equal(result.completed, 2); assert.equal(result.action, 'tags');
  assert.deepEqual([...f.writes].sort(), [a,b].sort()); assert.deepEqual(f.moved, []);
});

test('independent tags reject a kept file changed after preview and preserve the original cleanup plan', async t => {
  const f = await fixture(t), a = await f.add('a/same.jpg');
  const plan = await f.service.preview({ ...f.list, listAction: 'trash', listMode: 'keep' });
  await fs.appendFile(a, 'changed');
  await assert.rejects(f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: ['red'] }), /File changed/);
  assert.equal(f.service.active.id, plan.id); assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
});

test('independent tags skip unchanged selections and reject hard links before confirmation', async t => {
  const f = await fixture(t), a = await f.add('a/same.jpg');
  f.tags.set(a, ['Red\n6']);
  let plan = await f.service.preview({ ...f.list, listAction: 'trash', listMode: 'keep' });
  assert.deepEqual(await f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: ['red'] }), { unchanged: true });
  assert.equal(f.service.active.id, plan.id);
  await fs.link(a, path.join(f.root, 'hard-link'));
  plan = await f.service.preview({ ...f.list, listAction: 'trash', listMode: 'keep' });
  await assert.rejects(f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: ['green'] }, { confirm: async () => assert.fail('No confirmation for blocked hard links') }), /selection.hardLinks/);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
});

test('independent tag actions revalidate selected files after confirmation', async t => {
  const f = await fixture(t), a = await f.add('a/same.jpg');
  const plan = await f.service.preview({ ...f.list, listAction: 'trash', listMode: 'keep' });
  const result = await f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: ['red'] }, { confirm: async () => { f.tags.set(a,['Blue\n4']); return true; } });
  assert.equal(result.completed, 0); assert.ok(result.error); assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []);
});

test('independent Clear tags previews existing tags and clears only checked tagged files, without colors', async t => {
  const f = await fixture(t), a = await f.add('a/same.jpg'), b = await f.add('a/other.jpg');
  const empty = await f.add('a/untagged.txt');
  f.tags.set(a, ['Blue\n4', 'Custom']); f.tags.set(b, ['Red\n6']);
  const config = { ...f.list, listAction: 'trash', listMode: 'keep', includeExt: '.png' };
  const plan = await f.service.preview(config);
  assert.equal(plan.candidates, 0);
  assert.deepEqual(plan.rows.find(row => row.file === a).currentTags, ['Blue\n4', 'Custom']);
  const ids = plan.rows.filter(row => [a, empty].includes(row.file)).map(row => row.id);
  const options = { colors: [], clearTags: true };
  assert.deepEqual(await f.service.tagSelected(plan.id, ids, options, { confirm: async () => false }), { declined: true });
  assert.deepEqual(f.writes, []); assert.equal(f.service.active.id, plan.id);
  const run = await f.service.tagSelected(plan.id, ids, options);
  assert.equal(run.completed, 1); assert.deepEqual(f.writes, [a]);
  assert.deepEqual(f.tags.get(a), []); assert.deepEqual(f.tags.get(b), ['Red\n6']);
  assert.deepEqual(f.moved, []);
  const refreshed = await f.service.preview(config);
  assert.deepEqual(refreshed.rows.find(row => row.file === a).currentTags, []);
  assert.equal(refreshed.candidates, 0);
});

test('independent tag actions reject tags changed since the displayed preview', async t => {
  const f = await fixture(t), a = await f.add('a/same.jpg');
  f.tags.set(a, ['Blue\n4']);
  const plan = await f.service.preview({ ...f.list, listAction: 'trash', listMode: 'keep' });
  f.tags.set(a, ['Red\n6']);
  await assert.rejects(f.service.tagSelected(plan.id, [plan.rows[0].id], { colors: [], clearTags: true }), /error.stale/);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.moved, []); assert.equal(f.service.active.id, plan.id);
});
