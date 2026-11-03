// Run with Electron to exercise macOS image decoding without opening a window.
const { app, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = syncFs.realpathSync(syncFs.mkdtempSync(path.join(os.tmpdir(), 'finder-image-smoke-')));
const profile = path.join(root, 'profile'); syncFs.mkdirSync(profile); app.setPath('userData', profile);
app.whenReady().then(async () => {
  try {
    const { ImagePreviews } = await import('../image-previews.js');
    const pixels = Buffer.alloc(64 * 48 * 4, 255);
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 70; pixels[i + 1] = 140; pixels[i + 2] = 190; }
    const source = nativeImage.createFromBitmap(pixels, { width: 64, height: 48 });
    const files = [path.join(root, 'photo.png'), path.join(root, 'photo.jpg')];
    await fs.writeFile(files[0], source.toPNG()); await fs.writeFile(files[1], source.toJPEG(90));
    const previews = new ImagePreviews({ isAllowed: file => files.includes(file), decode: async (file, size) => {
      const result = await nativeImage.createThumbnailFromPath(file, size);
      return { dataURL: result.toDataURL({ scaleFactor: 1 }), ...result.getSize() };
    } });
    for (const file of files) for (const kind of ['thumbnail', 'preview']) {
      const result = await previews.read(file, kind);
      assert.ok(!nativeImage.createFromDataURL(result.dataURL).isEmpty());
      assert.ok(result.width > 0 && result.height > 0);
      console.log(`${path.basename(file)} ${kind}: ${result.width} × ${result.height}`);
    }
    await fs.rm(root, { recursive: true, force: true });
    app.exit(0);
  } catch (error) { console.error(error); await fs.rm(root, { recursive: true, force: true }); app.exit(1); }
});
