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
    ]) {
      preview = await service.preview({ ...config, targets: [target] });
      assert.equal(preview.total, 2);
      assert.deepEqual(preview.rows.filter(row => row.candidate).map(row => row.file), [other]);
    }

    const latestSnapshot = await snapshotFile(archive);
    await fs.appendFile(archive, '\n');
    await assert.rejects(verifySnapshot(latestSnapshot), /File changed/);
    // Loading the app's own ASAR resources must still use Electron's virtual fs.
    assert.equal(await nodeFs.readFile(path.join(reference, 'inside.txt'), 'utf8'), 'Archive content\n');
    console.log('Electron filesystem checks passed: physical ASAR files, all three previews, symlink/hard-link guards and stale snapshots.');
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    await service?.discard();
    await fs.rm(root, { recursive: true, force: true });
    app.exit(exitCode);
  }
});
