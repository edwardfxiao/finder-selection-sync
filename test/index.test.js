import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import {
  createPlan,
  getMatchKey,
  parseArgs,
  setFinderLabel,
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
  assert.deepEqual(positive.filesToLabel, [
    '/target/A-[edit][1].jpg',
    '/target/B-[edit][1].jpg',
  ]);

  const inverse = createPlan(base, targets, {
    scope: 'targets', select: 'unmatched', match: 'any',
  });
  assert.deepEqual(inverse.filesToLabel, ['/target/C-[edit][1].jpg']);

  const all = createPlan(base, targets, {
    scope: 'targets', select: 'all', match: 'any',
  });
  assert.deepEqual(all.filesToLabel, targets[0]);
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
  assert.deepEqual(anyMatched.filesToLabel, ['/base/A.JPG', '/base/B.JPG']);

  const allMatched = createPlan(base, targets, {
    scope: 'base', select: 'matched', match: 'all',
  });
  assert.deepEqual(allMatched.filesToLabel, ['/base/B.JPG']);

  const inverse = createPlan(base, targets, {
    scope: 'base', select: 'unmatched', match: 'any',
  });
  assert.deepEqual(inverse.filesToLabel, ['/base/C.JPG']);
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

test('package version is exposed', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/u);
});

test('Finder label writes and clearing preserve unrelated FinderInfo bits', {
  skip: process.platform !== 'darwin',
}, async context => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'finder-selection-sync-'));
  context.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const file = path.join(temporaryDirectory, 'fixture.dat');
  await fs.writeFile(file, 'fixture');

  const original = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  original[9] = 0x01;
  await execFile('/usr/bin/xattr', [
    '-wx',
    'com.apple.FinderInfo',
    original.toString('hex'),
    file,
  ]);

  await setFinderLabel(file, 'red');
  const { stdout } = await execFile('/usr/bin/xattr', [
    '-px',
    'com.apple.FinderInfo',
    file,
  ]);
  const actual = Buffer.from(stdout.replace(/\s/g, ''), 'hex');
  const expected = Buffer.from(original);
  expected[9] = 0x0d;
  assert.deepEqual(actual, expected);

  await setFinderLabel(file, 'clear');
  const { stdout: clearedStdout } = await execFile('/usr/bin/xattr', [
    '-px',
    'com.apple.FinderInfo',
    file,
  ]);
  const cleared = Buffer.from(clearedStdout.replace(/\s/g, ''), 'hex');
  expected[9] = 0x01;
  assert.deepEqual(cleared, expected);
});
