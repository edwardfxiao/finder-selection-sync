import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import {
  createPlan,
  createTagSyncPlan,
  getFinderTags,
  getMatchKey,
  parseArgs,
  run,
  setFinderTags,
  VERSION,
} from '../src/index.js';

const execFile = promisify(execFileCallback);

test('processed filenames and originals share a match key', () => {
  assert.equal(getMatchKey('/base/ITEM_0001.DAT'), 'item_0001');
  assert.equal(getMatchKey('/target/ITEM_0001-[variant-a][small].dat'), 'item_0001');
  assert.equal(
    getMatchKey('/target/ITEM_0001-[variant-a][small][export][web].dat'),
    'item_0001',
  );
  assert.equal(getMatchKey('/base/my-photo-name.JPG'), 'my-photo-name');
});

test('target selection supports positive, inverse, and all modes', () => {
  const base = ['/base/A.JPG', '/base/B.JPG'];
  const targets = [[
    '/target/A-[edit][1].jpg',
    '/target/B-[edit][1].jpg',
    '/target/C-[edit][1].jpg',
  ]];

  const positive = createPlan(base, targets, {
    scope: 'targets', select: 'matched', match: 'any',
  });
  assert.deepEqual(positive.filesToUpdate, [
    '/target/A-[edit][1].jpg',
    '/target/B-[edit][1].jpg',
  ]);

  const inverse = createPlan(base, targets, {
    scope: 'targets', select: 'unmatched', match: 'any',
  });
  assert.deepEqual(inverse.filesToUpdate, ['/target/C-[edit][1].jpg']);

  const all = createPlan(base, targets, {
    scope: 'targets', select: 'all', match: 'any',
  });
  assert.deepEqual(all.filesToUpdate, targets[0]);
});

test('any/all matching works for base scope across multiple targets', () => {
  const base = ['/base/A.JPG', '/base/B.JPG', '/base/C.JPG'];
  const targets = [
    ['/target-1/A-[edit][1].jpg', '/target-1/B-[edit][1].jpg'],
    ['/target-2/B-[edit][2].jpg', '/target-2/D-[edit][2].jpg'],
  ];

  const anyMatched = createPlan(base, targets, {
    scope: 'base', select: 'matched', match: 'any',
  });
  assert.deepEqual(anyMatched.filesToUpdate, ['/base/A.JPG', '/base/B.JPG']);

  const allMatched = createPlan(base, targets, {
    scope: 'base', select: 'matched', match: 'all',
  });
  assert.deepEqual(allMatched.filesToUpdate, ['/base/B.JPG']);

  const inverse = createPlan(base, targets, {
    scope: 'base', select: 'unmatched', match: 'any',
  });
  assert.deepEqual(inverse.filesToUpdate, ['/base/C.JPG']);
});

test('CLI defaults to target scope and dry-run mode', () => {
  const options = parseArgs(['/base', '/target']);
  assert.equal(options.scope, 'targets');
  assert.equal(options.select, 'matched');
  assert.equal(options.apply, false);
});

test('CLI accepts positional folders and explicit options', () => {
  const options = parseArgs([
    '/base',
    '/target-1',
    '/target-2',
    '--select',
    'unmatched',
    '--color',
    'red',
    '--apply',
  ]);
  assert.equal(options.base, '/base');
  assert.deepEqual(options.targets, ['/target-1', '/target-2']);
  assert.equal(options.select, 'unmatched');
  assert.equal(options.color, 'red');
  assert.equal(options.apply, true);
});

test('--clear-all overrides selection and color regardless of argument order', () => {
  const options = parseArgs([
    '/base',
    '/target',
    '--clear-all',
    '--select',
    'matched',
    '--color',
    'red',
  ]);
  assert.equal(options.select, 'all');
  assert.equal(options.color, 'clear');
  assert.equal(options.clearAll, true);
});

test('CLI accepts tag sync options and rejects legacy or incompatible combinations', () => {
  const options = parseArgs([
    '/base',
    '/target',
    '--sync-tags',
    '--merge-tags',
    '--include-clear',
    '--apply',
  ]);
  assert.equal(options.syncTags, true);
  assert.equal(options.mergeTags, true);
  assert.equal(options.includeClear, true);
  assert.equal(options.apply, true);

  assert.throws(
    () => parseArgs(['/base', '/target', '--sync-labels']),
    /Unknown option/u,
  );
  assert.throws(
    () => parseArgs(['/base', '/target', '--sync-tags', '--color', 'red']),
    /cannot be combined/u,
  );
  assert.throws(
    () => parseArgs(['/base', '/target', '--include-clear']),
    /requires --sync-tags/u,
  );
  assert.throws(
    () => parseArgs(['/base', '/target', '--merge-tags']),
    /requires --sync-tags/u,
  );
  assert.throws(
    () => parseArgs(['/base', '/target', '--sync-tags', '--scope', 'both']),
    /only --scope targets/u,
  );
});

test('CLI accepts --delete-unmatched and rejects ambiguous combinations', () => {
  const options = parseArgs(['/base', '/target', '--delete-unmatched', '--apply']);
  assert.equal(options.deleteUnmatched, true);
  assert.equal(options.apply, true);

  assert.throws(
    () => parseArgs(['/base', '/target', '--delete-unmatched', '--select', 'unmatched']),
    /cannot be combined/u,
  );
  assert.throws(
    () => parseArgs(['/base', '/target', '--delete-unmatched', '--color', 'clear']),
    /cannot be combined/u,
  );
  assert.throws(
    () => parseArgs(['/base', '/target', '--delete-unmatched', '--scope', 'base']),
    /only --scope targets/u,
  );
  assert.throws(
    () => parseArgs(['/base', '/target', '--delete-unmatched', '--sync-tags']),
    /cannot be combined/u,
  );
});

test('--delete-unmatched previews first and deletes only unmatched target files on apply', async context => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'finder-selection-delete-'));
  context.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const base = path.join(temporaryDirectory, 'base');
  const targetA = path.join(temporaryDirectory, 'target-a');
  const targetB = path.join(temporaryDirectory, 'target-b');
  await Promise.all([
    fs.mkdir(base),
    fs.mkdir(targetA),
    fs.mkdir(targetB),
  ]);
  await Promise.all([
    fs.writeFile(path.join(base, 'ITEM_0001.DAT'), 'base'),
    fs.writeFile(path.join(targetA, 'ITEM_0001-[variant][a].dat'), 'matched'),
    fs.writeFile(path.join(targetA, 'ITEM_0002-[variant][a].dat'), 'unmatched a'),
    fs.writeFile(path.join(targetB, 'ITEM_0003-[variant][b].dat'), 'unmatched b'),
  ]);

  const previewOptions = parseArgs([base, targetA, targetB, '--delete-unmatched']);
  const preview = await run(previewOptions);
  assert.equal(preview.plan.filesToUpdate.length, 2);
  assert.equal(
    await fs.readFile(path.join(targetA, 'ITEM_0002-[variant][a].dat'), 'utf8'),
    'unmatched a',
  );

  const applyOptions = parseArgs([base, targetA, targetB, '--delete-unmatched', '--apply']);
  const applied = await run(applyOptions);
  assert.equal(applied.failures.length, 0);
  assert.deepEqual(await fs.readdir(targetA), ['ITEM_0001-[variant][a].dat']);
  assert.deepEqual(await fs.readdir(targetB), []);
});

test('tag sync replaces, merges, and optionally includes untagged files', async () => {
  const base = ['/base/A.JPG', '/base/B.JPG', '/base/C.JPG'];
  const targets = [[
    '/target/A-[variant][1].jpg',
    '/target/B-[variant][1].jpg',
    '/target/C-[variant][1].jpg',
    '/target/D-[variant][1].jpg',
  ]];
  const tags = new Map([
    ['/base/A.JPG', ['Red\n6', 'Green\n2']],
    ['/base/B.JPG', []],
    ['/base/C.JPG', ['Project Alpha\n0']],
    ['/target/A-[variant][1].jpg', ['Orange\n7']],
    ['/target/B-[variant][1].jpg', ['Purple\n3']],
    ['/target/C-[variant][1].jpg', ['Project Alpha\n0']],
    ['/target/D-[variant][1].jpg', []],
  ]);
  const readTags = file => tags.get(file);

  const replace = await createTagSyncPlan(base, targets, { readTags });
  assert.deepEqual(replace.operations, [{
    file: '/target/A-[variant][1].jpg',
    key: 'a',
    currentTags: ['Orange\n7'],
    tags: ['Red\n6', 'Green\n2'],
  }]);
  assert.equal(replace.skippedUntaggedFiles, 1);
  assert.deepEqual(replace.unchangedByTarget, [1]);

  const includingClear = await createTagSyncPlan(base, targets, {
    includeClear: true,
    readTags,
  });
  assert.deepEqual(includingClear.operations, [
    {
      file: '/target/A-[variant][1].jpg',
      key: 'a',
      currentTags: ['Orange\n7'],
      tags: ['Red\n6', 'Green\n2'],
    },
    {
      file: '/target/B-[variant][1].jpg',
      key: 'b',
      currentTags: ['Purple\n3'],
      tags: [],
    },
  ]);
  assert.equal(includingClear.skippedUntaggedFiles, 0);

  const merge = await createTagSyncPlan(base, targets, {
    mergeTags: true,
    readTags,
  });
  assert.deepEqual(merge.operations[0].tags, ['Orange\n7', 'Red\n6', 'Green\n2']);
});

test('tag sync accepts equivalent duplicate sets and reports conflicting sets', async () => {
  const base = ['/base/A.JPG', '/base/A.CR3'];
  const targets = [['/target/A-[variant][1].jpg']];
  const equivalentTags = new Map([
    ['/base/A.JPG', ['Red\n6', 'Green\n2']],
    ['/base/A.CR3', ['Green\n2', 'Red\n6']],
    ['/target/A-[variant][1].jpg', []],
  ]);
  const equivalent = await createTagSyncPlan(base, targets, {
    readTags: file => equivalentTags.get(file),
  });
  assert.equal(equivalent.conflicts.length, 0);
  assert.equal(equivalent.operations.length, 1);

  const conflictingTags = new Map([
    ['/base/A.JPG', ['Red\n6']],
    ['/base/A.CR3', ['Green\n2']],
    ['/target/A-[variant][1].jpg', []],
  ]);
  const conflict = await createTagSyncPlan(base, targets, {
    readTags: file => conflictingTags.get(file),
  });
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.conflicts[0].key, 'a');
  assert.deepEqual(conflict.operations, []);
});

test('package version is exposed', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/u);
});

test('Finder tags support multiple colors, legacy fallback, sync, and clearing', {
  skip: process.platform !== 'darwin',
}, async context => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'finder-selection-sync-'));
  context.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const file = path.join(temporaryDirectory, 'fixture.dat');
  await fs.writeFile(file, 'fixture');
  assert.deepEqual(await getFinderTags(file), []);

  const original = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  original[9] = 0x01;
  await execFile('/usr/bin/xattr', [
    '-wx',
    'com.apple.FinderInfo',
    original.toString('hex'),
    file,
  ]);

  const legacyRed = Buffer.from(original);
  legacyRed[9] = 0x0d;
  await execFile('/usr/bin/xattr', [
    '-wx',
    'com.apple.FinderInfo',
    legacyRed.toString('hex'),
    file,
  ]);
  assert.deepEqual(await getFinderTags(file), ['Red\n6']);
  const { stdout } = await execFile('/usr/bin/xattr', [
    '-px',
    'com.apple.FinderInfo',
    file,
  ]);
  const actual = Buffer.from(stdout.replace(/\s/g, ''), 'hex');
  const expected = Buffer.from(original);
  expected[9] = 0x0d;
  assert.deepEqual(actual, expected);

  const sourceTags = ['Red\n6', 'Green\n2', 'Project Alpha\n0'];
  await setFinderTags(file, sourceTags);
  assert.deepEqual(await getFinderTags(file), sourceTags);

  const targetFile = path.join(temporaryDirectory, 'fixture-[variant][small].dat');
  await fs.writeFile(targetFile, 'target fixture');
  await setFinderTags(targetFile, ['Orange\n7']);
  const syncPlan = await createTagSyncPlan([file], [[targetFile]]);
  assert.deepEqual(syncPlan.operations, [{
    file: targetFile,
    key: 'fixture',
    currentTags: ['Orange\n7'],
    tags: sourceTags,
  }]);
  await setFinderTags(targetFile, syncPlan.operations[0].tags);
  assert.deepEqual(await getFinderTags(targetFile), sourceTags);

  await setFinderTags(file, []);
  assert.deepEqual(await getFinderTags(file), []);
  const { stdout: clearedStdout } = await execFile('/usr/bin/xattr', [
    '-px',
    'com.apple.FinderInfo',
    file,
  ]);
  const cleared = Buffer.from(clearedStdout.replace(/\s/g, ''), 'hex');
  expected[9] = 0x01;
  assert.deepEqual(cleared, expected);

  const clearPlan = await createTagSyncPlan([file], [[targetFile]], {
    includeClear: true,
  });
  assert.deepEqual(clearPlan.operations[0].tags, []);
  await setFinderTags(targetFile, clearPlan.operations[0].tags);
  assert.deepEqual(await getFinderTags(targetFile), []);
});
