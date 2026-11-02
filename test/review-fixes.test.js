import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/index.js';
import { directoryRoot } from '../src/files.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/finder-selection-sync.js', import.meta.url));
async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fss-review-fix-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(root, name), content);
  return root;
}

for (const command of ['clean-orphans', 'clean-list']) {
  for (const afterTerminator of [false, true]) {
    test(`${command} rejects an empty positional directory ${afterTerminator ? 'after --' : 'before options'}, never cleaning cwd`, async t => {
      const files = { 'keep.NEF': 'raw', 'victim.JPG': 'must survive', 'list.txt': 'keep.NEF' };
      const root = await fixture(t, files);
      const options = command === 'clean-orphans' ? ['--reference-ext', 'nef'] : ['--list', `${root}/list.txt`, '--mode', 'keep'];
      const args = afterTerminator
        ? [command, ...options, '--apply', '--permanent', '--', '']
        : [command, '', ...options, '--apply', '--permanent'];
      await assert.rejects(exec(process.execPath, [cli, ...args], { cwd: root }), error => error.code === 1);
      for (const [name, content] of Object.entries(files)) assert.equal(await fs.readFile(`${root}/${name}`, 'utf8'), content);
    });
  }
}

test('empty additional targets and explicitly empty legacy paths are rejected', () => {
  assert.throws(() => parseArgs(['clean-list', '/target', '', '--list', '/list', '--mode', 'keep']));
  assert.throws(() => parseArgs(['/base', '', '--delete-unmatched']));
  assert.throws(() => parseArgs(['--base', '', '--target', '/target', '--delete-unmatched']));
  assert.throws(() => parseArgs(['/base', '--target', '', '--delete-unmatched']));
});

test('directoryRoot rejects empty input defensively, while explicit dot still means cwd', async () => {
  await assert.rejects(directoryRoot(''), /empty|non-empty/u);
  assert.equal(await directoryRoot('.'), await fs.realpath(process.cwd()));
});

for (const mode of ['keep', 'delete']) {
  test(`list ${mode} consumes only the encoding BOM, retaining a leading literal U+FEFF in the filename`, async t => {
    const name = '\uFEFFspecial.JPG';
    const root = await fixture(t, { [name]: 'listed', 'special.JPG': 'different file', 'list.txt': `\uFEFF${name}\n` });
    const { stdout } = await exec(process.execPath, [cli, 'clean-list', root, '--list', `${root}/list.txt`, '--mode', mode, '--apply', '--permanent']);
    assert.match(stdout, /1 succeeded, 0 failed/u);
    const retained = mode === 'keep' ? name : 'special.JPG';
    const deleted = mode === 'keep' ? 'special.JPG' : name;
    await fs.access(`${root}/${retained}`);
    await assert.rejects(fs.access(`${root}/${deleted}`), { code: 'ENOENT' });
    await fs.access(`${root}/list.txt`);
  });
}

for (const matchBy of ['relative', 'name']) {
  test(`live reference guard preserves ${matchBy} case/Unicode matching when a reference appears`, async t => {
    const { prepareCleanup, executeCleanup } = await import('../src/cleanup.js');
    const root = await fs.realpath(await fixture(t, {}));
    const base = `${root}/base`;
    const target = `${root}/target`;
    const baseSub = matchBy === 'relative' ? 'Café' : 'new-reference-folder';
    const targetSub = 'cafe\u0301';
    await fs.mkdir(`${base}/${baseSub}`, { recursive: true });
    await fs.mkdir(`${target}/${targetSub}`, { recursive: true });
    await fs.writeFile(`${base}/anchor.NEF`, 'reference');
    await fs.writeFile(`${target}/a.JPG`, 'first orphan');
    const protectedCandidate = `${target}/${targetSub}/B.JPG`;
    await fs.writeFile(protectedCandidate, 'must survive');
    const options = parseArgs(['clean-orphans', '--base', base, '--target', target, '--reference-ext', 'nef', '--match-by', matchBy]);
    const plan = await prepareCleanup(options);
    const result = await executeCleanup(plan, { ...options, apply: true, permanent: true }, {
      unlink: async file => {
        await fs.unlink(file);
        await fs.writeFile(`${base}/${baseSub}/b.NeF`, 'new matching reference');
      },
    });
    assert.equal(result.completed, 1);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].error.message, /matching reference appeared/u);
    assert.equal(await fs.readFile(protectedCandidate, 'utf8'), 'must survive');
  });
}

test('live name reference guard respects no-recursive rather than protecting out-of-scope files', async t => {
  const { prepareCleanup, executeCleanup } = await import('../src/cleanup.js');
  const root = await fs.realpath(await fixture(t, { 'anchor.NEF': '', 'a.JPG': '', 'b.JPG': '' }));
  await fs.mkdir(`${root}/nested`);
  const options = parseArgs(['clean-orphans', root, '--reference-ext', 'nef', '--match-by', 'name', '--no-recursive']);
  const plan = await prepareCleanup(options);
  const result = await executeCleanup(plan, { ...options, apply: true, permanent: true }, {
    unlink: async file => {
      await fs.unlink(file);
      await fs.writeFile(`${root}/nested/b.NEF`, 'outside scan depth');
    },
  });
  assert.equal(result.completed, 2);
  assert.deepEqual(result.failures, []);
  await fs.access(`${root}/nested/b.NEF`);
});
