// Explicit opt-in test. Never enumerates or empties Trash; restores only fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs, prepareCleanup, executeCleanup } from '../src/index.js';
import { moveToTrash } from '../src/cleanup.js';

if (process.platform !== 'darwin') throw new Error('This integration test requires macOS Finder');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fss-finder-integration-')));
const prefix = `fss-test-${randomUUID()}-`;
const fixtures = new Map();
const trashed = new Map();
let restored = 0;
let passed = false;

async function write(relative, content = `${prefix}${randomUUID()}`) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, { flag: 'wx' });
  fixtures.set(file, content);
  return file;
}
async function checkPresent(files) {
  for (const file of files) assert.equal(await fs.readFile(file, 'utf8'), fixtures.get(file));
}
async function checkTrashed(files) {
  for (const file of files) {
    await assert.rejects(fs.access(file), { code: 'ENOENT' });
    assert(trashed.has(file), `Missing Finder destination: ${file}`);
    assert.equal(await fs.readFile(trashed.get(file), 'utf8'), fixtures.get(file));
  }
}
async function trashFixture(file) {
  assert(fixtures.has(file), 'Only test fixtures may be trashed');
  const destination = await moveToTrash(file);
  assert(destination && path.isAbsolute(destination), 'Finder must return the actual Trash path');
  trashed.set(file, destination);
}
async function run(args, expectedCount) {
  const options = parseArgs(args);
  const plan = await prepareCleanup(options);
  assert.equal(plan.filesToUpdate.length, expectedCount);
  const result = await executeCleanup(plan, options, {
    trash: trashFixture,
    unlink: () => assert.fail('Live integration test must never permanently delete'),
  });
  if (result.failures.length) throw result.failures[0].error;
  assert.equal(result.completed, options.apply ? expectedCount : 0);
  console.log(`${options.command} ${options.mode ?? ''} ${options.apply ? 'real Trash' : 'preview'}: passed (${expectedCount} candidates)`);
}

console.log(`Isolated fixtures: ${root}`);
console.log('Finder Automation permission may be requested by macOS.');
try {
  const reference = await write(`orphans/${prefix}keep.NEF`);
  const paired = await write(`orphans/${prefix}keep.JPG`);
  const orphans = [
    await write(`orphans/${prefix}quote' Unicode-照片.JPG`),
    await write(`orphans/${prefix}orphan.XMP`),
    await write(`orphans/one/${prefix}collision.JPG`),
    await write(`orphans/two/${prefix}collision.JPG`),
  ];
  const orphanArgs = ['clean-orphans', `${root}/orphans`, '--reference-ext', 'nef'];
  await run(orphanArgs, 4);
  await checkPresent([reference, paired, ...orphans]);
  assert.equal(trashed.size, 0);
  await run([...orphanArgs, '--apply'], 4);
  await checkTrashed(orphans);
  assert.equal(new Set(trashed.values()).size, 4, 'Collision handling must preserve both files');
  await checkPresent([reference, paired]);

  for (const mode of ['keep', 'delete']) {
    const listed = await write(`${mode}/${prefix}listed.JPG`);
    const unlisted = await write(`${mode}/${prefix}unlisted.XMP`);
    const list = await write(`${mode}/${prefix}list.txt`, `${path.basename(listed)}\n`);
    const args = ['clean-list', `${root}/${mode}`, '--list', list, '--mode', mode];
    await run(args, 1);
    await checkPresent([listed, unlisted, list]);
    await run([...args, '--apply'], 1);
    await checkTrashed([mode === 'keep' ? unlisted : listed]);
    await checkPresent([mode === 'keep' ? listed : unlisted, list]);
  }
  assert.equal(trashed.size, 6);

  const raceAnchor = await write(`race/${prefix}anchor.NEF`);
  const first = await write(`race/${prefix}a.JPG`);
  const second = await write(`race/${prefix}b.JPG`);
  const options = parseArgs(['clean-orphans', `${root}/race`, '--reference-ext', 'nef', '--apply']);
  const plan = await prepareCleanup(options);
  assert.deepEqual(plan.filesToUpdate, [first, second]);
  let newReference;
  const result = await executeCleanup(plan, options, {
    trash: async file => {
      await trashFixture(file);
      newReference = await write(`race/${prefix}b.NEF`);
    },
    unlink: () => assert.fail('Must not permanently delete'),
  });
  assert.equal(result.completed, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error.message, /matching reference appeared/u);
  await checkTrashed([first]);
  await checkPresent([second, raceAnchor, newReference]);
  assert.equal(trashed.size, 7);
  console.log('Real Finder cleanup stops when a matching reference arrives: passed');
  passed = true;
} finally {
  // Match full content and use link + unlink to avoid overwriting existing files.
  // Failure preserves the fixture directory for recovery; never empty Trash.
  for (const [original, destination] of trashed) {
    assert.equal(await fs.readFile(destination, 'utf8'), fixtures.get(original));
    await fs.link(destination, original);
    await fs.unlink(destination);
    restored += 1;
  }
  await checkPresent([...fixtures.keys()]);
  await fs.rm(root, { recursive: true });
}
if (passed) console.log(`PASS: real Finder Trash, preview, reference/list preservation, collisions, Unicode/quotes; ${restored} files restored and all fixtures removed.`);
