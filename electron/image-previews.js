import { fileSystem as fs } from 'finder-selection-sync/files';
import path from 'node:path';
import { isImageFile } from './image-formats.js';
import { appError } from './messages.js';

const sizes = { thumbnail: { width: 120, height: 90 }, preview: { width: 1920, height: 1440 } };
const signature = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

// Bound both decoding concurrency and cache memory. Large previews jump ahead
// of queued thumbnails, and callers can only read files in the active plan.
export class ImagePreviews {
  constructor({ decode, isAllowed, concurrency = 2, maxCacheBytes = 32 * 1024 * 1024 } = {}) {
    Object.assign(this, { decode, isAllowed, concurrency, maxCacheBytes });
    this.cache = new Map();
    this.pending = new Map();
    this.queue = [];
    this.active = 0;
    this.cacheBytes = 0;
  }
  allowed(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0') || !this.isAllowed(file)) throw appError('error.knownPath');
  }
  schedule(work, priority) {
    return new Promise((resolve, reject) => {
      this.queue[priority ? 'unshift' : 'push']({ work, resolve, reject });
      this.drain();
    });
  }
  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const { work, resolve, reject } = this.queue.shift();
      this.active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { this.active--; this.drain(); });
    }
  }
  remember(key, value) {
    const bytes = value.dataURL.length * 2;
    if (bytes > this.maxCacheBytes) return;
    while (this.cache.size && (this.cacheBytes + bytes > this.maxCacheBytes || this.cache.size >= 128)) {
      const oldest = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(oldest).bytes;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { value, bytes });
    this.cacheBytes += bytes;
  }
  async read(file, kind = 'thumbnail') {
    this.allowed(file);
    if (!Object.hasOwn(sizes, kind) || !isImageFile(file)) throw appError('image.unavailable');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || await fs.realpath(file) !== file) throw appError('error.stale');
    const stamp = signature(stat), key = JSON.stringify([file, kind, stamp]);
    const cached = this.cache.get(key);
    if (cached) {
      this.allowed(file);
      this.cache.delete(key); this.cache.set(key, cached);
      return cached.value;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = this.schedule(async () => {
      this.allowed(file);
      if (await fs.realpath(file) !== file || signature(await fs.lstat(file)) !== stamp) throw appError('error.stale');
      const value = await this.decode(file, { ...sizes[kind] });
      this.allowed(file);
      if (await fs.realpath(file) !== file || signature(await fs.lstat(file)) !== stamp) throw appError('error.stale');
      if (!value?.dataURL?.startsWith('data:image/png;base64,') || !(value.width > 0) || !(value.height > 0)) throw appError('image.unavailable');
      this.remember(key, value);
      return value;
    }, kind === 'preview');
    this.pending.set(key, pending);
    try { return await pending; }
    finally { if (this.pending.get(key) === pending) this.pending.delete(key); }
  }
}
