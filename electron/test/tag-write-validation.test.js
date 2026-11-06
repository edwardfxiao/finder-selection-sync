import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopService } from '../service.js';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'finder-tag-write-validation-')));
  const base = path.join(root, 'base'), target = path.join(root, 'target');
  await fs.mkdir(base); await fs.mkdir(target);
  const file = path.join(target, 'A.jpg'), reference = path.join(base, 'A.NEF'), outside = path.join(root, 'outside.txt');
  await fs.writeFile(file, 'previewed file');
  await fs.writeFile(reference, 'reference');
  await fs.writeFile(outside, 'outside the selected folders');
  const tags = new Map([[reference, ['Green\n2']]]), writes = [];
  const service = new DesktopService({
    readTags: async file => tags.get(file) ?? [],
    writeTags: async (file, values) => { writes.push({ file, tags: [...values] }); tags.set(file, [...values]); },
    trash: async () => assert.fail('Tag actions cannot move files to Trash'),
  });
  t.after(async () => { await service.discardAll(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, base, target, file, reference, outside, tags, writes, service };
}

for (const mode of ['list', 'filter', 'compare']) {
  test(`${mode}: a mixed hard-link selection is rejected before loading a writable tag preview`, async t => {
    const f = await fixture(t), regular = path.join(f.target, 'B.jpg');
    await fs.writeFile(regular, 'ordinary file');
    await fs.writeFile(path.join(f.base, 'B.NEF'), 'reference');
    await fs.link(f.file, path.join(f.root, 'existing-hard-link.jpg'));
    let reads = 0;
    const readTags = f.service.readTags;
    f.service.readTags = async file => { reads++; return readTags(file); };
    const config = { mode, targets: [f.target], ...(mode === 'list'
      ? { listSource: 'text', listText: 'A.jpg', listMode: 'keep' }
      : mode === 'compare' ? { base: f.base, matchBy: 'stem', scope: 'targets', compareAction: 'review' } : {}) };
    const plan = await f.service.preview(config), initialReads = reads;
    const chosen = plan.rows.filter(row => [f.file, regular].includes(row.file));
    await assert.rejects(f.service.selectedTags(plan.id, chosen.map(row => row.id)), error => {
      assert.equal(error.key, 'selection.hardLinks'); assert.equal(error.params.count, 1); return true;
    });
    assert.equal(reads, initialReads);
    assert.equal(f.service.active.id, plan.id); assert.equal(f.service.busy, false);
    const row = plan.rows.find(row => row.file === regular);
    assert.deepEqual((await f.service.selectedTags(plan.id, [row.id])).map(row => row.file), [regular]);
    assert.equal(reads, initialReads + 1);
    assert.deepEqual(f.writes, []);
  });
}

for (const change of ['replacement', 'symlink', 'hard link']) {
  test(`tag writes reject a ${change} introduced while reading current tags`, async t => {
    const f = await fixture(t);
    const plan = await f.service.preview({ mode: 'filter', targets: [f.target], filterAction: 'tags', colors: ['red'] });
    f.service.readTags = async file => {
      assert.equal(file, f.file);
      if (change === 'replacement') {
        await fs.rename(file, path.join(f.root, 'previous-file.jpg'));
        await fs.writeFile(file, 'unpreviewed replacement');
      } else if (change === 'symlink') {
        await fs.unlink(file);
        await fs.symlink(f.outside, file);
      } else await fs.link(file, path.join(f.root, 'new-hard-link.jpg'));
      return [];
    };
    const run = await f.service.execute(plan.id, [plan.rows[0].id]);
    assert.equal(run.completed, 0); assert.equal(run.failed, 1); assert.ok(run.error);
    assert.deepEqual(f.writes, []);
    assert.equal(await fs.readFile(f.outside, 'utf8'), 'outside the selected folders');
  });
}

test('sync tags revalidate the reference after reading the target metadata', async t => {
  const f = await fixture(t);
  const plan = await f.service.preview({ mode: 'tags', base: f.base, targets: [f.target], tagAction: 'sync', mergeTags: true });
  assert.equal(plan.candidates, 1);
  f.service.readTags = async file => {
    assert.equal(file, f.file);
    f.tags.set(f.reference, ['Red\n6']);
    // Finder metadata changes alter ctime. A changed fixture timestamp models
    // that version change without touching real Finder tags.
    await fs.utimes(f.reference, new Date(0), new Date(0));
    return [];
  };
  const run = await f.service.execute(plan.id, [plan.rows[0].id]);
  assert.equal(run.completed, 0); assert.equal(run.error.key, 'error.stale');
  assert.deepEqual(f.writes, []);
});

test('cancelling during the tag read stops before the final validation and write', async t => {
  const f = await fixture(t);
  const plan = await f.service.preview({ mode: 'filter', targets: [f.target], filterAction: 'tags', colors: ['red'] });
  f.service.readTags = async () => { f.service.cancel(); return []; };
  const run = await f.service.execute(plan.id, [plan.rows[0].id]);
  assert.equal(run.cancelled, true); assert.equal(run.completed, 0); assert.equal(run.failed, 0); assert.equal(run.error, null);
  assert.deepEqual(f.writes, []);
});

test('unchanged file versions still receive the confirmed tags exactly once', async t => {
  const f = await fixture(t);
  const plan = await f.service.preview({ mode: 'tags', base: f.base, targets: [f.target], tagAction: 'sync', mergeTags: true });
  const run = await f.service.execute(plan.id, [plan.rows[0].id], { confirm: async summary => {
    assert.deepEqual(summary.files, [f.file]); assert.equal(summary.action, 'tags'); return true;
  } });
  assert.equal(run.completed, 1); assert.equal(run.failed, 0); assert.equal(run.error, null);
  assert.deepEqual(f.writes, [{ file: f.file, tags: ['Green\n2'] }]);
});
