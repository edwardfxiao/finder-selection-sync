import nodeFs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// User paths must refer to physical files, including .asar archives. Keep
// Electron's virtual filesystem enabled for loading the app's own resources.
export const fileSystem = process.versions.electron
  ? createRequire(import.meta.url)('original-fs').promises
  : nodeFs;
const fs = fileSystem;

export async function getFiles(directoryPath, recursive = true, depth = Infinity, check = () => {}) {
  const result = [];
  check();
  const canonicalRoot = await fs.realpath(directoryPath);
  check();
  async function visit(currentPath, level) {
    check();
    const expected = path.join(canonicalRoot, path.relative(directoryPath, currentPath));
    if (await fs.realpath(currentPath) !== expected) {
      throw new Error(`Directory changed or contains a substituted symlink during scan: ${currentPath}`);
    }
    check();
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    check();
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      check();
      if (entry.name.startsWith('.')) continue;
      const file = path.join(currentPath, entry.name);
      if (entry.isFile()) result.push(file);
      else if (recursive && level < depth && entry.isDirectory()) await visit(file, level + 1);
    }
  }
  await visit(directoryPath, 0);
  check();
  return result;
}

export async function directoryRoot(input) {
  if (typeof input !== 'string' || input.length === 0) throw new Error('Directory path must be a non-empty string');
  const root = await fs.realpath(path.resolve(input));
  if (!(await fs.stat(root)).isDirectory()) throw new Error(`Not a directory: ${input}`);
  if (root === path.parse(root).root) throw new Error('Filesystem root cannot be a cleanup folder');
  return root;
}

export function overlaps(a, b) {
  const relative = path.relative(a, b);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertSeparateRoots(roots) {
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      if (overlaps(roots[i], roots[j]) || overlaps(roots[j], roots[i])) {
        throw new Error(`Cleanup folders overlap: ${roots[i]} and ${roots[j]}`);
      }
    }
  }
}

export async function snapshotFile(file) {
  const stat = await fs.lstat(file, { bigint: true });
  if (!stat.isFile() || await fs.realpath(file) !== file) {
    throw new Error(`Not a regular file or path contains a symlink: ${file}`);
  }
  return { file, dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeNs, ctime: stat.ctimeNs };
}

export async function verifySnapshot(expected, { ignoreCtime = false } = {}) {
  const actual = await snapshotFile(expected.file);
  const keys = ignoreCtime ? ['dev', 'ino', 'size', 'mtime'] : ['dev', 'ino', 'size', 'mtime', 'ctime'];
  if (keys.some(key => actual[key] !== expected[key])) {
    throw new Error(`File changed since planning; rerun preview: ${expected.file}`);
  }
}

export async function verifyInventory(inventory, check = () => {}) {
  const files = await getFiles(inventory.root, inventory.recursive, inventory.depth, check);
  check();
  if (files.length !== inventory.files.length || files.some((file, index) => file !== inventory.files[index])) {
    throw new Error(`Folder contents changed since planning; rerun preview: ${inventory.root}`);
  }
}
