import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ImagePreviews } from '../image-previews.js';

const image = { dataURL: 'data:image/png;base64,dGVzdA==', width: 120, height: 90 };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'finder-images-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = ['one.jpg', 'two.png', 'three.jpg', 'notes.txt'].map(name => path.join(root, name));
  await Promise.all(files.map(file => fs.writeFile(file, 'fixture')));
  return { root, files, allowed: new Set(files) };
}

test('image previews reject unknown files, non-images, invalid sizes and symlinks before decoding', async t => {
  const f = await fixture(t);
  let decoded = 0;
  const service = new ImagePreviews({ isAllowed: file => f.allowed.has(file), decode: async () => { decoded++; return image; } });
  await assert.rejects(service.read('/unknown.jpg'), /error.knownPath/);
  await assert.rejects(service.read('one.jpg'), /error.knownPath/);
  await assert.rejects(service.read(f.files[3]), /image.unavailable/);
  await assert.rejects(service.read(f.files[0], '__proto__'), /image.unavailable/);
  const link = path.join(f.root, 'linked.jpg');
  await fs.symlink(f.files[0], link); f.allowed.add(link);
  await assert.rejects(service.read(link), /error.stale/);
  assert.equal(decoded, 0);
});

test('duplicate requests share decoding, unchanged images use cache, and changed files are reloaded', async t => {
  const f = await fixture(t), gate = deferred(), started = deferred();
  let decoded = 0;
  const service = new ImagePreviews({ isAllowed: file => f.allowed.has(file), decode: async () => {
    decoded++; started.resolve(); await gate.promise; return image;
  } });
  const first = service.read(f.files[0]), second = service.read(f.files[0]);
  await started.promise; gate.resolve();
  assert.deepEqual(await first, image); assert.deepEqual(await second, image);
  await service.read(f.files[0]); assert.equal(decoded, 1);
  await fs.writeFile(f.files[0], 'changed fixture');
  await service.read(f.files[0]); assert.equal(decoded, 2);
  f.allowed.clear();
  await assert.rejects(service.read(f.files[0]), /error.knownPath/);
});

test('files changed during decoding are not displayed or cached', async t => {
  const f = await fixture(t), started = deferred(), gate = deferred();
  const service = new ImagePreviews({ isAllowed: file => f.allowed.has(file), decode: async () => { started.resolve(); await gate.promise; return image; } });
  const read = service.read(f.files[0]);
  const rejected = assert.rejects(read, /error.stale/);
  await started.promise;
  await fs.writeFile(f.files[0], 'changed while loading'); gate.resolve();
  await rejected;
  assert.equal(service.cache.size, 0);
});

test('large previews take priority over queued thumbnails and decoding concurrency stays bounded', async t => {
  const f = await fixture(t), starts = [deferred(), deferred(), deferred()], gates = [deferred(), deferred(), deferred()];
  const calls = [];
  let active = 0, maximum = 0;
  const service = new ImagePreviews({ concurrency: 1, isAllowed: file => f.allowed.has(file), decode: async (file, size) => {
    const index = calls.length; calls.push({ file, size }); active++; maximum = Math.max(maximum, active);
    starts[index].resolve(); await gates[index].promise; active--; return image;
  } });
  const first = service.read(f.files[0]); await starts[0].promise;
  const thumbnail = service.read(f.files[1]);
  const large = service.read(f.files[2], 'preview');
  while (service.pending.size < 3) await new Promise(resolve => setImmediate(resolve));
  gates[0].resolve(); await starts[1].promise;
  assert.equal(calls[1].file, f.files[2]); assert.equal(calls[1].size.width, 1920);
  gates[1].resolve(); await starts[2].promise; gates[2].resolve();
  await Promise.all([first, thumbnail, large]);
  assert.equal(maximum, 1);
});

test('the cache evicts old images when its memory budget is reached', async t => {
  const f = await fixture(t);
  let decoded = 0;
  const service = new ImagePreviews({ maxCacheBytes: image.dataURL.length * 2, isAllowed: file => f.allowed.has(file), decode: async () => { decoded++; return image; } });
  await service.read(f.files[0]); await service.read(f.files[1]); await service.read(f.files[0]);
  assert.equal(decoded, 3); assert.equal(service.cache.size, 1);
  assert.ok(service.cacheBytes <= service.maxCacheBytes);
});
