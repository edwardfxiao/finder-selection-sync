import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json');

export const PACKAGE_NAME = 'finder-selection-sync';
export const VERSION = packageMetadata.version;

// Finder color bits live in bits 1-3 of byte 9 in com.apple.FinderInfo.
// Preserve every other FinderInfo bit instead of replacing the entire value.
const FINDER_COLOR_BITS = {
  clear: 0x00,
  gray: 0x02,
  green: 0x04,
  purple: 0x06,
  blue: 0x08,
  yellow: 0x0a,
  red: 0x0c,
  orange: 0x0e,
};
const FINDER_BITS_TO_COLOR = new Map(
  Object.entries(FINDER_COLOR_BITS).map(([color, bits]) => [bits, color]),
);
const FINDER_TAG_ATTRIBUTE = 'com.apple.metadata:_kMDItemUserTags';
const FINDER_TAG_COLOR_CODES = {
  gray: 1,
  green: 2,
  purple: 3,
  blue: 4,
  yellow: 5,
  red: 6,
  orange: 7,
};
const FINDER_TAG_COLOR_NAMES = Object.fromEntries(
  Object.keys(FINDER_TAG_COLOR_CODES).map(color => [
    color,
    color[0].toUpperCase() + color.slice(1),
  ]),
);
const FINDER_TAG_CODE_TO_COLOR = new Map(
  Object.entries(FINDER_TAG_COLOR_CODES).map(([color, code]) => [code, color]),
);

const VALID_SCOPES = new Set(['base', 'targets', 'both']);
const VALID_SELECTIONS = new Set(['matched', 'unmatched', 'all']);
const VALID_MATCH_MODES = new Set(['any', 'all']);

const usage = `
Match a base folder against one or more target folders by original filename,
then apply or synchronize macOS Finder Tags.

Usage:
  finder-selection-sync <base> <target...> [options]
  finder-selection-sync --base <base> --target <target> [--target <target> ...] [options]

Options:
  --scope <base|targets|both>    Side on which tag changes are applied (default: targets)
  --select <mode>                matched, unmatched, or all (default: matched)
  --clear-all                    Clear all Finder tags from the selected scope
  --sync-tags                    Copy all base Finder tags to matching target files
  --merge-tags                   Merge base and target tags instead of replacing
  --include-clear                Also copy the untagged state with --sync-tags
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
    syncTags: false,
    mergeTags: false,
    includeClear: false,
    selectionSpecified: false,
    colorSpecified: false,
    matchSpecified: false,
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
    } else if (argument === '--sync-tags') {
      options.syncTags = true;
    } else if (argument === '--merge-tags') {
      options.mergeTags = true;
    } else if (argument === '--include-clear') {
      options.includeClear = true;
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
      options.selectionSpecified = true;
      index += 1;
    } else if (argument === '--match') {
      options.match = requireValue(args, index, argument);
      options.matchSpecified = true;
      index += 1;
    } else if (argument === '--color') {
      options.color = requireValue(args, index, argument).toLowerCase();
      options.colorSpecified = true;
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
    if (!(options.color in FINDER_COLOR_BITS)) throw new Error(`Invalid --color: ${options.color}`);
    if (!Number.isInteger(options.listLimit) || options.listLimit < 0) {
      throw new Error('--list-limit must be an integer greater than or equal to 0');
    }
    if (options.includeClear && !options.syncTags) {
      throw new Error('--include-clear requires --sync-tags');
    }
    if (options.mergeTags && !options.syncTags) {
      throw new Error('--merge-tags requires --sync-tags');
    }
    if (options.syncTags && options.scope !== 'targets') {
      throw new Error('--sync-tags supports only --scope targets');
    }
    if (options.syncTags && options.clearAll) {
      throw new Error('--sync-tags cannot be combined with --clear-all');
    }
    if (options.syncTags && (options.selectionSpecified || options.colorSpecified || options.matchSpecified)) {
      throw new Error('--sync-tags cannot be combined with --select, --color, or --match');
    }
  }

  return options;
}

async function assertDirectory(directoryPath, description) {
  let stat;
  try {
    stat = await fs.stat(directoryPath);
  } catch (error) {
    throw new Error(`${description} does not exist or cannot be read: ${directoryPath} (${error.message})`);
  }
  if (!stat.isDirectory()) throw new Error(`${description} is not a directory: ${directoryPath}`);
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

  const filesToUpdate = [];
  if (options.scope === 'base' || options.scope === 'both') {
    filesToUpdate.push(...selectedBase);
  }
  if (options.scope === 'targets' || options.scope === 'both') {
    for (const files of selectedTargets) filesToUpdate.push(...files);
  }

  return {
    baseIndex,
    targetIndexes,
    selectedBase,
    selectedTargets,
    filesToUpdate: [...new Set(filesToUpdate)],
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const result = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
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

async function readFinderInfoColor(filePath) {
  const finderInfo = await readFinderInfo(filePath);
  return FINDER_BITS_TO_COLOR.get(finderInfo[9] & 0x0e) ?? 'clear';
}

async function writeFinderInfoColor(filePath, color) {
  if (!(color in FINDER_COLOR_BITS)) throw new Error(`Invalid Finder tag color: ${color}`);
  const finderInfo = await readFinderInfo(filePath);
  finderInfo[9] = (finderInfo[9] & ~0x0e) | FINDER_COLOR_BITS[color];
  await execFile('/usr/bin/xattr', [
    '-wx',
    'com.apple.FinderInfo',
    finderInfo.toString('hex'),
    filePath,
  ]);
}

function runPlutil(input, format) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/plutil', ['-convert', format, '-o', '-', '--', '-']);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`plutil failed: ${Buffer.concat(stderr).toString().trim()}`));
    });
    child.stdin.end(input);
  });
}

function normalizeFinderTags(tags) {
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) {
    throw new Error('Finder tags must be an array of strings');
  }
  return [...new Set(tags.map(tag => tag.normalize('NFC')))];
}

function finderTagSetSignature(tags) {
  return JSON.stringify([...normalizeFinderTags(tags)].sort());
}

function isMissingXattr(error) {
  return `${error.stderr ?? ''} ${error.message ?? ''}`.includes('No such xattr');
}

async function readModernFinderTags(filePath) {
  try {
    const { stdout } = await execFile('/usr/bin/xattr', [
      '-px',
      FINDER_TAG_ATTRIBUTE,
      filePath,
    ]);
    const hex = stdout.replace(/\s/g, '');
    if (!/^[0-9a-f]*$/iu.test(hex) || hex.length % 2 !== 0) {
      throw new Error(`Unable to parse Finder tag metadata: ${stdout}`);
    }
    const json = await runPlutil(Buffer.from(hex, 'hex'), 'json');
    return normalizeFinderTags(JSON.parse(json.toString('utf8')));
  } catch (error) {
    if (isMissingXattr(error)) return null;
    throw error;
  }
}

function finderColorAsTag(color) {
  const code = FINDER_TAG_COLOR_CODES[color];
  return `${FINDER_TAG_COLOR_NAMES[color]}\n${code}`;
}

function finderTagColorCode(tag) {
  const match = tag.match(/\n([0-7])$/u);
  return match ? Number(match[1]) : 0;
}

export async function getFinderTags(filePath) {
  const modernTags = await readModernFinderTags(filePath);
  if (modernTags?.length > 0) return modernTags;

  // FinderInfo remains a fallback because Finder can store a color there without a tag array.
  const finderInfoColor = await readFinderInfoColor(filePath);
  return finderInfoColor === 'clear' ? [] : [finderColorAsTag(finderInfoColor)];
}

export async function setFinderTags(filePath, tags) {
  const normalizedTags = normalizeFinderTags(tags);
  if (normalizedTags.length === 0) {
    try {
      await execFile('/usr/bin/xattr', ['-d', FINDER_TAG_ATTRIBUTE, filePath]);
    } catch (error) {
      if (!isMissingXattr(error)) throw error;
    }
  } else {
    const binaryPlist = await runPlutil(
      Buffer.from(JSON.stringify(normalizedTags), 'utf8'),
      'binary1',
    );
    await execFile('/usr/bin/xattr', [
      '-wx',
      FINDER_TAG_ATTRIBUTE,
      binaryPlist.toString('hex'),
      filePath,
    ]);
  }

  const primaryColorCode = normalizedTags.map(finderTagColorCode).find(code => code > 0) ?? 0;
  const primaryColor = FINDER_TAG_CODE_TO_COLOR.get(primaryColorCode) ?? 'clear';
  await writeFinderInfoColor(filePath, primaryColor);
  return normalizedTags;
}

export async function createTagSyncPlan(
  baseFiles,
  targetFileGroups,
  {
    includeClear = false,
    mergeTags = false,
    readTags = getFinderTags,
  } = {},
) {
  const baseIndex = indexFiles(baseFiles);
  const targetIndexes = targetFileGroups.map(indexFiles);
  const baseTagEntries = await mapWithConcurrency(baseFiles, 8, async file => ({
    file,
    key: getMatchKey(file),
    tags: normalizeFinderTags(await readTags(file)),
  }));
  const candidatesByKey = new Map();
  let skippedUntaggedFiles = 0;

  for (const entry of baseTagEntries) {
    if (entry.tags.length === 0 && !includeClear) {
      skippedUntaggedFiles += 1;
      continue;
    }
    const signature = finderTagSetSignature(entry.tags);
    const candidates = candidatesByKey.get(entry.key) ?? new Map();
    const candidate = candidates.get(signature) ?? { tags: entry.tags, files: [] };
    candidate.files.push(entry.file);
    candidates.set(signature, candidate);
    candidatesByKey.set(entry.key, candidates);
  }

  const tagsByKey = new Map();
  const conflicts = [];
  for (const [key, candidates] of candidatesByKey) {
    if (candidates.size === 1) {
      tagsByKey.set(key, candidates.values().next().value.tags);
    } else {
      conflicts.push({ key, tagSets: [...candidates.values()] });
    }
  }

  const operationsByTarget = targetFileGroups.map(() => []);
  const unchangedByTarget = targetFileGroups.map(() => 0);
  const targetEntries = [];
  for (let targetIndex = 0; targetIndex < targetFileGroups.length; targetIndex += 1) {
    for (const file of targetFileGroups[targetIndex]) {
      targetEntries.push({ file, targetIndex, key: getMatchKey(file) });
    }
  }
  const targetTags = await mapWithConcurrency(targetEntries, 8, entry => readTags(entry.file));

  for (let index = 0; index < targetEntries.length; index += 1) {
    const entry = targetEntries[index];
    const sourceTags = tagsByKey.get(entry.key);
    if (sourceTags === undefined) continue;
    const currentTags = normalizeFinderTags(targetTags[index]);
    const desiredTags = sourceTags.length === 0
      ? []
      : mergeTags
        ? normalizeFinderTags([...currentTags, ...sourceTags])
        : sourceTags;
    if (finderTagSetSignature(currentTags) === finderTagSetSignature(desiredTags)) {
      unchangedByTarget[entry.targetIndex] += 1;
      continue;
    }
    operationsByTarget[entry.targetIndex].push({
      file: entry.file,
      key: entry.key,
      currentTags,
      tags: desiredTags,
    });
  }

  const operationsByFile = new Map();
  for (const operations of operationsByTarget) {
    for (const operation of operations) operationsByFile.set(operation.file, operation);
  }

  return {
    baseIndex,
    targetIndexes,
    tagsByKey,
    conflicts,
    skippedUntaggedFiles,
    operationsByTarget,
    unchangedByTarget,
    operations: [...operationsByFile.values()],
  };
}

function printPlan(plan, baseFiles, targetFileGroups, options) {
  console.log(`Mode: ${options.apply ? 'APPLY (modify tags)' : 'DRY-RUN (preview only)'}`);
  console.log(`Match: ${options.match}; selection: ${options.select}; scope: ${options.scope}; color: ${options.color}`);
  console.log(`Base: ${baseFiles.length} files / ${plan.baseIndex.size} match keys`);
  for (let index = 0; index < targetFileGroups.length; index += 1) {
    console.log(`Target ${index + 1}: ${targetFileGroups[index].length} files / ${plan.targetIndexes[index].size} match keys`);
  }
  console.log(`Selected in base: ${plan.selectedBase.length} files`);
  for (let index = 0; index < plan.selectedTargets.length; index += 1) {
    console.log(`Selected in target ${index + 1}: ${plan.selectedTargets[index].length} files`);
  }
  const action = options.clearAll || options.color === 'clear' ? 'clear tags from' : 'set tags on';
  console.log(`Files to ${action}: ${plan.filesToUpdate.length}`);

  const visible = options.listLimit === 0
    ? plan.filesToUpdate
    : plan.filesToUpdate.slice(0, options.listLimit);
  for (const file of visible) console.log(`  ${file}`);
  if (visible.length < plan.filesToUpdate.length) {
    console.log(`  ... ${plan.filesToUpdate.length - visible.length} more (use --list-limit 0 to show all)`);
  }
}

function formatFinderTags(tags) {
  return tags.length === 0 ? '(none)' : tags.map(tag => JSON.stringify(tag)).join(', ');
}

function printTagSyncPlan(plan, baseFiles, targetFileGroups, options) {
  console.log(`Mode: ${options.apply ? 'APPLY (sync tags)' : 'DRY-RUN (preview only)'}`);
  console.log(
    `Operation: sync base tags; include clear: ${options.includeClear ? 'yes' : 'no'}; `
    + `merge: ${options.mergeTags ? 'yes' : 'no'}`,
  );
  console.log(`Base: ${baseFiles.length} files / ${plan.baseIndex.size} match keys`);
  console.log(`Base tag keys to sync: ${plan.tagsByKey.size}`);
  console.log(`Untagged base files skipped: ${plan.skippedUntaggedFiles}`);
  console.log(`Conflicting base keys: ${plan.conflicts.length}`);
  for (let index = 0; index < targetFileGroups.length; index += 1) {
    console.log(
      `Target ${index + 1}: ${targetFileGroups[index].length} files / `
      + `${plan.targetIndexes[index].size} match keys / `
      + `${plan.operationsByTarget[index].length} updates / `
      + `${plan.unchangedByTarget[index]} already synchronized`,
    );
  }
  console.log(`Files to update: ${plan.operations.length}`);

  for (const conflict of plan.conflicts) {
    console.log(`  CONFLICT ${conflict.key}`);
    for (const tagSet of conflict.tagSets) {
      for (const file of tagSet.files) {
        console.log(`    [${formatFinderTags(tagSet.tags)}] ${file}`);
      }
    }
  }

  const visible = options.listLimit === 0
    ? plan.operations
    : plan.operations.slice(0, options.listLimit);
  for (const operation of visible) {
    console.log(`  [${formatFinderTags(operation.tags)}] ${operation.file}`);
  }
  if (visible.length < plan.operations.length) {
    console.log(`  ... ${plan.operations.length - visible.length} more (use --list-limit 0 to show all)`);
  }
}

async function runTagSync(baseFiles, targetFileGroups, options) {
  const plan = await createTagSyncPlan(baseFiles, targetFileGroups, {
    includeClear: options.includeClear,
    mergeTags: options.mergeTags,
  });
  printTagSyncPlan(plan, baseFiles, targetFileGroups, options);

  if (plan.conflicts.length > 0) {
    console.error('\nNo tags were changed because base files contain conflicting tag sets.');
    if (options.apply) process.exitCode = 2;
    return { plan, failures: [], conflicts: plan.conflicts };
  }
  if (!options.apply) {
    console.log('\nPreview only; no files were modified. Add --apply to sync these tags.');
    return { plan, failures: [] };
  }

  const failures = [];
  let completed = 0;
  for (const operation of plan.operations) {
    try {
      await setFinderTags(operation.file, operation.tags);
      completed += 1;
    } catch (error) {
      failures.push({ ...operation, error });
      console.error(`Failed to set tags: ${operation.file}\n  ${error.message}`);
    }
  }
  console.log(`\nDone: ${completed} succeeded, ${failures.length} failed.`);
  if (failures.length > 0) process.exitCode = 2;
  return { plan, failures };
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
  if (options.syncTags) {
    return runTagSync(baseFiles, targetFileGroups, options);
  }
  const plan = createPlan(baseFiles, targetFileGroups, options);
  printPlan(plan, baseFiles, targetFileGroups, options);

  if (!options.apply) {
    console.log('\nPreview only; no files were modified. Add --apply to make these changes.');
    return { plan, failures: [] };
  }

  const failures = [];
  let completed = 0;
  for (const file of plan.filesToUpdate) {
    try {
      const tags = options.color === 'clear' ? [] : [finderColorAsTag(options.color)];
      await setFinderTags(file, tags);
      completed += 1;
    } catch (error) {
      failures.push({ file, error });
      console.error(`Failed to set tags: ${file}\n  ${error.message}`);
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
