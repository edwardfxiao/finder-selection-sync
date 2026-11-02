import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseArgs, run } from '../src/index.js';
import { parseCleanupArgs, prepareCleanup, executeCleanup, createPhotoPlan, parseList,
  createListPlan, moveToTrash, trashScript } from '../src/cleanup.js';
import { getFiles } from '../src/files.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/finder-selection-sync.js', import.meta.url));
async function fixture(t, files = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'selection-cleanup-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}
const photos = (root, reference = 'cr3', extra = []) => parseArgs(['clean-orphans', root, '--reference', reference, ...extra]);
const listOptions = (root, extra = []) => parseArgs(['clean-list', root, '--list', path.join(root, 'list.txt'), '--mode', 'keep', ...extra]);
const relativeSelected = (plan, root) => plan.filesToUpdate.map(file => path.relative(root, file)).sort();
const remains = async file => { await fs.access(file); };
const absent = async file => assert.rejects(fs.access(file), { code: 'ENOENT' });

for (const reference of ['cr3', 'jpeg']) {
  test(`photos ${reference}: preview and permanent apply preserve reference, pairs, sidecars and unrelated formats`, async t => {
    const root = await fixture(t, { 'pair.CR3': 'raw', 'pair.JPG': 'jpeg', 'pair.jpeg': 'jpeg2',
      'raw-only.cr3': 'raw', 'jpeg-only.JpG': 'jpg', 'jpeg-only.JPEG': 'jpeg',
      'sidecar.XMP': 'metadata', 'video.mov': 'movie', 'other.HEIC': 'heic', '.hidden.CR3': 'hidden' });
    const options = photos(root, reference);
    const plan = await prepareCleanup(options);
    const expected = reference === 'cr3' ? ['jpeg-only.JPEG', 'jpeg-only.JpG'] : ['raw-only.cr3'];
    assert.deepEqual(relativeSelected(plan, root), expected.sort());
    const preview = await executeCleanup(plan, options, { trash: () => assert.fail('preview must not trash'), unlink: () => assert.fail('preview must not unlink') });
    assert.equal(preview.completed, 0);
    for (const file of plan.filesToUpdate) await remains(file);
    const applied = await executeCleanup(plan, { ...options, apply: true, permanent: true });
    assert.equal(applied.completed, expected.length);
    assert.deepEqual(applied.failures, []);
    for (const file of plan.filesToUpdate) await absent(file);
    for (const name of ['pair.CR3', 'pair.JPG', 'pair.jpeg', 'sidecar.XMP', 'video.mov', 'other.HEIC', '.hidden.CR3']) await remains(path.join(root, name));
    const next = await prepareCleanup(options);
    assert.deepEqual(next.filesToUpdate, []);
  });
}

test('relative photo matching isolates shoots; name matching is an explicit opt-in', async t => {
  const root = await fixture(t, { 'day1/IMG.CR3': '', 'day1/IMG.JPG': '', 'day2/IMG.JPG': '', 'day2/IMG.JPEG': '' });
  assert.deepEqual(relativeSelected(await prepareCleanup(photos(root)), root), ['day2/IMG.JPEG', 'day2/IMG.JPG']);
  assert.deepEqual((await prepareCleanup(photos(root, 'cr3', ['--match-by', 'name']))).filesToUpdate, []);
});

test('photo matching folds case and Unicode, preserves processing suffixes, dots and copy names', () => {
  const options = { base: '/base', targets: ['/target'], reference: 'cr3', matchBy: 'relative' };
  const plan = createPhotoPlan(['/base/SHOOT/Café.CR3', '/base/a.b.CR3', '/base/photo.CR3'], [[
    '/target/shoot/CAFE\u0301.JPEG', '/target/A.B.jpg', '/target/photo-[edit].jpg', '/target/photo copy.jpg',
  ]], options);
  assert.deepEqual(plan.filesToUpdate, ['/target/photo-[edit].jpg', '/target/photo copy.jpg']);
});

for (const reference of ['cr3', 'jpeg']) {
  test(`separate photo folders and multiple targets, reference ${reference}`, async t => {
    const sourceExt = reference === 'cr3' ? 'CR3' : 'JPEG';
    const targetExt = reference === 'cr3' ? 'JPG' : 'CR3';
    const root = await fixture(t, { [`base/day/a.${sourceExt}`]: '', [`a/day/a.${targetExt}`]: '',
      [`a/day/b.${targetExt}`]: '', [`b/day/a.${targetExt}`]: '', [`b/day/c.${targetExt}`]: '' });
    const options = parseArgs(['clean-orphans', '--base', `${root}/base`, '--target', `${root}/a`, '--target', `${root}/b`, '--reference', reference]);
    const plan = await prepareCleanup(options);
    assert.deepEqual(relativeSelected(plan, root), [`a/day/b.${targetExt}`, `b/day/c.${targetExt}`]);
    await executeCleanup(plan, { ...options, apply: true, permanent: true });
    await remains(`${root}/base/day/a.${sourceExt}`);
    await remains(`${root}/a/day/a.${targetExt}`);
    await remains(`${root}/b/day/a.${targetExt}`);
  });
}

test('empty photo reference is blocked unless explicitly allowed', async t => {
  const root = await fixture(t, { 'orphan.JPG': '', 'note.txt': '' });
  await assert.rejects(prepareCleanup(photos(root)), /Empty photo reference/u);
  const plan = await prepareCleanup(photos(root, 'cr3', ['--allow-empty']));
  assert.deepEqual(relativeSelected(plan, root), ['orphan.JPG']);
});

test('recursion, depth, hidden files and symlinks are respected', async t => {
  const root = await fixture(t, { 'ref.CR3': '', 'top.JPG': '', 'one/a.JPG': '', 'one/two/b.JPG': '',
    '.hidden-dir/a.JPG': '', '.hidden.JPG': '', 'outside/secret.JPG': '' });
  await fs.symlink(`${root}/outside`, `${root}/one/link`);
  await fs.symlink(`${root}/outside/secret.JPG`, `${root}/alias.JPG`);
  assert.deepEqual(relativeSelected(await prepareCleanup(photos(root, 'cr3', ['--no-recursive'])), root), ['top.JPG']);
  assert.deepEqual(relativeSelected(await prepareCleanup(photos(root, 'cr3', ['--depth', '1'])), root), ['one/a.JPG', 'outside/secret.JPG', 'top.JPG']);
  const scanned = await getFiles(root);
  assert(!scanned.some(file => file.includes('/.hidden') || file.includes('/link/') || file.endsWith('/alias.JPG')));
});

for (const mode of ['keep', 'delete']) {
  test(`list ${mode}: exact full filenames, CRLF, BOM, duplicates, blank lines and list protection`, async t => {
    const root = await fixture(t, { 'list.txt': '\uFEFFa.js\r\n\r\na.js\r\nlist.txt\r\n', 'a.js': 'keep', 'a.css': 'other', 'b.js': 'other' });
    const options = parseArgs(['clean-list', root, '--list', `${root}/list.txt`, '--mode', mode]);
    const plan = await prepareCleanup(options);
    assert.deepEqual(relativeSelected(plan, root), mode === 'keep' ? ['a.css', 'b.js'] : ['a.js']);
    const result = await executeCleanup(plan, { ...options, apply: true, permanent: true });
    assert.equal(result.failures.length, 0);
    await remains(`${root}/list.txt`);
    if (mode === 'keep') await remains(`${root}/a.js`);
    else { await remains(`${root}/a.css`); await remains(`${root}/b.js`); }
  });
}

test('list matching supports relative paths, exact name, stem and explicit case folding', async t => {
  const root = await fixture(t, { 'list.txt': 'one/A.JPG\n', 'one/A.JPG': '', 'two/A.JPG': '', 'one/A.CR3': '', 'one/a.jpeg': '' });
  assert.deepEqual(relativeSelected(await prepareCleanup(listOptions(root)), root), ['one/A.CR3', 'one/a.jpeg']);
  assert.deepEqual(relativeSelected(await prepareCleanup(listOptions(root, ['--match-by', 'relative'])), root), ['one/A.CR3', 'one/a.jpeg', 'two/A.JPG']);
  assert.deepEqual(relativeSelected(await prepareCleanup(listOptions(root, ['--match-by', 'stem'])), root), ['one/a.jpeg']);
  assert.deepEqual((await prepareCleanup(listOptions(root, ['--match-by', 'stem', '--ignore-case']))).filesToUpdate, []);
});

test('list extension filters are case insensitive; exclusions win; unrelated files remain', async t => {
  const root = await fixture(t, { 'list.txt': 'a.JPG\n', 'a.JPG': '', 'b.JPG': '', 'b.JPEG': '', 'b.CR3': '', 'b.XMP': '', 'no-extension': '' });
  const plan = await prepareCleanup(listOptions(root, ['--include-ext', '.JPG,jpeg,cr3', '--exclude-ext', 'CR3']));
  assert.deepEqual(relativeSelected(plan, root), ['b.JPEG', 'b.JPG']);
});

test('list names preserve spaces, quotes, shell metacharacters and Unicode normalization', async t => {
  const names = ["it's a photo.JPG", '$(touch NEVER).JPG', '`echo bad`.JPG', ' leading and trailing ', 'Café.JPG', '#literal.JPG'];
  const files = Object.fromEntries(names.map(name => [name, 'original']));
  const root = await fixture(t, { ...files, 'list.txt': names.map(name => name.normalize('NFD')).join('\n') });
  assert.deepEqual((await prepareCleanup(listOptions(root))).filesToUpdate, []);
  const options = parseArgs(['clean-list', root, '--list', `${root}/list.txt`, '--mode', 'delete']);
  const plan = await prepareCleanup(options);
  assert.equal(plan.filesToUpdate.length, names.length);
  const result = await executeCleanup(plan, { ...options, apply: true, permanent: true });
  assert.equal(result.completed, names.length);
  assert.deepEqual(await fs.readdir(root), ['list.txt']);
});

test('list supports absolute paths in name mode and multiple target folders', async t => {
  const root = await fixture(t, { 'list.txt': '/elsewhere/a.txt\n', 'one/a.txt': '', 'one/b.txt': '', 'two/a.txt': '', 'two/c.txt': '' });
  const options = parseArgs(['clean-list', `${root}/one`, `${root}/two`, '--list', `${root}/list.txt`, '--mode', 'keep']);
  assert.deepEqual(relativeSelected(await prepareCleanup(options), root), ['one/b.txt', 'two/c.txt']);
});

for (const content of ['', ' \n\r\n', '\uFEFF', 'bad\0name']) {
  test(`invalid/empty list aborts without deleting: ${JSON.stringify(content)}`, async t => {
    const root = await fixture(t, { 'list.txt': content, 'precious.JPG': 'original' });
    await assert.rejects(prepareCleanup(listOptions(root, ['--apply', '--permanent'])), /Empty list|UTF-8/u);
    assert.equal(await fs.readFile(`${root}/precious.JPG`, 'utf8'), 'original');
  });
}

test('missing list, directory as list and missing target fail before mutation', async t => {
  const root = await fixture(t, { 'keep.txt': '' });
  await assert.rejects(prepareCleanup(listOptions(root)), /ENOENT/u);
  await fs.mkdir(`${root}/list.txt`);
  await assert.rejects(prepareCleanup(listOptions(root)), /regular file/u);
  await assert.rejects(prepareCleanup(photos(`${root}/missing`)), /ENOENT/u);
  await assert.rejects(prepareCleanup(photos(`${root}/keep.txt`)), /Not a directory/u);
  await remains(`${root}/keep.txt`);
});

for (const entry of ['../secret.txt', '/absolute.txt', 'a/../../secret', 'folder/', '.']) {
  test(`relative list rejects unsafe entry ${entry}`, () => {
    assert.throws(() => parseList(entry, { matchBy: 'relative' }), /relative|file/u);
  });
}

test('explicit empty keep-list cleans candidates; empty delete-list selects nothing', async t => {
  const root = await fixture(t, { 'list.txt': '', 'a.txt': '' });
  assert.deepEqual(relativeSelected(await prepareCleanup(listOptions(root, ['--allow-empty'])), root), ['a.txt']);
  const options = parseArgs(['clean-list', root, '--list', `${root}/list.txt`, '--mode', 'delete', '--allow-empty']);
  assert.deepEqual((await prepareCleanup(options)).filesToUpdate, []);
});

test('list file and its hard links are protected even with delete-all matching', async t => {
  const root = await fixture(t, { 'list.txt': 'list.txt\ncopy.txt\n', 'other.txt': '' });
  await fs.link(`${root}/list.txt`, `${root}/copy.txt`);
  const options = parseArgs(['clean-list', root, '--list', `${root}/list.txt`, '--mode', 'delete']);
  assert.deepEqual((await prepareCleanup(options)).filesToUpdate, []);
});

test('reference hard links with target extensions remain protected', async t => {
  const root = await fixture(t, { 'ref.CR3': 'raw' });
  await fs.link(`${root}/ref.CR3`, `${root}/orphan.JPG`);
  assert.deepEqual((await prepareCleanup(photos(root))).filesToUpdate, []);
});

for (const kind of ['duplicate', 'nested', 'alias', 'base-target']) {
  test(`cleanup rejects overlapping roots: ${kind}`, async t => {
    const root = await fixture(t, { 'list.txt': 'keep', 'one/ref.CR3': '', 'one/sub/orphan.JPG': '' });
    await fs.symlink(`${root}/one`, `${root}/alias`);
    const targets = kind === 'duplicate' ? [`${root}/one`, `${root}/one`]
      : kind === 'nested' ? [`${root}/one`, `${root}/one/sub`]
      : [`${root}/one`, `${root}/alias`];
    const options = kind === 'base-target'
      ? parseArgs(['clean-orphans', '--base', `${root}/one`, '--target', `${root}/one/sub`, '--reference', 'cr3'])
      : parseArgs(['clean-list', ...targets, '--list', `${root}/list.txt`, '--mode', 'keep']);
    await assert.rejects(prepareCleanup(options), /overlap/u);
    await remains(`${root}/one/sub/orphan.JPG`);
  });
}

test('root aliases are canonicalized and ordinary sibling names are not overlaps', async t => {
  const root = await fixture(t, { 'list.txt': 'keep', 'a/x.txt': '', 'ab/y.txt': '' });
  await fs.symlink(`${root}/a`, `${root}/alias`);
  const options = parseArgs(['clean-list', `${root}/alias`, `${root}/ab`, '--list', `${root}/list.txt`, '--mode', 'keep']);
  assert.deepEqual(relativeSelected(await prepareCleanup(options), root), ['a/x.txt', 'ab/y.txt']);
});

for (const change of ['candidate-content', 'candidate-replaced', 'reference', 'list', 'candidate-symlink', 'ancestor-symlink']) {
  test(`preflight aborts entire plan when ${change} changes after preview`, async t => {
    const root = await fixture(t, { 'list.txt': 'keep.txt\n', 'ref.CR3': 'raw', 'sub/a.JPG': 'a', 'sub/b.JPG': 'b' });
    const options = change === 'list' ? listOptions(root) : photos(root);
    const plan = await prepareCleanup(options);
    if (change === 'candidate-content') await fs.writeFile(`${root}/sub/b.JPG`, 'changed content');
    if (change === 'candidate-replaced') { await fs.unlink(`${root}/sub/b.JPG`); await fs.writeFile(`${root}/sub/b.JPG`, 'replacement'); }
    if (change === 'reference') await fs.unlink(`${root}/ref.CR3`);
    if (change === 'list') await fs.writeFile(`${root}/list.txt`, 'different.txt\n');
    if (change === 'candidate-symlink') { await fs.unlink(`${root}/sub/b.JPG`); await fs.symlink(`${root}/ref.CR3`, `${root}/sub/b.JPG`); }
    if (change === 'ancestor-symlink') { await fs.rename(`${root}/sub`, `${root}/moved`); await fs.symlink(`${root}/moved`, `${root}/sub`); }
    let calls = 0;
    await assert.rejects(executeCleanup(plan, { apply: true }, { trash: async () => { calls += 1; } }));
    assert.equal(calls, 0);
    await remains(`${root}/sub/a.JPG`);
  });
}

test('Trash is default, permanent is explicit, failures stop processing with no unlink fallback', async t => {
  const root = await fixture(t, { 'ref.CR3': '', 'a.JPG': '', 'b.JPG': '', 'c.JPG': '' });
  const options = photos(root);
  const plan = await prepareCleanup(options);
  const calls = [];
  const result = await executeCleanup(plan, { apply: true }, { trash: async file => {
    calls.push(file);
    if (calls.length === 2) throw new Error('permission denied');
  }, unlink: () => assert.fail('must not fall back to permanent deletion') });
  assert.equal(result.completed, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(calls.length, 2);
  for (const file of plan.filesToUpdate) await remains(file);
});

test('candidate mutation during execution is detected before its deletion', async t => {
  const root = await fixture(t, { 'ref.CR3': '', 'a.JPG': '', 'b.JPG': '' });
  const plan = await prepareCleanup(photos(root));
  const calls = [];
  const result = await executeCleanup(plan, { apply: true }, { trash: async file => {
    calls.push(file);
    await fs.writeFile(`${root}/b.JPG`, 'changed after preflight');
  } });
  assert.equal(result.completed, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(calls.length, 1);
  await remains(`${root}/b.JPG`);
});

test('Trash adapter passes hostile filenames as argv, never script source', { skip: process.platform !== 'darwin' }, async () => {
  const file = '/tmp/quote\' " $(touch bad)\nphoto.jpg';
  let call;
  await moveToTrash(file, async (...args) => { call = args; });
  assert.deepEqual(call, ['/usr/bin/osascript', ['-e', trashScript, file]]);
  assert(!trashScript.includes(file));
  await assert.rejects(moveToTrash(file, async () => { throw new Error('Finder refused'); }), /Finder refused/u);
});

const invalidArgs = [
  ['clean-orphans', '/x'], ['clean-orphans', '/x', '--reference', 'raw'], ['clean-orphans', '/x', '/y', '--reference', 'cr3'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--base', '/y'], ['clean-orphans', '--base', '/x', '--reference', 'cr3'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--reference', 'jpeg'], ['clean-orphans', '/x', '--reference'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--match-by', 'stem'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--mode', 'keep'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--ignore-case'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--include-ext', 'jpg'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--color', 'red'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--apply', '--apply'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--depth', '-1'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--depth', '1.5'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--depth', '2', '--no-recursive'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--list-limit', 'NaN'],
  ['clean-orphans', '/x', '--reference', 'cr3', '--list-limit', '9007199254740992'],
  ['clean-list', '/x', '--list', '/list'], ['clean-list', '/x', '--mode', 'keep'],
  ['clean-list', '--list', '/list', '--mode', 'keep'],
  ['clean-list', '/x', '--list', '/list', '--mode', 'inverse'],
  ['clean-list', '/x', '--list', '/list', '--mode', 'keep', '--reference', 'cr3'],
  ['clean-list', '/x', '--list', '/list', '--mode', 'keep', '--match-by', 'original'],
  ['clean-list', '/x', '--list', '/list', '--mode', 'keep', '--include-ext', 'jpg,'],
  ['clean-list', '/x', '--list', '/list', '--mode', 'keep', '--exclude-ext', '*.jpg'],
];
for (const args of invalidArgs) test(`CLI rejects ${args.join(' ')}`, () => assert.throws(() => parseArgs(args)));

test('CLI help, defaults, terminator, and legacy arguments remain supported', () => {
  assert.equal(parseArgs(['clean-orphans', '--help']).help, true);
  assert.equal(parseArgs(['clean-list', '-h']).help, true);
  const options = photos('/x');
  assert.equal(options.apply, false);
  assert.equal(options.permanent, false);
  assert.equal(options.matchBy, 'relative');
  assert.equal(options.reference, 'cr3');
  assert.equal(parseArgs(['clean-orphans', '--reference', 'jpeg', '--', '-folder']).base, '-folder');
  assert.equal(parseArgs(['/base', '/target', '--sync-tags']).syncTags, true);
  assert.throws(() => parseCleanupArgs(['invalid']), /Unknown cleanup/u);
});

test('real CLI: help, version, preview output, permanent apply, idempotence and nonzero validation exit', async t => {
  const root = await fixture(t, { 'ref.CR3': '', 'a.JPG': '', 'b.JPG': '' });
  const invoke = args => exec(process.execPath, [cli, ...args]);
  assert.match((await invoke(['clean-orphans', '--help'])).stdout, /--reference/u);
  assert.match((await invoke(['clean-list', '--help'])).stdout, /--mode/u);
  assert.match((await invoke(['--help'])).stdout, /clean-list/u);
  assert.match((await invoke(['--version'])).stdout, /^2\.2\.0\s*$/u);
  const args = ['clean-orphans', root, '--reference', 'cr3'];
  const preview = await invoke([...args, '--list-limit', '1']);
  assert.match(preview.stdout, /DRY-RUN/u);
  assert.match(preview.stdout, /1 more/u);
  await remains(`${root}/a.JPG`);
  const full = await invoke([...args, '--list-limit', '0']);
  assert(!full.stdout.includes('more ('));
  assert.match(full.stdout, /b.JPG/u);
  const applied = await invoke([...args, '--apply', '--permanent']);
  assert.match(applied.stdout, /2 succeeded, 0 failed/u);
  await absent(`${root}/a.JPG`);
  assert.match((await invoke(args)).stdout, /Files to clean: 0/u);
  await assert.rejects(invoke(['clean-orphans', root]), error => error.code === 1 && error.stderr.includes('--reference'));
  await assert.rejects(invoke(['clean-list', root, '--list', `${root}/missing`, '--mode', 'keep', '--apply', '--permanent']), error => error.code === 1);
  await remains(`${root}/ref.CR3`);
});

test('legacy deletion rejects empty reference and overlap before mutating files', async t => {
  const root = await fixture(t, { 'target/a.JPG': '' });
  await fs.mkdir(`${root}/base`);
  await assert.rejects(run(parseArgs([`${root}/base`, `${root}/target`, '--delete-unmatched', '--apply'])), /Empty base/u);
  await assert.rejects(run(parseArgs([root, `${root}/target`, '--delete-unmatched', '--apply'])), /overlap/u);
  await remains(`${root}/target/a.JPG`);
});

test('photo selection matches an independent set-difference oracle across 100 generated datasets', () => {
  let seed = 817;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let round = 0; round < 100; round += 1) {
    const refs = []; const candidates = []; const expected = [];
    for (let shoot = 0; shoot < 3; shoot += 1) {
      for (let photo = 0; photo < 15; photo += 1) {
        const hasRaw = random() > 0.4;
        if (hasRaw) refs.push(`/base/${shoot}/${photo}.CR3`);
        for (const extension of ['JPG', 'JPEG']) {
          if (random() > 0.4) {
            const file = `/target/${shoot}/${photo}.${extension}`;
            candidates.push(file);
            if (!hasRaw) expected.push(file);
          }
        }
      }
    }
    const actual = createPhotoPlan(refs, [candidates], { reference: 'cr3', matchBy: 'relative', base: '/base', targets: ['/target'], allowEmpty: true });
    assert.deepEqual(actual.filesToUpdate, expected);
  }
});

test('list keep/delete selections partition eligible files across 100 generated datasets', () => {
  for (let round = 0; round < 100; round += 1) {
    const files = Array.from({ length: 40 }, (_, i) => `/target/${i}.txt`);
    const keys = new Set(files.filter((_, i) => (i * 17 + round) % 7 < 3).map(file => path.basename(file)));
    const options = { targets: ['/target'], matchBy: 'name', includeExt: [], excludeExt: [] };
    const keep = createListPlan([files], keys, { ...options, mode: 'keep' }).filesToUpdate;
    const remove = createListPlan([files], keys, { ...options, mode: 'delete' }).filesToUpdate;
    assert.equal(keep.length + remove.length, files.length);
    assert.deepEqual(new Set([...keep, ...remove]), new Set(files));
    assert(!keep.some(file => remove.includes(file)));
  }
});

for (const change of ['new-reference', 'new-target', 'removed-target']) {
  test(`inventory recheck rejects ${change} after planning`, async t => {
    const root = await fixture(t, { 'ref.CR3': '', 'a.JPG': '', 'b.JPG': '' });
    const plan = await prepareCleanup(photos(root));
    if (change === 'new-reference') await fs.writeFile(`${root}/a.CR3`, 'new reference');
    if (change === 'new-target') await fs.writeFile(`${root}/c.JPG`, 'new target');
    if (change === 'removed-target') await fs.unlink(`${root}/b.JPG`);
    await assert.rejects(executeCleanup(plan, { apply: true, permanent: true }), /Folder contents changed/u);
    await remains(`${root}/a.JPG`);
  });
}

test('list changes during execution stop subsequent deletions', async t => {
  const root = await fixture(t, { 'ref.CR3': '', 'a.JPG': '', 'b.JPG': '' });
  await fs.writeFile(`${root}/list.txt`, 'ref.CR3');
  const plan = await prepareCleanup(listOptions(root));
  const result = await executeCleanup(plan, { apply: true }, { trash: async () => fs.writeFile(`${root}/list.txt`, 'changed list') });
  assert.equal(result.completed, 1);
  assert.equal(result.failures.length, 1);
  await remains(`${root}/b.JPG`);
});

test('multiple candidate hard links are all deleted without invalidating each other', async t => {
  const root = await fixture(t, { 'ref.CR3': '', 'a.JPG': 'shared' });
  await fs.link(`${root}/a.JPG`, `${root}/b.JPG`);
  const plan = await prepareCleanup(photos(root));
  const result = await executeCleanup(plan, { apply: true, permanent: true });
  assert.equal(result.completed, 2);
  assert.deepEqual(result.failures, []);
  await remains(`${root}/ref.CR3`);
  await absent(`${root}/a.JPG`);
  await absent(`${root}/b.JPG`);
});

test('empty directories survive list cleanup and symbolic links never become candidates', async t => {
  const root = await fixture(t, { 'list.txt': 'keep.txt', 'one/orphan.txt': '', 'outside.txt': 'external' });
  await fs.mkdir(`${root}/empty`);
  await fs.symlink(`${root}/outside.txt`, `${root}/one/link.txt`);
  const options = listOptions(root, ['--include-ext', 'txt']);
  const plan = await prepareCleanup(options);
  const result = await executeCleanup(plan, { apply: true, permanent: true });
  assert.deepEqual(result.failures, []);
  assert((await fs.stat(`${root}/empty`)).isDirectory());
  assert((await fs.stat(`${root}/one`)).isDirectory());
  assert((await fs.lstat(`${root}/one/link.txt`)).isSymbolicLink());
});

test('real clean-list CLI executes both directions and protects input list', async t => {
  const root = await fixture(t, { 'list.txt': 'a.txt\n', 'a.txt': '', 'b.txt': '' });
  const common = [cli, 'clean-list', root, '--list', `${root}/list.txt`];
  const preview = await exec(process.execPath, [...common, '--mode', 'keep']);
  assert.match(preview.stdout, /Files to clean: 1/u);
  assert.match(preview.stdout, /mode: keep/u);
  await remains(`${root}/b.txt`);
  await exec(process.execPath, [...common, '--mode', 'keep', '--apply', '--permanent']);
  await absent(`${root}/b.txt`);
  await remains(`${root}/a.txt`);
  await exec(process.execPath, [...common, '--mode', 'delete', '--apply', '--permanent']);
  await absent(`${root}/a.txt`);
  await remains(`${root}/list.txt`);
});

test('invalid UTF-8 bytes abort list cleanup', async t => {
  const root = await fixture(t, { 'list.txt': Buffer.from([0xc3, 0x28]), 'precious.txt': '' });
  await assert.rejects(prepareCleanup(listOptions(root)), /UTF-8/u);
  await remains(`${root}/precious.txt`);
});

test('permanent deletion failure stops later files and records the error', async t => {
  const root = await fixture(t, { 'ref.CR3': '', 'a.JPG': '', 'b.JPG': '' });
  const plan = await prepareCleanup(photos(root));
  let calls = 0;
  const result = await executeCleanup(plan, { apply: true, permanent: true }, { unlink: async () => {
    calls += 1;
    throw new Error('permission denied');
  }, trash: () => assert.fail('permanent mode should not call Trash') });
  assert.equal(result.completed, 0);
  assert.equal(calls, 1);
  assert.match(result.failures[0].error.message, /permission denied/u);
  await remains(`${root}/a.JPG`);
  await remains(`${root}/b.JPG`);
});

test('cleanup refuses filesystem root as target', async () => {
  await assert.rejects(prepareCleanup(photos('/')), /Filesystem root/u);
});

test('cleanup run returns exit code 2 on an execution failure', async t => {
  const root = await fixture(t, { 'ref.CR3': '', 'a.JPG': '', 'b.JPG': '' });
  const entry = new URL('../src/index.js', import.meta.url).href;
  const script = `import fs from 'node:fs/promises';
    import { parseArgs, run } from ${JSON.stringify(entry)};
    fs.unlink = async () => { throw new Error('simulated permission denied'); };
    await run(parseArgs(process.argv.slice(1)));`;
  await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', script,
    'clean-orphans', root, '--reference', 'cr3', '--apply', '--permanent']), error => {
    assert.equal(error.code, 2);
    assert.match(error.stdout, /0 succeeded, 1 failed, 1 not attempted/u);
    assert.match(error.stderr, /simulated permission denied/u);
    return true;
  });
  await remains(`${root}/a.JPG`);
  await remains(`${root}/b.JPG`);
});

test('legacy cleanup refuses deleting hard links to reference files', async t => {
  const root = await fixture(t, { 'base/ref.dat': 'reference', 'target/orphan.dat': 'orphan' });
  await fs.link(`${root}/base/ref.dat`, `${root}/target/reference-link.dat`);
  await assert.rejects(run(parseArgs([`${root}/base`, `${root}/target`, '--delete-unmatched', '--apply'])), /hard link/u);
  await remains(`${root}/target/orphan.dat`);
  await remains(`${root}/base/ref.dat`);
});

const byExtension = (root, extension = 'nef', extra = []) => parseArgs(['clean-orphans', root, '--reference-ext', extension, ...extra]);

for (const reference of ['nef', 'cr3', 'arw', 'dng', 'jpg', 'custom123']) {
  test(`generic reference ${reference}: retain five matching formats and clean every orphan extension`, async t => {
    const others = ['jpg', 'cr3', 'xmp', 'tif', 'psd', 'txt'].filter(extension => extension !== reference);
    const files = { [`keep.${reference}`]: 'reference', [`only-reference.${reference}`]: 'reference', README: 'no extension', 'trailing.': 'no extension' };
    for (const extension of others) {
      files[`keep.${extension}`] = 'paired';
      files[`orphan.${extension}`] = 'orphan';
    }
    const root = await fixture(t, files);
    const options = byExtension(root, reference);
    const plan = await prepareCleanup(options);
    assert.deepEqual(relativeSelected(plan, root), others.map(extension => `orphan.${extension}`).sort());
    const preview = await executeCleanup(plan, options, { trash: () => assert.fail('preview must not mutate') });
    assert.equal(preview.completed, 0);
    for (const file of plan.filesToUpdate) await remains(file);
    const result = await executeCleanup(plan, { ...options, apply: true, permanent: true });
    assert.equal(result.completed, others.length);
    assert.deepEqual(result.failures, []);
    for (const extension of [reference, ...others]) await remains(`${root}/keep.${extension}`);
    await remains(`${root}/only-reference.${reference}`);
    await remains(`${root}/README`);
    await remains(`${root}/trailing.`);
    assert.deepEqual((await prepareCleanup(options)).filesToUpdate, []);
  });
}

test('generic reference is normalized, exact, and has no JPG/JPEG alias expansion', async t => {
  const root = await fixture(t, { 'A.JPG': '', 'A.NEF': '', 'B.JPEG': '', 'B.NEF': '' });
  const options = byExtension(root, '.JpG');
  assert.equal(options.referenceExt, '.jpg');
  assert.deepEqual(relativeSelected(await prepareCleanup(options), root), ['B.JPEG', 'B.NEF']);
});

test('generic reference isolates subdirectories and permits explicit basename matching', async t => {
  const root = await fixture(t, { 'one/A.NEF': '', 'one/a.JPG': '', 'two/A.JPG': '', 'two/A.XMP': '' });
  assert.deepEqual(relativeSelected(await prepareCleanup(byExtension(root)), root), ['two/A.JPG', 'two/A.XMP']);
  assert.deepEqual((await prepareCleanup(byExtension(root, 'nef', ['--match-by', 'name']))).filesToUpdate, []);
});

test('generic reference matches Unicode stems, preserves suffixes, and uses only the last extension', () => {
  const plan = createPhotoPlan(['/base/Café.NEF', '/base/a.b.NEF'], [[
    '/target/CAFE\u0301.JPG', '/target/A.B.XMP', '/target/a.xmp', '/target/Café-[edit].JPG', '/target/Café.NEF.XMP',
  ]], { referenceExt: '.nef', matchBy: 'relative', base: '/base', targets: ['/target'] });
  assert.deepEqual(plan.filesToUpdate, ['/target/a.xmp', '/target/Café-[edit].JPG', '/target/Café.NEF.XMP']);
});

test('generic reference supports separate roots, multiple targets and protects target reference hard links', async t => {
  const root = await fixture(t, { 'base/a.NEF': '', 'one/a.JPG': '', 'one/b.XMP': '', 'one/z.NEF': '',
    'two/a.TIF': '', 'two/b.CR3': '', 'two/z.NEF': '' });
  await fs.link(`${root}/one/z.NEF`, `${root}/one/z-alias.JPG`);
  const options = parseArgs(['clean-orphans', '--base', `${root}/base`, '--target', `${root}/one`, '--target', `${root}/two`, '--reference-ext', 'nef']);
  const plan = await prepareCleanup(options);
  assert.deepEqual(relativeSelected(plan, root), ['one/b.XMP', 'two/b.CR3']);
  await executeCleanup(plan, { ...options, apply: true, permanent: true });
  for (const file of ['base/a.NEF', 'one/a.JPG', 'one/z.NEF', 'one/z-alias.JPG', 'two/a.TIF', 'two/z.NEF']) await remains(`${root}/${file}`);
});

test('generic reference fails closed when empty, with explicit override scoped to files with extensions', async t => {
  const root = await fixture(t, { 'a.CR3': '', 'a.JPG': '', 'a.XMP': '', README: '', '.hidden.JPG': '' });
  await assert.rejects(prepareCleanup(byExtension(root)), /Empty photo reference/u);
  assert.deepEqual(relativeSelected(await prepareCleanup(byExtension(root, 'nef', ['--allow-empty'])), root), ['a.CR3', 'a.JPG', 'a.XMP']);
});

test('generic reference honors hidden/symlink exclusions, hard link protection, and scan depth', async t => {
  const root = await fixture(t, { 'keep.NEF': '', '.hidden.JPG': '', '.hidden/ref.NEF': '',
    'top.JPG': '', 'nested/deep.JPG': '', 'nested/deeper/file.PSD': '' });
  await fs.symlink(`${root}/keep.NEF`, `${root}/symlink.JPG`);
  await fs.link(`${root}/keep.NEF`, `${root}/hardlink.JPG`);
  const shallow = await prepareCleanup(byExtension(root, 'nef', ['--no-recursive']));
  assert.deepEqual(relativeSelected(shallow, root), ['top.JPG']);
  const deep = await prepareCleanup(byExtension(root, 'nef', ['--depth', '1']));
  assert.deepEqual(relativeSelected(deep, root), ['nested/deep.JPG', 'top.JPG']);
});

for (const extension of ['', '.', '..nef', '*.nef', 'nef,jpg', 'nef,nef', '/nef', 'nef/jpg', 'nef jpg', 'tar.gz']) {
  test(`generic reference rejects invalid or multiple extensions: ${JSON.stringify(extension)}`, () => {
    assert.throws(() => byExtension('/photos', extension));
  });
}

for (const extra of [[], ['--reference', 'cr3'], ['--reference-ext', 'jpg']]) {
  test(`generic reference rejects missing value or conflicting options: ${extra.join(' ')}`, () => {
    const args = extra.length ? ['clean-orphans', '/x', '--reference-ext', 'nef', ...extra] : ['clean-orphans', '/x', '--reference-ext'];
    assert.throws(() => parseArgs(args));
  });
}

test('clean-list rejects reference-ext rather than silently changing its semantics', () => {
  assert.throws(() => parseArgs(['clean-list', '/x', '--list', '/list', '--mode', 'keep', '--reference-ext', 'nef']), /Photo options/u);
});

test('generic reference CLI previews broad scope, defaults to Trash, and applies only when requested', async t => {
  const root = await fixture(t, { 'keep.NEF': '', 'keep.JPG': '', 'orphan.CR3': '', 'orphan.JPG': '', 'orphan.XMP': '' });
  const args = [cli, 'clean-orphans', root, '--reference-ext', 'nef'];
  const preview = await exec(process.execPath, args);
  assert.match(preview.stdout, /DRY-RUN; action: move to Trash/u);
  assert.match(preview.stdout, /ALL OTHER extensions/u);
  assert.match(preview.stdout, /Files to clean: 3/u);
  await remains(`${root}/orphan.XMP`);
  const applied = await exec(process.execPath, [...args, '--apply', '--permanent']);
  assert.match(applied.stdout, /3 succeeded, 0 failed/u);
  assert.deepEqual((await fs.readdir(root)).sort(), ['keep.JPG', 'keep.NEF']);
  const help = await exec(process.execPath, [cli, 'clean-orphans', '--help']);
  assert.match(help.stdout, /--reference-ext/u);
});

test('generic reference matches set difference over 100 datasets with six formats', () => {
  for (let round = 0; round < 100; round += 1) {
    const references = []; const files = []; const expected = [];
    for (let number = 0; number < 30; number += 1) {
      const hasReference = (number * 17 + round) % 5 < 3;
      if (hasReference) references.push(`/base/${number}.NEF`);
      for (const extension of ['CR3', 'JPG', 'JPEG', 'XMP', 'TIF', 'PSD']) {
        const file = `/target/${number}.${extension}`;
        files.push(file);
        if (!hasReference) expected.push(file);
      }
    }
    const plan = createPhotoPlan(references, [files], { referenceExt: '.nef', matchBy: 'relative', base: '/base', targets: ['/target'] });
    assert.deepEqual(plan.filesToUpdate, expected);
  }
});

test('clean-orphans is the only orphan-cleanup command; photos has no alias', () => {
  const options = parseArgs(['clean-orphans', '/files', '--reference-ext', 'nef']);
  assert.equal(options.command, 'clean-orphans');
  assert.equal(options.referenceExt, '.nef');
  assert.throws(() => parseCleanupArgs(['photos', '/files', '--reference-ext', 'nef']), /Unknown cleanup command/u);
  assert.throws(() => parseArgs(['photos', '/files', '--reference-ext', 'nef']), /Unknown option/u);
  // The former subcommand can once again be an ordinary legacy base folder name.
  const legacy = parseArgs(['photos', '/target']);
  assert.equal(legacy.command, undefined);
  assert.equal(legacy.base, 'photos');
});

test('CLI help advertises clean-orphans and the removed photos invocation fails', async () => {
  const help = await exec(process.execPath, [cli, '--help']);
  assert.match(help.stdout, /finder-selection-sync clean-orphans/u);
  assert.doesNotMatch(help.stdout, /finder-selection-sync photos/u);
  const subhelp = await exec(process.execPath, [cli, 'clean-orphans', '--help']);
  assert.match(subhelp.stdout, /finder-selection-sync clean-orphans/u);
  assert.doesNotMatch(subhelp.stdout, /finder-selection-sync photos/u);
  await assert.rejects(exec(process.execPath, [cli, 'photos', '/files', '--reference-ext', 'nef']),
    error => error.code === 1 && error.stderr.includes('Unknown option'));
});

test('Trash adapter returns Finder destination without trimming legitimate filename whitespace', { skip: process.platform !== 'darwin' }, async () => {
  const destination = '/Users/test/.Trash/name with trailing space and CR \r';
  assert.equal(await moveToTrash('/tmp/source.JPG', async () => ({ stdout: `${destination}\n` })), destination);
  const newlineName = '/Users/test/.Trash/name ending with newline\n';
  assert.equal(await moveToTrash('/tmp/source.JPG', async () => ({ stdout: `${newlineName}\n` })), newlineName);
});
