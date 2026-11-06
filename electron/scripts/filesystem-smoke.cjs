// Run in Electron: plain Node does not reproduce its ASAR filesystem patches.
const { app } = require('electron');
const nodeFs = require('node:fs/promises');
const physicalFs = require('original-fs');
const fs = physicalFs.promises;
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

// Generated with @electron/asar; contains inside.txt with "Archive content\n".
const archiveBytes = Buffer.from('BAAAAAgBAAAEAQAAAAEAAHsiZmlsZXMiOnsiaW5zaWRlLnR4dCI6eyJzaXplIjoxNiwib2Zmc2V0IjoiMCIsImludGVncml0eSI6eyJhbGdvcml0aG0iOiJTSEEyNTYiLCJoYXNoIjoiMjY4ZDM3ODdlNTA4ZmE3ODQ1YTI4MjlhYTNiMDhjYWE2ZWUwZTJmNzY4MGQwZjNkZDQ4ZGM4MTkyZjViYzI3ZiIsImJsb2NrU2l6ZSI6NDE5NDMwNCwiYmxvY2tzIjpbIjI2OGQzNzg3ZTUwOGZhNzg0NWEyODI5YWEzYjA4Y2FhNmVlMGUyZjc2ODBkMGYzZGQ0OGRjODE5MmY1YmMyN2YiXX19fX1BcmNoaXZlIGNvbnRlbnQK', 'base64');
const root = physicalFs.realpathSync(physicalFs.mkdtempSync(path.join(os.tmpdir(), 'finder-filesystem-smoke-')));
const profile = path.join(root, 'profile');
physicalFs.mkdirSync(profile);
app.setPath('userData', profile);

app.whenReady().then(async () => {
  let service, exitCode = 0;
  try {
    const { getFiles, directoryRoot, snapshotFile, verifySnapshot } = await import('finder-selection-sync/files');
    const { DesktopService } = await import('../service.js');
    const { getFinderTags, setFinderTags } = await import('finder-selection-sync');
    const base = path.join(root, 'base'), target = path.join(root, 'target');
    await fs.mkdir(base);
    await fs.mkdir(target);
    const archive = path.join(target, 'sample.asar');
    const reference = path.join(base, 'sample.asar');
    const other = path.join(target, 'unmatched.jpg');
    await fs.writeFile(reference, archiveBytes);
    await fs.writeFile(archive, archiveBytes);
    await fs.writeFile(other, 'Other file');

    // Reproduce the mismatch: directory entries say file, patched lstat says directory.
    assert.ok((await nodeFs.readdir(target, { withFileTypes: true })).find(entry => entry.name === 'sample.asar').isFile());
    assert.ok((await nodeFs.lstat(archive)).isDirectory());
    assert.deepEqual(await getFiles(target), [archive, other]);
    const snapshot = await snapshotFile(archive);
    const stat = await fs.lstat(archive, { bigint: true });
    assert.deepEqual(snapshot, { file: archive, dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeNs, ctime: stat.ctimeNs });
    await verifySnapshot(snapshot);
    await assert.rejects(directoryRoot(archive), /Not a directory/);
    await assert.rejects(snapshotFile(path.join(archive, 'inside.txt')), { code: 'ENOTDIR' });

    const alias = path.join(target, 'alias.asar'), directoryAlias = path.join(root, 'target-link');
    await fs.symlink(archive, alias);
    await fs.symlink(target, directoryAlias);
    assert.deepEqual(await getFiles(target), [archive, other]);
    await assert.rejects(snapshotFile(alias), /symlink/);
    await assert.rejects(snapshotFile(path.join(directoryAlias, 'sample.asar')), /symlink/);

    service = new DesktopService({ readTags: async file => file === reference ? ['Green\n2'] : [], tempRoot: root });
    let preview = await service.preview({ mode: 'tags', tagAction: 'sync', base, targets: [target] });
    assert.equal(preview.total, 2);
    assert.equal(preview.candidates, 1);
    assert.equal(preview.rows.find(row => row.file === archive).size, archiveBytes.length);

    // Physical hard links must still be excluded from tag changes.
    const hardLink = path.join(root, 'archive-link');
    await fs.link(archive, hardLink);
    preview = await service.preview({ mode: 'tags', tagAction: 'sync', base, targets: [target] });
    assert.equal(preview.candidates, 0);
    assert.ok(preview.warnings.some(warning => warning.key === 'warning.hardLinks'));
    await fs.unlink(hardLink);

    for (const config of [
      { mode: 'orphans', base, referenceExt: 'asar' },
      { mode: 'list', listSource: 'text', listText: 'sample.asar\n', listMode: 'keep' },
      { mode: 'filter', nameRegex: '^unmatched\\.jpg$', includeExt: '.jpg' },
    ]) {
      preview = await service.preview({ ...config, targets: [target] });
      assert.equal(preview.total, 2);
      assert.deepEqual(preview.rows.filter(row => row.candidate).map(row => row.file), [other]);
    }

    // The new filter action writes real Finder tags only to these owned fixtures.
    await service.discard();
    service = new DesktopService({ tempRoot: root, trash: async () => assert.fail('Tag actions must never call Trash') });
    await setFinderTags(other, ['Blue\n4']);
    preview = await service.preview({ mode: 'filter', targets: [target], includeExt: '.jpg', filterAction: 'tags', colors: ['green', 'red'] });
    assert.equal(preview.action, 'tags');
    const selected = preview.rows.filter(row => row.candidate).map(row => row.id);
    assert.deepEqual(await service.execute(preview.id, selected, { confirm: async () => false }), { declined: true });
    assert.deepEqual(await getFinderTags(other), ['Blue\n4']);
    const result = await service.execute(preview.id, selected, { confirm: async summary => { assert.equal(summary.action, 'tags'); return true; } });
    assert.equal(result.completed, 1);
    assert.deepEqual(await getFinderTags(other), ['Blue\n4', 'Green\n2', 'Red\n6']);
    assert.deepEqual(await getFinderTags(archive), []);

    // The independent list action can tag a kept file even when all extensions
    // are excluded from cleanup, and must not make that file a Trash candidate.
    preview = await service.preview({ mode: 'list', targets: [target], listSource: 'text', listText: 'sample.asar', listMode: 'keep', includeExt: '.txt' });
    assert.equal(preview.candidates, 0);
    const keptArchive = preview.rows.find(row => row.file === archive).id;
    assert.deepEqual(await service.tagSelected(preview.id, [keptArchive], { colors: ['yellow'], mergeTags: true }, { confirm: async () => false }), { declined: true });
    assert.equal(service.active.id, preview.id);
    const independentTags = await service.tagSelected(preview.id, [keptArchive], { colors: ['yellow'], mergeTags: true }, { confirm: async () => true });
    assert.equal(independentTags.completed, 1);
    assert.deepEqual(await getFinderTags(archive), ['Yellow\n5']);
    preview = await service.preview({ mode: 'list', targets: [target], listSource: 'text', listText: 'sample.asar', listMode: 'keep', includeExt: '.txt' });
    const taggedArchive = preview.rows.find(row => row.file === archive);
    assert.deepEqual(taggedArchive.currentTags, ['Yellow\n5']);
    const clearedTags = await service.tagSelected(preview.id, [taggedArchive.id], { colors: [], clearTags: true }, { confirm: async () => true });
    assert.equal(clearedTags.completed, 1);
    assert.deepEqual(await getFinderTags(archive), []);
    assert.deepEqual(await getFinderTags(other), ['Blue\n4', 'Green\n2', 'Red\n6']);

    // Empty tag choices retain candidate files but cannot execute or clear tags.
    preview = await service.preview({ mode: 'list', targets: [target], listSource: 'text', listText: 'unmatched.jpg', listMode: 'delete', listAction: 'tags', colors: [] });
    assert.equal(preview.requiresTags, true);
    assert.equal(preview.rows.find(row => row.file === other).candidate, true);
    await assert.rejects(service.execute(preview.id, preview.rows.filter(row => row.candidate).map(row => row.id), { confirm: async () => assert.fail('Empty tag selection must not request confirmation') }));
    assert.deepEqual(await getFinderTags(other), ['Blue\n4', 'Green\n2', 'Red\n6']);

    preview = await service.preview({ mode: 'list', targets: [target], listSource: 'text', listText: 'unmatched.jpg', listMode: 'delete', listAction: 'tags', colors: ['purple'], mergeTags: false });
    const listResult = await service.execute(preview.id, [preview.rows.find(row => row.file === other).id], { confirm: async summary => { assert.equal(summary.action, 'tags'); return true; } });
    assert.equal(listResult.completed, 1);
    assert.deepEqual(await getFinderTags(other), ['Purple\n3']);
    assert.deepEqual(await getFinderTags(archive), []);

    // Both copies match, but only the checked side receives a real Finder tag.
    preview = await service.preview({ mode: 'compare', base, targets: [target], compareSelection: 'common', colors: ['blue'] });
    assert.equal(preview.total, 3);
    assert.equal(preview.matched, 2);
    const checkedReference = preview.rows.find(row => row.file === reference).id;
    assert.deepEqual(await service.execute(preview.id, [checkedReference], { confirm: async () => false }), { declined: true });
    assert.deepEqual(await getFinderTags(reference), []);
    const compareResult = await service.execute(preview.id, [checkedReference], { confirm: async summary => { assert.deepEqual(summary.files, [reference]); return true; } });
    assert.equal(compareResult.completed, 1);
    assert.deepEqual(await getFinderTags(reference), ['Blue\n4']);
    assert.deepEqual(await getFinderTags(archive), []);
    assert.deepEqual(await getFinderTags(other), ['Purple\n3']);

    const latestSnapshot = await snapshotFile(archive);
    await fs.appendFile(archive, '\n');
    await assert.rejects(verifySnapshot(latestSnapshot), /File changed/);
    // Loading the app's own ASAR resources must still use Electron's virtual fs.
    assert.equal(await nodeFs.readFile(path.join(reference, 'inside.txt'), 'utf8'), 'Archive content\n');
    console.log('Electron filesystem checks passed: physical ASAR files, all five previews, filtered/list/compared tag writes with confirmation, empty-tag guards, symlink/hard-link guards and stale snapshots.');
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    try {
      await service?.discard();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.error(error);
      exitCode = 1;
    } finally { app.exit(exitCode); }
  }
});
