import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCleanupArgs, prepareCleanup, executeCleanup, parseList, createListPlan } from '../src/cleanup.js';
import { getFiles } from '../src/files.js';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'selection-review-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('review: a reference arriving between deletions protects the remaining pair', async t => {
  const root = await fixture(t);
  for (const name of ['anchor.NEF', 'a.JPG', 'b.JPG']) await fs.writeFile(path.join(root, name), name);
  const options = parseCleanupArgs(['clean-orphans', root, '--reference-ext', 'nef', '--apply', '--permanent']);
  const plan = await prepareCleanup(options);
  assert.deepEqual(plan.filesToUpdate.map(file => path.basename(file)), ['a.JPG', 'b.JPG']);
  const removed = [];
  const result = await executeCleanup(plan, options, {
    unlink: async file => {
      await fs.unlink(file);
      removed.push(path.basename(file));
      if (removed.length === 1) await fs.writeFile(path.join(root, 'b.NEF'), 'new reference');
    },
    trash: () => assert.fail('no live Trash'),
  });
  assert.equal(result.completed, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error.message, /matching reference appeared/iu);
  assert.deepEqual(removed, ['a.JPG'], 'the newly paired b.JPG must not be deleted');
  assert.equal(await fs.readFile(path.join(root, 'b.JPG'), 'utf8'), 'b.JPG');
});

test('review: replacing a discovered directory with a symlink must not scan outside the target', async t => {
  const root = await fixture(t);
  const target = path.join(root, 'target');
  const outside = path.join(root, 'outside');
  await fs.mkdir(path.join(target, 'sub'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'sentinel.JPG'), 'outside target');
  const original = fs.readdir;
  const reads = [];
  fs.readdir = async (directory, options) => {
    reads.push(await fs.realpath(directory));
    const entries = await original(directory, options);
    if (directory === target) {
      await fs.rename(path.join(target, 'sub'), path.join(root, 'saved-sub'));
      await fs.symlink(outside, path.join(target, 'sub'));
    }
    return entries;
  };
  try {
    // Rejecting the changed path is also acceptable; reading it is not.
    try { await getFiles(target); } catch (error) {
      assert.match(error.message, /symlink|changed|directory|ENOENT|ENOTDIR/iu);
    }
  } finally {
    fs.readdir = original;
  }
  assert(!reads.includes(outside), 'scanner followed a substituted directory symlink outside its target');
  assert.equal(await fs.readFile(path.join(outside, 'sentinel.JPG'), 'utf8'), 'outside target');
});

for (const obstruction of ['absent', 'file', 'file-ancestor']) {
  test(`review: separate reference tree with ${obstruction} counterpart still permits orphan cleanup`, async t => {
    const root = await fixture(t);
    const base = path.join(root, 'base');
    const target = path.join(root, 'target');
    const relativeDirectory = obstruction === 'file-ancestor' ? 'shoot/nested' : 'shoot';
    await fs.mkdir(base);
    await fs.mkdir(path.join(target, relativeDirectory), { recursive: true });
    await fs.writeFile(path.join(base, 'anchor.NEF'), 'reference');
    if (obstruction !== 'absent') await fs.writeFile(path.join(base, 'shoot'), 'ordinary reference-side file');
    const orphan = path.join(target, relativeDirectory, 'orphan.JPG');
    await fs.writeFile(orphan, 'orphan');
    const options = parseCleanupArgs(['clean-orphans', '--base', base, '--target', target,
      '--reference-ext', 'nef', '--apply', '--permanent']);
    const plan = await prepareCleanup(options);
    assert.deepEqual(plan.filesToUpdate, [orphan]);
    const result = await executeCleanup(plan, options, { trash: () => assert.fail('no live Trash') });
    assert.deepEqual(result.failures.map(({ error }) => error.message), []);
    assert.equal(result.completed, 1);
    await assert.rejects(fs.access(orphan), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(base, 'anchor.NEF'), 'utf8'), 'reference');
    if (obstruction !== 'absent') assert.equal(await fs.readFile(path.join(base, 'shoot'), 'utf8'), 'ordinary reference-side file');
  });
}

test('review: generated lists select exact oracle memberships in both directions', () => {
  let seed = 0x51ec710;
  const random = max => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 0x100000000) * max);
  };
  const choose = values => values[random(values.length)];
  const spell = value => choose([value, value.toUpperCase(), value.normalize('NFD')]);
  const signatures = new Set();
  let nonemptyKeep = 0;
  let nonemptyDelete = 0;
  // Store filename components independently of paths. The oracle never calls
  // production key helpers, basename/extname/parse, or derives expected results
  // from the opposite mode's output.
  for (let round = 0; round < 60; round += 1) {
    const roots = ['/generated/one', '/generated/two', '/generated/three'];
    const records = [];
    for (let group = 0; group < roots.length; group += 1) {
      const seen = new Set();
      for (let i = 0, count = 12 + random(24); i < count; i += 1) {
        const record = {
          group,
          directory: spell(choose(['', 'shoot-a/', 'shoot-b/', 'shoot-a/nested/'])),
          stem: spell(choose(['Café', 'alpha', 'beta', 'two.parts', ' spaced ', 'edit-[1]'])) + random(9),
          extension: spell(choose(['.jpg', '.nef', '.xmp', '.txt', ''])),
        };
        // A dotted filename always has a final extension: keep the generated
        // stem/extension metadata faithful to that contract.
        if (!record.extension && record.stem.includes('.')) record.extension = '.jpg';
        record.file = `${roots[group]}/${record.directory}${record.stem}${record.extension}`;
        if (!seen.has(record.file)) records.push(record);
        seen.add(record.file);
      }
    }
    const protectedRecord = { group: 0, directory: '', stem: 'input-list', extension: '.txt', file: `${roots[0]}/input-list.txt` };
    records.push(protectedRecord);
    const entries = records.filter(() => random(3) === 0).map(record => ({
      ...record,
      directory: spell(record.directory),
      stem: spell(record.stem),
      // Different extensions deliberately test stem equivalence versus full names.
      extension: random(4) === 0 ? '.other' : spell(record.extension),
    }));
    entries.push({ directory: 'missing/', stem: `absent-${round}`, extension: '.jpg' }, protectedRecord);
    const includeExt = choose([[], ['.jpg', '.nef'], ['.txt', '.xmp'], ['.jpg', '.txt', '.xmp']]);
    const excludeExt = choose([[], ['.xmp'], ['.jpg', '.txt']]);
    signatures.add(JSON.stringify([records, entries, includeExt, excludeExt]));
    for (const matchBy of ['name', 'relative', 'stem']) {
      for (const ignoreCase of [false, true]) {
        const options = { targets: roots, list: protectedRecord.file, matchBy, ignoreCase, includeExt, excludeExt };
        // Expected equality uses the generated components, not parsed filenames.
        const identity = record => {
          let value = (matchBy === 'relative' ? record.directory : '') + record.stem;
          if (matchBy !== 'stem') value += record.extension;
          value = value.normalize('NFC');
          return ignoreCase ? value.toLowerCase() : value;
        };
        const listLines = entries.map(record => `${record.directory}${record.stem}${record.extension}`);
        const keys = parseList([...listLines, listLines[0]].join(round % 2 ? '\r\n' : '\n'), options);
        const groups = roots.map((_, group) => records.filter(record => record.group === group).map(record => record.file));
        for (const mode of ['keep', 'delete']) {
          const expected = [];
          for (const record of records) {
            const extension = record.extension.toLowerCase();
            if (record === protectedRecord || (includeExt.length && !includeExt.includes(extension)) || excludeExt.includes(extension)) continue;
            const listed = entries.some(entry => identity(entry) === identity(record));
            if ((mode === 'delete' && listed) || (mode === 'keep' && !listed)) expected.push(record.file);
          }
          const actual = createListPlan(groups, keys, { ...options, mode }).filesToUpdate;
          assert.deepEqual(actual, expected, `seed=0x51ec710 round=${round} match=${matchBy} ignoreCase=${ignoreCase} mode=${mode}`);
          if (expected.length) {
            if (mode === 'keep') nonemptyKeep += 1;
            else nonemptyDelete += 1;
          }
        }
      }
    }
  }
  assert.equal(signatures.size, 60, 'generated datasets must not repeat');
  assert(nonemptyKeep > 100 && nonemptyDelete > 100, 'both directions need substantial nonempty oracle checks');
});
