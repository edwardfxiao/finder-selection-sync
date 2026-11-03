import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'finder-transfer-'));
const directoryName = 'finder-selection-sync';
const snapshot = path.join(temporary, directoryName);
const excluded = new Set(['node_modules', 'dist', 'renderer-dist', '.build', '.DS_Store']);
const sources = [
  '.github', '.gitignore', '.nvmrc', 'README.md', 'LICENSE',
  'package.json', 'package-lock.json', 'bin', 'src', 'test', 'scripts', 'docs', 'design', 'electron',
];
try {
  // Copy history through a bundle, not .git/config/hooks/credentials from this Mac.
  let hasHistory = false;
  try {
    const top = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: repositoryRoot });
    await exec('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repositoryRoot });
    hasHistory = await fs.realpath(top.stdout.trim()) === await fs.realpath(repositoryRoot);
  } catch { /* Source exports without Git history can still be transferred. */ }
  if (hasHistory) {
    const bundle = path.join(temporary, 'history.bundle');
    await exec('git', ['bundle', 'create', bundle, '--all'], { cwd: repositoryRoot });
    await exec('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--template=', '--no-checkout', bundle, snapshot]);
    await exec('git', ['remote', 'remove', 'origin'], { cwd: snapshot });
    // This only builds the index in the new temporary clone; source files are untouched.
    await exec('git', ['reset', '--mixed', 'HEAD'], { cwd: snapshot });
  } else {
    await fs.mkdir(snapshot);
  }
  for (const name of sources) {
    const from = path.join(repositoryRoot, name);
    try { await fs.access(from); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await fs.cp(from, path.join(snapshot, name), {
      recursive: true,
      filter: source => !excluded.has(path.basename(source)) && !path.basename(source).startsWith('.env'),
    });
  }
  const output = path.join(repositoryRoot, 'transfer');
  await fs.mkdir(output, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = path.join(output, `finder-selection-sync-source-${stamp}.tar.gz`);
  await exec('tar', ['-czf', archive, '-C', temporary, directoryName], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const bytes = await fs.readFile(archive);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);
  console.log(`Transfer ready: ${archive}\n${bytes.length} bytes; ${hasHistory ? 'Git history and current uncommitted files included' : 'current source files included'}.\nNo dependencies, installers, account configuration or Git remote copied.`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
