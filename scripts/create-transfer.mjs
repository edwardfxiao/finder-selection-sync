import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const directoryName = 'finder-selection-sync';
const excluded = new Set([
  'node_modules', 'dist', 'renderer-dist', '.build', 'coverage', 'transfer',
  '.git', '.DS_Store', '.npmrc', '.yarnrc', '.yarnrc.yml',
  '.agents', '.codex', '.aws', '.ssh', '.gnupg',
]);
const sources = [
  '.github', '.gitignore', '.nvmrc', 'README.md', 'LICENSE',
  'package.json', 'package-lock.json', 'bin', 'src', 'test', 'scripts', 'docs', 'design', 'electron',
];
const omitted = name => excluded.has(name) || name.startsWith('.env') || name.startsWith('._');

// Source-only by default. History explicitly includes old identities and contents.
export async function createTransfer({ repositoryRoot = defaultRoot,
  outputDirectory = path.join(repositoryRoot, 'transfer'), withHistory = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('Source transfer requires macOS and its built-in /usr/bin/tar.');
  repositoryRoot = await fs.realpath(repositoryRoot);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'finder-transfer-'));
  const snapshot = path.join(temporary, directoryName);
  const gitEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Source transfer', GIT_AUTHOR_EMAIL: 'source-transfer@example.invalid',
    GIT_COMMITTER_NAME: 'Source transfer', GIT_COMMITTER_EMAIL: 'source-transfer@example.invalid',
  };
  const git = (args, cwd = repositoryRoot) => exec('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: gitEnv });
  const published = [];
  try {
    await fs.mkdir(snapshot);
    if (withHistory) {
      const top = await git(['rev-parse', '--show-toplevel']);
      await git(['rev-parse', '--verify', 'HEAD']);
      if (await fs.realpath(top.stdout.trim()) !== repositoryRoot) throw new Error('No Git history belongs to this project directory.');
      const bundle = path.join(temporary, 'history.bundle');
      await git(['bundle', 'create', bundle, '--all']);
      // A bare clone preserves every branch and tag without copying local config.
      await git(['clone', '--bare', '--template=', bundle, path.join(snapshot, '.git')]);
      await git(['config', 'core.bare', 'false'], snapshot);
      await git(['remote', 'remove', 'origin'], snapshot);
      // Only the temporary copy's index is rebuilt; the source stays untouched.
      await git(['reset', '--mixed', 'HEAD'], snapshot);
      for (const name of ['logs', 'ORIG_HEAD', 'FETCH_HEAD']) {
        await fs.rm(path.join(snapshot, '.git', name), { recursive: true, force: true });
      }
    }
    const included = destination => {
      const relative = path.relative(repositoryRoot, destination);
      const parts = relative.split(path.sep);
      return !path.isAbsolute(relative) && !parts.includes('..') && sources.includes(parts[0]) && !parts.some(omitted);
    };
    for (const name of sources) {
      const from = path.join(repositoryRoot, name);
      try { await fs.lstat(from); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      await fs.cp(from, path.join(snapshot, name), {
        recursive: true, verbatimSymlinks: true,
        filter: async source => {
          if (omitted(path.basename(source))) return false;
          if ((await fs.lstat(source)).isSymbolicLink()) {
            const link = await fs.readlink(source);
            if (path.isAbsolute(link) || !included(path.resolve(path.dirname(source), link)) || !included(await fs.realpath(source))) {
              throw new Error(`Source archive cannot include this symbolic link: ${path.relative(repositoryRoot, source)}`);
            }
          }
          return true;
        },
      });
    }
    // Keep the required development setting, never copy registry credentials.
    try {
      if ((await fs.lstat(path.join(snapshot, 'electron'))).isDirectory()) {
        await fs.writeFile(path.join(snapshot, 'electron', '.npmrc'), 'install-links=false\n');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `finder-selection-sync-source-${stamp}.tar.gz`;
    const stagedArchive = path.join(temporary, filename);
    await exec('/usr/bin/tar', [
      '--format=pax', '--uid', '0', '--gid', '0', '--uname', '', '--gname', '',
      '--no-acls', '--no-xattrs', '--no-fflags', '--no-mac-metadata',
      '-czf', stagedArchive, '-C', temporary, directoryName,
    ], { env: { ...process.env, COPYFILE_DISABLE: '1', TAR_OPTIONS: '', TAR_WRITER_OPTIONS: '' } });
    const bytes = await fs.readFile(stagedArchive);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await fs.mkdir(outputDirectory, { recursive: true });
    const archive = path.join(outputDirectory, filename);
    for (const [file, contents] of [[archive, bytes], [`${archive}.sha256`, `${checksum}  ${filename}\n`]]) {
      const handle = await fs.open(file, 'wx');
      published.push(file);
      try { await handle.writeFile(contents); } finally { await handle.close(); }
    }
    return { archive, checksum, bytes: bytes.length, withHistory };
  } catch (error) {
    await Promise.all(published.map(file => fs.rm(file, { force: true })));
    throw error;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--with-history', '--help', '-h'].includes(arg))) throw new Error('Usage: npm run transfer -- [--with-history]');
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run transfer -- [--with-history]\nDefault: current source only, without Git history or local filesystem metadata.\n--with-history: also includes historical authors, tags and committed file contents.');
  } else {
    const result = await createTransfer({ withHistory: args.includes('--with-history') });
    console.log(`Transfer ready: ${path.relative(defaultRoot, result.archive)}\n${result.bytes} bytes; ${result.withHistory ? 'Git history included (historical authors and contents retained)' : 'current source only; no Git history'}.\nLocal ownership names, macOS metadata, Git reflogs and local registry configuration are excluded.`);
  }
}
