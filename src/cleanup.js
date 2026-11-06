import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileSystem as fs, getFiles, directoryRoot, assertSeparateRoots, snapshotFile, verifySnapshot, verifyInventory } from './files.js';

const execute = promisify(execFile);
export const cleanupUsage = `
Usage:
  finder-selection-sync clean-orphans <folder> --reference-ext <extension> [options]
  finder-selection-sync clean-orphans --base <reference-folder> --target <folder> [--target <folder> ...] --reference-ext <extension> [options]
  finder-selection-sync clean-list <target...> --list <file> --mode <keep|delete> [options]

Common options:
  --apply                     Execute; otherwise preview only
  --permanent                 Permanently delete instead of moving to macOS Trash
  --allow-empty               Explicitly allow an empty reference/list
  --no-recursive              Only files directly inside each folder
  --depth <number>            Maximum subfolder depth (0 = top level)
  --list-limit <number>       Paths to display; 0 = all (default: 30)
  --match-by <mode>           clean-orphans: relative (default), name
                              clean-list: name (default), relative, stem
  -h, --help                  Show this help

Photos:
  --reference-ext <extension> Keep this exact extension; clean all other extensions
                              without a matching reference (e.g. nef, cr3, jpg)
                              Case-insensitive; a leading dot is optional.
                              Files without an extension are preserved.
  --reference cr3             Legacy paired mode: keep CR3; clean JPG/JPEG without matching CR3
  --reference jpeg            Legacy paired mode: keep JPG/JPEG; clean CR3 without matching JPG/JPEG
  Matching ignores case and extensions, but preserves processing suffixes.

Lists:
  --list <file>               UTF-8 text, one filename/path per line
  --mode keep                Clean files absent from the list
  --mode delete              Clean files present in the list
  --include-ext <csv>         Only consider these extensions (e.g. jpg,jpeg)
  --exclude-ext <csv>         Always preserve these extensions (e.g. xmp,mov)
  --ignore-case              Case-insensitive list matching (default: exact case)

No directories, hidden files, or symlinks are removed. Lists are always protected.
`;

function extensions(value) {
  const values = value.split(',').map(item => item.trim().replace(/^\./u, '').toLowerCase());
  if (values.some(item => !/^[a-z0-9]+$/u.test(item))) throw new Error('Extensions must be a comma-separated list such as jpg,jpeg');
  return [...new Set(values.map(item => `.${item}`))];
}

export function parseCleanupArgs(args) {
  const command = args[0];
  if (!['clean-orphans', 'clean-list'].includes(command)) throw new Error(`Unknown cleanup command: ${command}`);
  const options = { command, targets: [], apply: false, permanent: false, allowEmpty: false,
    recursive: true, depth: Infinity, listLimit: 30, matchBy: command === 'clean-orphans' ? 'relative' : 'name',
    ignoreCase: false, includeExt: [], excludeExt: [] };
  const flags = new Map([['--apply', 'apply'], ['--permanent', 'permanent'], ['--allow-empty', 'allowEmpty'],
    ['--ignore-case', 'ignoreCase'], ['--help', 'help'], ['-h', 'help']]);
  const values = new Map([['--base', 'base'], ['--target', 'targets'], ['--reference', 'reference'], ['--reference-ext', 'referenceExt'],
    ['--list', 'list'], ['--mode', 'mode'], ['--match-by', 'matchBy'], ['--depth', 'depth'],
    ['--list-limit', 'listLimit'], ['--include-ext', 'includeExt'], ['--exclude-ext', 'excludeExt']]);
  const seen = new Set();
  const positional = [];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') { positional.push(...args.slice(i + 1)); break; }
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    if (seen.has(arg) && arg !== '--target') throw new Error(`Repeated option: ${arg}`);
    seen.add(arg);
    if (arg === '--no-recursive') { options.recursive = false; continue; }
    if (flags.has(arg)) { options[flags.get(arg)] = true; continue; }
    if (!values.has(arg)) throw new Error(`Unknown option for ${command}: ${arg}`);
    const value = args[++i];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`Missing value after ${arg}`);
    const key = values.get(arg);
    if (key === 'targets') options.targets.push(value);
    else if (key === 'referenceExt') {
      const parsed = extensions(value);
      if (value.includes(',') || parsed.length !== 1) throw new Error('--reference-ext requires exactly one extension');
      options.referenceExt = parsed[0];
    }
    else if (key === 'includeExt' || key === 'excludeExt') options[key] = extensions(value);
    else if (key === 'depth' || key === 'listLimit') {
      if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${arg} must be a non-negative integer`);
      options[key] = Number(value);
    } else options[key] = value;
  }
  if (positional.some(value => value.length === 0)) throw new Error('Directory path must be non-empty');
  if (options.help) return options;
  if (!options.recursive && seen.has('--depth')) throw new Error('--depth cannot be combined with --no-recursive');
  if (command === 'clean-orphans') {
    if (['--list', '--mode', '--ignore-case', '--include-ext', '--exclude-ext'].some(arg => seen.has(arg))) {
      throw new Error('List options cannot be used with clean-orphans');
    }
    photoTypes(options);
    if (!['relative', 'name'].includes(options.matchBy)) throw new Error('--match-by must be relative or name for clean-orphans');
    if (positional.length) {
      if (positional.length !== 1 || options.base || options.targets.length) throw new Error('Use one mixed folder OR --base with --target folders');
      options.base = positional[0];
      options.targets = [positional[0]];
      options.mixed = true;
    } else if (!options.base || !options.targets.length) throw new Error('Provide one mixed folder OR --base and --target');
  } else {
    if (seen.has('--base') || seen.has('--reference') || seen.has('--reference-ext')) throw new Error('Photo options cannot be used with clean-list');
    options.targets.push(...positional);
    if (!options.targets.length || !options.list) throw new Error('clean-list requires targets and --list');
    if (!['keep', 'delete'].includes(options.mode)) throw new Error('--mode must be keep or delete');
    if (!['name', 'relative', 'stem'].includes(options.matchBy)) throw new Error('--match-by must be name, relative, or stem for clean-list');
  }
  return options;
}

const normalize = (value, ignoreCase) => {
  const normalized = value.normalize('NFC');
  return ignoreCase ? normalized.toLocaleLowerCase('en-US') : normalized;
};
const ext = file => path.extname(file).toLowerCase();
const stem = file => path.parse(file).name;

export function photoKey(file, root, matchBy) {
  const relative = path.relative(root, file);
  const key = matchBy === 'name' ? stem(file) : path.join(path.dirname(relative), stem(file));
  return normalize(key, true);
}

function photoTypes(options) {
  if (options.referenceExt !== undefined) {
    if (options.reference !== undefined) throw new Error('--reference-ext cannot be combined with --reference');
    const parsed = extensions(options.referenceExt);
    if (options.referenceExt.includes(',') || parsed.length !== 1) throw new Error('--reference-ext requires exactly one extension');
    return { referenceExtensions: parsed, targetExtensions: null };
  }
  if (!['cr3', 'jpeg'].includes(options.reference)) {
    throw new Error('Specify --reference-ext <extension> (or legacy --reference cr3|jpeg)');
  }
  return options.reference === 'cr3'
    ? { referenceExtensions: ['.cr3'], targetExtensions: ['.jpg', '.jpeg'] }
    : { referenceExtensions: ['.jpg', '.jpeg'], targetExtensions: ['.cr3'] };
}

export function createPhotoPlan(baseFiles, targetGroups, options) {
  const { referenceExtensions, targetExtensions } = photoTypes(options);
  const isReference = file => referenceExtensions.includes(ext(file));
  const referenceFiles = baseFiles.filter(isReference);
  if (!referenceFiles.length && !options.allowEmpty) throw new Error('Empty photo reference; use --allow-empty only if intentional');
  const keys = new Set(referenceFiles.map(file => photoKey(file, options.base, options.matchBy)));
  const filesToUpdate = targetGroups.flatMap((files, index) => files.filter(file => {
    const extension = ext(file);
    const eligible = targetExtensions === null
      ? extension.length > 1 && !isReference(file)
      : targetExtensions.includes(extension);
    return eligible && !keys.has(photoKey(file, options.targets[index], options.matchBy));
  }));
  const protectedFiles = [...new Set([...referenceFiles, ...targetGroups.flat().filter(isReference)])];
  return { referenceFiles, protectedFiles, filesToUpdate: [...new Set(filesToUpdate)] };
}

export function parseList(content, options) {
  if (content.includes('\0')) throw new Error('List must be valid UTF-8 text without NUL characters');
  const entries = content.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u).filter(line => line.trim() !== '');
  const keys = entries.map(entry => {
    if (options.matchBy === 'relative') {
      if (path.isAbsolute(entry) || entry.split('/').includes('..') || entry.endsWith('/')) {
        throw new Error(`List requires relative file paths without traversal: ${JSON.stringify(entry)}`);
      }
      entry = path.normalize(entry);
      if (entry === '.') throw new Error('List entry must name a file');
    } else {
      if (entry.endsWith('/')) throw new Error(`List entry must name a file: ${JSON.stringify(entry)}`);
      entry = options.matchBy === 'stem' ? stem(entry) : path.basename(entry);
    }
    return normalize(entry, options.ignoreCase);
  });
  if (!keys.length && !options.allowEmpty) throw new Error('Empty list; use --allow-empty only if intentional');
  return new Set(keys);
}

export function createListPlan(targetGroups, keys, options) {
  const filesToUpdate = targetGroups.flatMap((files, index) => files.filter(file => {
    if (file === options.list) return false;
    if (options.includeExt.length && !options.includeExt.includes(ext(file))) return false;
    if (options.excludeExt.includes(ext(file))) return false;
    const key = options.matchBy === 'relative' ? path.relative(options.targets[index], file)
      : options.matchBy === 'stem' ? stem(file) : path.basename(file);
    const matched = keys.has(normalize(key, options.ignoreCase));
    return options.mode === 'delete' ? matched : !matched;
  }));
  return { filesToUpdate: [...new Set(filesToUpdate)] };
}

// File paths are passed as argv, never interpolated into AppleScript or a shell.
export const trashScript = `on run argv
  tell application "Finder"
    set trashedItem to delete (POSIX file (item 1 of argv) as alias)
    if class of trashedItem is list then set trashedItem to item 1 of trashedItem
    return POSIX path of (trashedItem as alias)
  end tell
end run`;
export async function moveToTrash(file, exec = execute) {
  if (process.platform !== 'darwin') throw new Error('Trash requires macOS; use --permanent for permanent deletion');
  const result = await exec('/usr/bin/osascript', ['-e', trashScript, file]);
  return result?.stdout?.replace(/\n$/u, '');
}

export async function executeCleanup(plan, options, { trash = moveToTrash, unlink = fs.unlink, shouldCancel = () => false } = {}) {
  if (!options.apply) return { plan, completed: 0, failures: [] };
  const cancelled = new Error('Cleanup cancelled');
  const check = () => { if (shouldCancel()) throw cancelled; };
  // Verify the whole plan before the first mutation, then each candidate again.
  try {
    for (const inventory of plan.inventories ?? []) await verifyInventory(inventory, check);
    for (const snapshot of plan.snapshots) { check(); await verifySnapshot(snapshot); }
    check();
  } catch (error) {
    if (error === cancelled) return { plan, completed: 0, failures: [], cancelled: true };
    throw error;
  }
  const snapshots = new Map(plan.snapshots.map(snapshot => [snapshot.file, snapshot]));
  const failures = [];
  const changedInodes = new Set();
  let completed = 0;
  for (const file of plan.filesToUpdate) {
    if (shouldCancel()) return { plan, completed, failures, cancelled: true };
    try {
      for (const reference of plan.liveSnapshots ?? []) { check(); await verifySnapshot(reference); }
      if (plan.verifyReference) await plan.verifyReference(file, check);
      const snapshot = snapshots.get(file);
      if (!snapshot) throw new Error(`Missing safety snapshot: ${file}`);
      const identity = `${snapshot.dev}:${snapshot.ino}`;
      // Removing an earlier hard link changes the shared inode's ctime.
      // Continue checking identity, size and modification time for its other links.
      await verifySnapshot(snapshot, { ignoreCtime: changedInodes.has(identity) });
      if (shouldCancel()) return { plan, completed, failures, cancelled: true };
      if (options.permanent) await unlink(file);
      else await trash(file);
      changedInodes.add(identity);
      completed += 1;
    } catch (error) {
      if (error === cancelled) return { plan, completed, failures, cancelled: true };
      failures.push({ file, error });
      // Stop on the first error; no silent fallback from Trash to permanent deletion.
      break;
    }
  }
  return { plan, completed, failures };
}

function createReferenceVerifier(options, targetGroups) {
  const { referenceExtensions } = photoTypes(options);
  const rootsByFile = new Map();
  for (let i = 0; i < targetGroups.length; i += 1) {
    for (const file of targetGroups[i]) rootsByFile.set(file, options.targets[i]);
  }
  const directories = new Map();
  async function readDirectory(directory, check) {
    check();
    let stat;
    try {
      stat = await fs.stat(directory, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT' && directory !== options.base) return null;
      throw error;
    }
    check();
    if (!stat.isDirectory() || await fs.realpath(directory) !== directory) {
      throw new Error(`Reference directory changed or contains a symlink: ${directory}`);
    }
    check();
    let cached = directories.get(directory);
    if (!cached || cached.dev !== stat.dev || cached.ino !== stat.ino
      || cached.mtime !== stat.mtimeNs || cached.ctime !== stat.ctimeNs) {
      const entries = (await fs.readdir(directory, { withFileTypes: true }))
        .filter(entry => !entry.name.startsWith('.'));
      check();
      cached = { dev: stat.dev, ino: stat.ino, mtime: stat.mtimeNs, ctime: stat.ctimeNs,
        subdirectories: entries.filter(entry => entry.isDirectory()).map(entry => entry.name),
        referenceNames: new Set(entries.filter(entry => entry.isFile()
          && referenceExtensions.includes(ext(entry.name))).map(entry => normalize(stem(entry.name), true))) };
      directories.set(directory, cached);
    }
    return cached;
  }
  async function hasName(directory, name, check, level = 0) {
    const current = await readDirectory(directory, check);
    if (!current) return false;
    if (current.referenceNames.has(name)) return true;
    if (options.recursive !== false && level < (options.depth ?? Infinity)) {
      for (const subdirectory of current.subdirectories) {
        check();
        if (await hasName(path.join(directory, subdirectory), name, check, level + 1)) return true;
      }
    }
    return false;
  }
  return async (file, check = () => {}) => {
    check();
    const name = normalize(stem(file), true);
    let matched = false;
    if (options.matchBy === 'name') {
      matched = await hasName(options.base, name, check);
    } else {
      const relativeDirectory = path.dirname(path.relative(rootsByFile.get(file), file));
      let parents = [options.base];
      // Resolve each component with the same case/Unicode rules as the planner.
      // More than one directory may match on a case-sensitive filesystem.
      for (const component of relativeDirectory === '.' ? [] : relativeDirectory.split(path.sep)) {
        check();
        const next = [];
        for (const parent of parents) {
          const current = await readDirectory(parent, check);
          for (const subdirectory of current?.subdirectories ?? []) {
            if (normalize(subdirectory, true) === normalize(component, true)) next.push(path.join(parent, subdirectory));
          }
        }
        parents = next;
      }
      for (const parent of parents) {
        if ((await readDirectory(parent, check))?.referenceNames.has(name)) { matched = true; break; }
      }
    }
    check();
    if (matched) throw new Error(`A matching reference appeared since planning; rerun preview: ${file}`);
  };
}

async function settleAll(promises) {
  // A cancelled or failed sibling cannot outlive its plan and overlap a new scan.
  const results = await Promise.allSettled(promises);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map(result => result.value);
}

export async function prepareCleanup(options, { check = () => {} } = {}) {
  check();
  const targets = await settleAll(options.targets.map(directoryRoot));
  check();
  assertSeparateRoots(targets);
  const resolved = { ...options, targets };
  let plan;
  let protectedFiles = [];
  let listSnapshot;
  const inventories = [];
  async function scan(root) {
    const files = await getFiles(root, options.recursive, options.depth, check);
    check();
    inventories.push({ root, files, recursive: options.recursive, depth: options.depth });
    return files;
  }
  async function snapshot(file) {
    check();
    const value = await snapshotFile(file);
    check();
    return value;
  }
  if (options.command === 'clean-orphans') {
    resolved.base = await directoryRoot(options.base);
    check();
    if (!options.mixed) assertSeparateRoots([resolved.base, ...targets]);
    const baseFiles = await scan(resolved.base);
    const groups = options.mixed ? [baseFiles] : await settleAll(targets.map(scan));
    check();
    plan = createPhotoPlan(baseFiles, groups, resolved);
    plan.verifyReference = createReferenceVerifier(resolved, groups);
    protectedFiles = plan.protectedFiles;
  } else {
    resolved.list = await fs.realpath(path.resolve(options.list));
    listSnapshot = await snapshot(resolved.list);
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(resolved.list));
    } catch (error) {
      throw new Error(`Unable to read UTF-8 list: ${error.message}`);
    }
    check();
    await verifySnapshot(listSnapshot);
    check();
    const keys = parseList(content, resolved);
    const groups = await settleAll(targets.map(scan));
    check();
    plan = createListPlan(groups, keys, resolved);
    protectedFiles = [resolved.list];
    plan.listEntries = keys.size;
  }
  const protectedSnapshots = await settleAll(protectedFiles.map(snapshot));
  const protectedIds = new Set(protectedSnapshots.map(item => `${item.dev}:${item.ino}`));
  const candidates = await settleAll(plan.filesToUpdate.map(snapshot));
  // Protect hard links to the reference/list as well as their original paths.
  const selected = candidates.filter(item => !protectedIds.has(`${item.dev}:${item.ino}`));
  plan.filesToUpdate = selected.map(item => item.file);
  plan.snapshots = [...protectedSnapshots, ...selected];
  plan.protectedSnapshots = protectedSnapshots;
  // Recheck a list between operations without rescanning every reference photo per file.
  plan.liveSnapshots = listSnapshot ? [listSnapshot] : [];
  plan.inventories = inventories;
  if (listSnapshot) await verifySnapshot(listSnapshot);
  check();
  return plan;
}

export async function runCleanup(options) {
  const plan = await prepareCleanup(options);
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY-RUN'}; action: ${options.permanent ? 'PERMANENT DELETE' : 'move to Trash'}`);
  console.log(options.command === 'clean-orphans'
    ? options.referenceExt
      ? `Reference extension: ${options.referenceExt}; clean unmatched files of ALL OTHER extensions; match: ${options.matchBy}`
      : `Reference: ${options.reference.toUpperCase()}; clean orphan ${options.reference === 'cr3' ? 'JPG/JPEG' : 'CR3'}; match: ${options.matchBy}`
    : `List: ${options.list}; mode: ${options.mode}; match: ${options.matchBy}; entries: ${plan.listEntries}`);
  console.log(`Files to clean: ${plan.filesToUpdate.length}`);
  const visible = options.listLimit === 0 ? plan.filesToUpdate : plan.filesToUpdate.slice(0, options.listLimit);
  for (const file of visible) console.log(`  ${JSON.stringify(file)}`);
  if (visible.length < plan.filesToUpdate.length) console.log(`  ... ${plan.filesToUpdate.length - visible.length} more (use --list-limit 0)`);
  const result = await executeCleanup(plan, options);
  if (!options.apply) console.log('Preview only; no files changed. Add --apply to execute.');
  else console.log(`Done: ${result.completed} succeeded, ${result.failures.length} failed, ${plan.filesToUpdate.length - result.completed - result.failures.length} not attempted.`);
  for (const { file, error } of result.failures) console.error(`Failed: ${JSON.stringify(file)}: ${error.message}`);
  if (result.failures.length) process.exitCode = 2;
  return result;
}
