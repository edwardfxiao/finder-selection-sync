import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json');

export const PACKAGE_NAME = 'finder-selection-sync';
export const VERSION = packageMetadata.version;

// Finder label bits live in bits 1-3 of byte 9 in com.apple.FinderInfo.
// Preserve every other FinderInfo bit instead of replacing the entire value.
const FINDER_LABEL_BITS = {
  clear: 0x00,
  gray: 0x02,
  green: 0x04,
  purple: 0x06,
  blue: 0x08,
  yellow: 0x0a,
  red: 0x0c,
  orange: 0x0e,
};

const VALID_SCOPES = new Set(['base', 'targets', 'both']);
const VALID_SELECTIONS = new Set(['matched', 'unmatched', 'all']);
const VALID_MATCH_MODES = new Set(['any', 'all']);

const usage = `
Match a base folder against one or more target folders by original filename,
then apply macOS Finder color labels to the selected files.

Usage:
  finder-selection-sync <base> <target...> [options]
  finder-selection-sync --base <base> --target <target> [--target <target> ...] [options]

Options:
  --scope <base|targets|both>    Side on which labels are applied (default: targets)
  --select <mode>                matched, unmatched, or all (default: matched)
  --clear-all                    Shortcut for --select all --color clear
  --match <any|all>              Match a base file in any or all targets (default: any)
  --color <color>                clear/gray/green/purple/blue/yellow/red/orange
                                 (default: green)
  --apply                        Apply changes; without this flag, only preview changes
  --no-recursive                 Do not scan nested folders (recursive by default)
  --list-limit <number>          Maximum selected paths to print; 0 prints all (default: 30)
  -v, --version                  Show the installed version
  -h, --help                     Show this help

Matching rule:
  Extensions are ignored and matching is case-insensitive. A processing suffix
  beginning with the first "-[" is removed. For example, ITEM_0001.DAT,
  ITEM_0001-[variant-a][small].dat, and
  ITEM_0001-[variant-a][small][export][web].dat all use the key item_0001.
`;

export function getMatchKey(filePath) {
  const stem = path.parse(path.basename(filePath)).name;
  const processingSuffixAt = stem.indexOf('-[');
  const originalStem = processingSuffixAt === -1 ? stem : stem.slice(0, processingSuffixAt);
  return originalStem.normalize('NFC').toLocaleLowerCase('en-US');
}

function requireValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value after ${option}`);
  }
  return value;
}

export function parseArgs(args) {
  const options = {
    base: undefined,
    targets: [],
    scope: 'targets',
    select: 'matched',
    match: 'any',
    color: 'green',
    apply: false,
    recursive: true,
    listLimit: 30,
    help: false,
    version: false,
    clearAll: false,
  };
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '-h' || argument === '--help') {
      options.help = true;
    } else if (argument === '-v' || argument === '--version') {
      options.version = true;
    } else if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--clear-all') {
      options.clearAll = true;
    } else if (argument === '--no-recursive') {
      options.recursive = false;
    } else if (argument === '--base') {
      options.base = requireValue(args, index, argument);
      index += 1;
    } else if (argument === '--target') {
      options.targets.push(requireValue(args, index, argument));
      index += 1;
    } else if (argument === '--scope') {
      options.scope = requireValue(args, index, argument);
      index += 1;
    } else if (argument === '--select') {
      options.select = requireValue(args, index, argument);
      index += 1;
    } else if (argument === '--match') {
      options.match = requireValue(args, index, argument);
      index += 1;
    } else if (argument === '--color') {
      options.color = requireValue(args, index, argument).toLowerCase();
      index += 1;
    } else if (argument === '--list-limit') {
      options.listLimit = Number(requireValue(args, index, argument));
      index += 1;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (!options.base && positional.length > 0) {
    options.base = positional.shift();
  }
  options.targets.push(...positional);

  if (options.clearAll) {
    options.select = 'all';
    options.color = 'clear';
  }

  if (!options.help && !options.version) {
    if (!options.base) throw new Error('A base folder is required');
    if (options.targets.length === 0) throw new Error('At least one target folder is required');
    if (!VALID_SCOPES.has(options.scope)) throw new Error(`Invalid --scope: ${options.scope}`);
    if (!VALID_SELECTIONS.has(options.select)) throw new Error(`Invalid --select: ${options.select}`);
    if (!VALID_MATCH_MODES.has(options.match)) throw new Error(`Invalid --match: ${options.match}`);
    if (!(options.color in FINDER_LABEL_BITS)) throw new Error(`Invalid --color: ${options.color}`);
    if (!Number.isInteger(options.listLimit) || options.listLimit < 0) {
      throw new Error('--list-limit must be an integer greater than or equal to 0');
    }
  }

  return options;
}

async function assertDirectory(directoryPath, label) {
  let stat;
  try {
    stat = await fs.stat(directoryPath);
  } catch (error) {
    throw new Error(`${label} does not exist or cannot be read: ${directoryPath} (${error.message})`);
  }
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${directoryPath}`);
}

export async function getFiles(directoryPath, recursive = true) {
  const result = [];

  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const itemPath = path.join(currentPath, entry.name);
      if (entry.isFile()) result.push(itemPath);
      else if (recursive && entry.isDirectory()) await visit(itemPath);
    }
  }

  await visit(directoryPath);
  return result;
}

function indexFiles(files) {
  const index = new Map();
  for (const file of files) {
    const key = getMatchKey(file);
    const paths = index.get(key) ?? [];
    paths.push(file);
    index.set(key, paths);
  }
  return index;
}

export function createPlan(baseFiles, targetFileGroups, options) {
  const baseIndex = indexFiles(baseFiles);
  const targetIndexes = targetFileGroups.map(indexFiles);
  const selectedBase = [];
  const selectedTargets = [];

  for (const [key, files] of baseIndex) {
    const hitCount = targetIndexes.reduce(
      (count, targetIndex) => count + Number(targetIndex.has(key)),
      0,
    );
    const matches = options.match === 'all'
      ? hitCount === targetIndexes.length
      : hitCount > 0;
    if (options.select === 'all' || (options.select === 'matched') === matches) {
      selectedBase.push(...files);
    }
  }

  for (let index = 0; index < targetIndexes.length; index += 1) {
    const selected = [];
    for (const [key, files] of targetIndexes[index]) {
      const matches = baseIndex.has(key);
      if (options.select === 'all' || (options.select === 'matched') === matches) {
        selected.push(...files);
      }
    }
    selectedTargets.push(selected);
  }

  const filesToLabel = [];
  if (options.scope === 'base' || options.scope === 'both') {
    filesToLabel.push(...selectedBase);
  }
  if (options.scope === 'targets' || options.scope === 'both') {
    for (const files of selectedTargets) filesToLabel.push(...files);
  }

  return {
    baseIndex,
    targetIndexes,
    selectedBase,
    selectedTargets,
    filesToLabel: [...new Set(filesToLabel)],
  };
}

async function readFinderInfo(filePath) {
  try {
    const { stdout } = await execFile('/usr/bin/xattr', [
      '-px',
      'com.apple.FinderInfo',
      filePath,
    ]);
    const hex = stdout.replace(/\s/g, '');
    if (!/^[0-9a-f]*$/iu.test(hex) || hex.length % 2 !== 0) {
      throw new Error(`Unable to parse FinderInfo: ${stdout}`);
    }
    const existing = Buffer.from(hex, 'hex');
    if (existing.length >= 32) return existing;
    const padded = Buffer.alloc(32);
    existing.copy(padded);
    return padded;
  } catch (error) {
    const message = `${error.stderr ?? ''} ${error.message ?? ''}`;
    if (message.includes('No such xattr')) return Buffer.alloc(32);
    throw error;
  }
}

export async function setFinderLabel(filePath, color) {
  if (!(color in FINDER_LABEL_BITS)) throw new Error(`Invalid Finder label color: ${color}`);
  const finderInfo = await readFinderInfo(filePath);
  finderInfo[9] = (finderInfo[9] & ~0x0e) | FINDER_LABEL_BITS[color];
  await execFile('/usr/bin/xattr', [
    '-wx',
    'com.apple.FinderInfo',
    finderInfo.toString('hex'),
    filePath,
  ]);
}

function printPlan(plan, baseFiles, targetFileGroups, options) {
  console.log(`Mode: ${options.apply ? 'APPLY (modify labels)' : 'DRY-RUN (preview only)'}`);
  console.log(`Match: ${options.match}; selection: ${options.select}; scope: ${options.scope}; color: ${options.color}`);
  console.log(`Base: ${baseFiles.length} files / ${plan.baseIndex.size} match keys`);
  for (let index = 0; index < targetFileGroups.length; index += 1) {
    console.log(`Target ${index + 1}: ${targetFileGroups[index].length} files / ${plan.targetIndexes[index].size} match keys`);
  }
  console.log(`Selected in base: ${plan.selectedBase.length} files`);
  for (let index = 0; index < plan.selectedTargets.length; index += 1) {
    console.log(`Selected in target ${index + 1}: ${plan.selectedTargets[index].length} files`);
  }
  const action = options.color === 'clear' ? 'clear' : 'label';
  console.log(`Files to ${action}: ${plan.filesToLabel.length}`);

  const visible = options.listLimit === 0
    ? plan.filesToLabel
    : plan.filesToLabel.slice(0, options.listLimit);
  for (const file of visible) console.log(`  ${file}`);
  if (visible.length < plan.filesToLabel.length) {
    console.log(`  ... ${plan.filesToLabel.length - visible.length} more (use --list-limit 0 to show all)`);
  }
}

export async function run(options) {
  const base = path.resolve(options.base);
  const targets = options.targets.map(target => path.resolve(target));
  await assertDirectory(base, 'base');
  await Promise.all(
    targets.map((target, index) => assertDirectory(target, `target ${index + 1}`)),
  );

  const [baseFiles, ...targetFileGroups] = await Promise.all([
    getFiles(base, options.recursive),
    ...targets.map(target => getFiles(target, options.recursive)),
  ]);
  const plan = createPlan(baseFiles, targetFileGroups, options);
  printPlan(plan, baseFiles, targetFileGroups, options);

  if (!options.apply) {
    console.log('\nPreview only; no files were modified. Add --apply to make these changes.');
    return { plan, failures: [] };
  }

  const failures = [];
  let completed = 0;
  for (const file of plan.filesToLabel) {
    try {
      await setFinderLabel(file, options.color);
      completed += 1;
    } catch (error) {
      failures.push({ file, error });
      console.error(`Failed to label: ${file}\n  ${error.message}`);
    }
  }
  console.log(`\nDone: ${completed} succeeded, ${failures.length} failed.`);
  if (failures.length > 0) process.exitCode = 2;
  return { plan, failures };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    if (options.help) {
      console.log(usage.trim());
      return;
    }
    if (options.version) {
      console.log(VERSION);
      return;
    }
    await run(options);
  } catch (error) {
    console.error(`Error: ${error.message}\n\n${usage.trim()}`);
    process.exitCode = 1;
  }
}
