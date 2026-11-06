import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { appError, describeError, message } from './messages.js';
import {
  createPlan, createTagSyncPlan, finderColorAsTag, getFinderTags, getMatchKey, setFinderTags, filterFiles, validateFileFilters, compareFolderFiles,
} from 'finder-selection-sync';
import { prepareCleanup, executeCleanup, photoKey, parseList, moveToTrash } from 'finder-selection-sync/cleanup';
import {
  fileSystem as fs, getFiles, directoryRoot, assertSeparateRoots, snapshotFile, verifySnapshot, verifyInventory,
} from 'finder-selection-sync/files';

const colors = new Set(['gray', 'green', 'purple', 'blue', 'yellow', 'red', 'orange']);
const normalize = (value, ignoreCase = false) => {
  const nfc = value.normalize('NFC');
  return ignoreCase ? nfc.toLocaleLowerCase('en-US') : nfc;
};
const tagSignature = tags => JSON.stringify([...new Set(tags.map(t => normalize(t)))].sort());
const planAction = options => options.mode === 'filter' ? options.filterAction
  : options.mode === 'compare' ? options.compareAction ?? 'tags'
  : options.command === 'clean-list' ? options.listAction : options.command ? 'trash' : 'tags';

function selectedColors(input, required) {
  // Accept older desktop preferences that stored a single color.
  const values = input.colors === undefined ? [input.color ?? 'green'] : input.colors;
  if (!Array.isArray(values) || values.some(color => !colors.has(color))) throw appError('error.color');
  if (required && !values.length) throw appError('error.tagsRequired');
  return [...new Set(values)];
}

function choice(value, allowed, fallback) {
  const result = value ?? fallback;
  if (!allowed.includes(result)) throw appError('error.option', { value: result });
  return result;
}
function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw appError('error.boolean');
  return value;
}
function absolute(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)) {
    throw appError('error.path');
  }
  return value;
}
function extensionList(value = '') {
  if (typeof value !== 'string') throw appError('error.extensions');
  if (!value.trim()) return [];
  const values = value.split(',').map(v => v.trim().replace(/^\./, '').toLowerCase());
  if (values.some(v => !/^[a-z0-9]+$/.test(v))) throw appError('error.extensions');
  return [...new Set(values.map(v => `.${v}`))];
}

function filterSize(value, unit) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw appError('error.filterSize');
  const bytes = Number(value) * { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit];
  if (!Number.isFinite(bytes) || bytes > Number.MAX_SAFE_INTEGER) throw appError('error.filterSize');
  return bytes;
}
function filterDate(value, end = false) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw appError('error.filterDate');
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) throw appError('error.filterDate');
  // Inclusive local calendar dates, including days with a DST transition.
  if (end) date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function normalizeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw appError('error.config');
  const mode = choice(input.mode, ['orphans', 'tags', 'list', 'filter', 'compare'], 'orphans');
  const mixed = mode === 'orphans' && bool(input.mixed);
  const base = mode === 'orphans' || mode === 'tags' || mode === 'compare' ? absolute(input.base) : undefined;
  const targets = mixed ? [base] : input.targets;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 32) throw appError('error.targets');
  if (mode === 'compare' && targets.length !== 1) throw appError('error.singlePath');
  const recursive = bool(input.recursive, true);
  const options = { mode, base, targets: targets.map(p => absolute(p)), mixed, recursive,
    apply: false, permanent: false, allowEmpty: false, depth: Infinity, listLimit: 0 };
  if (recursive && input.depth !== undefined && input.depth !== '') {
    const depth = Number(input.depth);
    if (!/^\d+$/.test(String(input.depth)) || !Number.isSafeInteger(depth)) throw appError('error.depth');
    options.depth = depth;
  }
  if (mode === 'orphans') {
    const extensions = extensionList(input.referenceExt ?? 'NEF');
    if (extensions.length !== 1 || (input.referenceExt ?? '').includes(',')) throw appError('error.referenceExt');
    return { ...options, command: 'clean-orphans', referenceExt: extensions[0],
      matchBy: choice(input.matchBy, ['relative', 'name'], 'relative') };
  }
  if (mode === 'filter') {
    const unit = choice(input.sizeUnit, ['B', 'KB', 'MB', 'GB'], 'MB');
    const filters = validateFileFilters({
      nameContains: input.nameContains, nameExcludes: input.nameExcludes, nameRegex: input.nameRegex,
      ignoreCase: bool(input.ignoreCase, true), invert: bool(input.invertFilter),
      includeExt: extensionList(input.includeExt), excludeExt: extensionList(input.excludeExt),
      sizeMin: filterSize(input.sizeMin, unit), sizeMax: filterSize(input.sizeMax, unit),
      modifiedFrom: filterDate(input.modifiedFrom), modifiedBefore: filterDate(input.modifiedTo, true),
    });
    const filterAction = choice(input.filterAction, ['trash', 'tags'], 'trash');
    return { ...options, command: 'filter-files', filters, filterAction,
      ...(filterAction === 'tags' ? { colors: selectedColors(input, false), mergeTags: bool(input.mergeTags, true) } : {}) };
  }
  if (mode === 'compare') {
    const compareAction = choice(input.compareAction, ['tags', 'review'], 'tags');
    return { ...options, compareSelection: choice(input.compareSelection, ['common', 'unique', 'onlyA', 'onlyB'], 'common'),
      matchBy: choice(input.matchBy, ['name', 'relative', 'stem'], 'name'), ignoreCase: bool(input.ignoreCase),
      scope: choice(input.scope, ['base', 'targets', 'both'], 'both'),
      compareAction, ...(compareAction === 'tags' ? { colors: selectedColors(input, false), mergeTags: bool(input.mergeTags, true) } : {}) };
  }
  if (mode === 'list') {
    const source = choice(input.listSource, ['file', 'text'], 'file');
    if (source === 'text' && (typeof input.listText !== 'string' || Buffer.byteLength(input.listText) > 2 * 1024 * 1024)) {
      throw appError('error.listSize');
    }
    const listAction = choice(input.listAction, ['trash', 'tags'], 'trash');
    return { ...options, command: 'clean-list', desktopMode: 'list', listAction,
      ...(listAction === 'tags' ? { colors: selectedColors(input, false), mergeTags: bool(input.mergeTags, true) } : {}),
      mode: choice(input.listMode, ['keep', 'delete'], 'keep'), listSource: source,
      list: source === 'file' ? absolute(input.list) : undefined,
      listText: source === 'text' ? input.listText : undefined,
      matchBy: choice(input.matchBy, ['name', 'relative', 'stem'], 'name'),
      ignoreCase: bool(input.ignoreCase), includeExt: extensionList(input.includeExt), excludeExt: extensionList(input.excludeExt) };
  }
  const tagAction = choice(input.tagAction, ['sync', 'color', 'clear'], 'sync');
  return { ...options, tagAction, colors: selectedColors(input, tagAction === 'color'),
    scope: tagAction === 'sync' ? 'targets' : choice(input.scope, ['targets', 'base', 'both'], 'targets'),
    select: choice(input.select, ['matched', 'unmatched', 'all'], 'matched'),
    match: choice(input.match, ['any', 'all'], 'any'),
    mergeTags: bool(input.mergeTags, true), includeClear: bool(input.includeClear) };
}

async function mapLimited(items, fn, check, concurrency = 8) {
  const result = new Array(items.length);
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    try {
      while (!failure && next < items.length) {
        check();
        const index = next++;
        result[index] = await fn(items[index], index);
      }
    } catch (error) { failure ??= error; }
  }));
  if (failure) throw failure;
  check();
  return result;
}

// Owns non-serializable plans and snapshots. The renderer only receives row IDs and presentation data.
export class DesktopService {
  constructor({ readTags = getFinderTags, writeTags = setFinderTags, trash = moveToTrash,
    onProgress = () => {}, tempRoot = os.tmpdir() } = {}) {
    Object.assign(this, { readTags, writeTags, trash, onProgress, tempRoot });
    this.active = null;
    this.plans = new Map();
    this.activationVersion = 0;
    this.deactivateWhenIdle = false;
    this.discardAllWhenIdle = false;
    this.discardModesWhenIdle = new Set();
    this.busy = false;
    this.cancelled = false;
    this.history = [];
  }

  check() {
    if (this.cancelled) throw appError('error.cancelled');
  }
  progress(phase, detail, completed = 0, total = 0) {
    // UI notification failures must never turn a completed file operation into a failure.
    try { this.onProgress({ phase, detail, completed, total }); } catch { /* disconnected UI */ }
  }
  cancel() { this.cancelled = true; }
  clearHistory() {
    if (this.busy) throw appError('error.busy');
    this.history = [];
    return this.history;
  }
  async disposePlan(plan) {
    if (plan?.tempDirectory) await fs.rm(plan.tempDirectory, { recursive: true, force: true });
  }
  publicPlan(active) {
    const { options, rows, plan } = active;
    return {
      id: active.id, mode: options.desktopMode ?? options.mode, action: planAction(options), createdAt: active.createdAt,
      roots: options.targets, base: options.base, rows,
      conflicts: active.conflicts ?? [], warnings: active.warnings ?? [],
      total: rows.length, candidates: rows.filter(row => row.candidate).length,
      ...(rows.some(row => row.matched !== undefined) ? { matched: rows.filter(row => row.matched).length } : {}),
      requiresTags: active.requiresTags ?? false, listEntries: plan.listEntries,
    };
  }
  async clearPlans(protectedPlan) {
    const plans = [...new Set([...this.plans.values(), this.active].filter(Boolean))];
    this.plans.clear();
    for (const plan of plans) {
      // An independent tag operation shares its source plan's temporary list.
      if (plan !== protectedPlan && (!protectedPlan?.tempDirectory || plan.tempDirectory !== protectedPlan.tempDirectory)) await this.disposePlan(plan);
    }
  }
  async settled() {
    try {
      while (this.discardAllWhenIdle || this.discardModesWhenIdle.size) {
        if (this.discardAllWhenIdle) {
          this.discardAllWhenIdle = false;
          await this.clearPlans();
          this.active = null;
          this.discardModesWhenIdle.clear();
        } else {
          const mode = this.discardModesWhenIdle.values().next().value;
          this.discardModesWhenIdle.delete(mode);
          const plan = this.plans.get(mode);
          this.plans.delete(mode);
          if (this.active === plan) this.active = null;
          await this.disposePlan(plan);
        }
      }
      if (this.deactivateWhenIdle) this.active = null;
    } finally { this.deactivateWhenIdle = false; this.busy = false; }
  }
  async discard(mode) {
    if (mode !== undefined && !['orphans', 'tags', 'list', 'filter', 'compare'].includes(mode)) throw appError('error.option');
    this.activationVersion++;
    if (mode !== undefined) this.discardModesWhenIdle.add(mode);
    if (this.busy) { this.deactivateWhenIdle = true; this.cancel(); return; }
    this.active = null;
    if (mode !== undefined) { this.busy = true; await this.settled(); }
  }
  async discardAll() {
    this.activationVersion++;
    if (this.busy) { this.discardAllWhenIdle = true; this.cancel(); return; }
    this.busy = true;
    this.discardAllWhenIdle = true;
    await this.settled();
  }
  async activate(id) {
    if (this.busy) throw appError('error.busy');
    this.activationVersion++;
    const plan = [...this.plans.values()].find(plan => plan.id === id);
    this.active = plan ?? null;
    return plan ? this.publicPlan(plan) : null;
  }

  async preview(input) {
    if (this.busy) throw appError('error.busy');
    this.busy = true;
    this.cancelled = false;
    this.activationVersion++;
    let tempDirectory;
    this.active = null;
    try {
      const options = normalizeConfig(input);
      const mode = options.desktopMode ?? options.mode;
      const previous = this.plans.get(mode);
      this.plans.delete(mode);
      await this.disposePlan(previous);
      this.progress('scan', message('progress.folders'));
      options.targets = await Promise.all(options.targets.map(directoryRoot));
      if (options.mode === 'filter') options.targets = [...new Set(options.targets)];
      if (options.base) options.base = await directoryRoot(options.base);
      try { if (options.mode !== 'filter') assertSeparateRoots(options.mixed ? options.targets : [options.base, ...options.targets].filter(Boolean)); }
      catch (error) {
        const key = options.command === 'clean-orphans' ? 'error.overlapOrphans'
          : options.command === 'clean-list' ? 'error.overlapList' : options.mode === 'compare' ? 'error.overlapCompare' : 'error.overlapTags';
        throw Object.assign(appError(key), { raw: error.message });
      }
      this.check();
      if (options.listSource === 'text') {
        tempDirectory = await fs.mkdtemp(path.join(this.tempRoot, 'finder-selection-list-'));
        options.list = path.join(tempDirectory, 'selection.txt');
        await fs.writeFile(options.list, options.listText, { mode: 0o600 });
      }
      const prepared = options.mode === 'filter' ? await this.prepareFilter(options)
        : options.mode === 'compare' ? await this.prepareCompare(options)
        : options.command ? await this.prepareCleanup(options) : await this.prepareTags(options);
      this.check();
      const id = randomUUID();
      this.active = { ...prepared, requiresTags: prepared.requiresTags ?? false, id, options, tempDirectory, createdAt: new Date().toISOString() };
      this.plans.set(mode, this.active);
      return this.publicPlan(this.active);
    } catch (error) {
      await this.disposePlan({ tempDirectory });
      throw error;
    } finally { await this.settled(); }
  }

  async metadata(files) {
    let done = 0;
    this.progress('inspect', message('progress.metadata'), 0, files.length);
    return mapLimited(files, async file => {
      const snapshot = await snapshotFile(file);
      const stat = await fs.lstat(file, { bigint: true });
      done++;
      if (done % 32 === 0 || done === files.length) this.progress('inspect', message('progress.metadata'), done, files.length);
      return { snapshot, links: stat.nlink, size: Number(snapshot.size) };
    }, () => this.check());
  }

  async prepareCleanup(options) {
    this.progress('scan', message('progress.cleanup'));
    const plan = await prepareCleanup(options, { check: () => this.check() });
    this.check();
    const inventories = new Map(plan.inventories.map(i => [i.root, i]));
    const targetFiles = options.targets.flatMap(root => inventories.get(root).files.map(file => ({ file, root })));
    const metadata = await this.metadata(targetFiles.map(item => item.file));
    const candidates = new Set(plan.filesToUpdate);
    const protectedIds = new Set(plan.protectedSnapshots.map(s => `${s.dev}:${s.ino}`));
    const referenceIndex = new Map();
    if (options.command === 'clean-orphans') {
      for (const file of plan.referenceFiles) {
        const key = photoKey(file, options.base, options.matchBy);
        if (!referenceIndex.has(key)) referenceIndex.set(key, []);
        referenceIndex.get(key).push(file);
      }
    }
    let keys;
    if (options.command === 'clean-list') {
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(options.list));
      keys = parseList(content, options);
      for (const snapshot of plan.liveSnapshots) { this.check(); await verifySnapshot(snapshot); }
    }
    const rows = targetFiles.map(({ file, root }, i) => {
      const { snapshot, size } = metadata[i];
      const ext = path.extname(file).toLowerCase();
      const protectedFile = protectedIds.has(`${snapshot.dev}:${snapshot.ino}`);
      const candidate = candidates.has(file);
      let matches = [], reason;
      if (options.command === 'clean-orphans') {
        matches = referenceIndex.get(photoKey(file, root, options.matchBy)) ?? [];
        reason = protectedFile ? message('reason.referenceProtected')
          : ext.length < 2 ? message('reason.extensionless')
          : matches.length ? message('reason.referenceMatch', { files: matches.map(p => path.relative(options.base, p)).slice(0, 3).join(', ') })
          : message(options.matchBy === 'relative' ? 'reason.noRelativeReference' : 'reason.noReference', { extension: options.referenceExt.toUpperCase() });
      } else {
        const key = options.matchBy === 'relative' ? path.relative(root, file)
          : options.matchBy === 'stem' ? path.parse(file).name : path.basename(file);
        const matched = keys.has(normalize(key, options.ignoreCase));
        reason = message(protectedFile ? 'reason.listProtected'
          : options.excludeExt.includes(ext) ? 'reason.excludedExt'
          : options.includeExt.length && !options.includeExt.includes(ext) ? 'reason.notIncludedExt'
          : options.listAction === 'tags' ? matched ? 'list.reasonListed' : 'list.reasonUnlisted'
          : `reason.list${options.mode === 'keep' ? 'Keep' : 'Delete'}${matched ? 'Hit' : 'Miss'}`);
      }
      return { id: `row-${i}`, file, name: path.basename(file), relative: path.relative(root, file), root,
        size, candidate, action: candidate ? 'trash' : 'keep', reason, matches };
    });
    if (options.listAction === 'tags') return this.prepareSelectedTags(rows.map(row => ({ ...row, matched: row.candidate })), options, plan, metadata);
    // Keep snapshots for every displayed file: a separate tag action may target
    // rows protected from cleanup by the filename list or extension filters.
    const previewSnapshots = metadata.map(item => item.snapshot);
    const tags = options.command === 'clean-list' ? await this.tagValues(targetFiles.map(item => item.file), previewSnapshots) : null;
    return { plan: { ...plan, previewSnapshots }, rows: tags ? rows.map(row => ({ ...row, currentTags: tags.get(row.file) })) : rows };
  }

  async prepareFilter(options) {
    const inventories = [];
    const files = new Map();
    for (const root of options.targets) {
      this.check();
      const group = await getFiles(root, options.recursive, options.depth, () => this.check());
      inventories.push({ root, files: group, recursive: options.recursive, depth: options.depth });
      // Parent/child folder selections form a union, with each physical path once.
      for (const file of group) if (!files.has(file)) files.set(file, root);
    }
    const paths = [...files.keys()], metadata = await this.metadata(paths);
    const entries = paths.map((file, i) => ({ file, size: metadata[i].size, modifiedMs: Number(metadata[i].snapshot.mtime) / 1e6 }));
    const matched = await filterFiles(entries, options.filters, { shouldCancel: () => this.cancelled });
    const candidates = new Set(matched.map(entry => entry.file));
    const snapshots = metadata.map(item => item.snapshot);
    const rows = entries.map((entry, i) => {
      const root = files.get(entry.file), matchesFilter = candidates.has(entry.file);
      return { id: `row-${i}`, ...entry, name: path.basename(entry.file), relative: path.relative(root, entry.file), root,
        matched: matchesFilter, candidate: matchesFilter, action: matchesFilter ? 'trash' : 'keep', matches: [],
        reason: message(!matchesFilter ? 'filter.reasonUnmatched' : options.filters.invert ? 'filter.reasonInverted' : 'filter.reasonMatched') };
    });
    const plan = { filesToUpdate: matched.map(entry => entry.file), inventories, snapshots, protectedSnapshots: [], liveSnapshots: [] };
    return options.filterAction === 'tags' ? this.prepareSelectedTags(rows, options, plan, metadata) : { rows, plan };
  }

  async prepareCompare(options) {
    const inventories = [];
    for (const root of [options.base, ...options.targets]) {
      this.check();
      const files = await getFiles(root, options.recursive, options.depth, () => this.check());
      inventories.push({ root, files, recursive: options.recursive, depth: options.depth });
    }
    const entries = compareFolderFiles(inventories[0].files, inventories[1].files, {
      rootA: options.base, rootB: options.targets[0], matchBy: options.matchBy, ignoreCase: options.ignoreCase, matchesLimit: 2,
    });
    const metadata = await this.metadata(entries.map(entry => entry.file));
    const rows = entries.map((entry, i) => {
      const inScope = ['onlyA', 'onlyB'].includes(options.compareSelection) || options.scope === 'both' || (options.scope === 'base' ? entry.side === 'a' : entry.side === 'b');
      const matched = inScope && (options.compareSelection === 'unique' ? entry.group !== 'common' : entry.group === options.compareSelection);
      return { ...entry, id: `row-${i}`, name: path.basename(entry.file), relative: path.relative(entry.root, entry.file),
        size: metadata[i].size, matched, candidate: matched, action: 'keep', reason: message(`compare.${entry.group}`) };
    });
    if (options.compareAction === 'review') {
      return { rows, plan: { inventories, snapshots: metadata.map(item => item.snapshot), liveSnapshots: [] } };
    }
    return this.prepareSelectedTags(rows, options, { inventories, snapshots: [], liveSnapshots: [] }, metadata);
  }

  async prepareSelectedTags(rows, options, plan, metadata) {
    const snapshots = [...plan.snapshots, ...metadata.map(item => item.snapshot)];
    const tags = await this.tagValues(rows.map(row => row.file), snapshots);
    const desired = options.colors.map(finderColorAsTag), requiresTags = !options.clearTags && !desired.length;
    const operations = [], hardLinks = new Set();
    const taggedRows = rows.map((row, i) => {
      const currentTags = tags.get(row.file);
      const hardLink = row.candidate && metadata[i].links > 1n;
      if (hardLink) hardLinks.add(row.file);
      const nextTags = !row.candidate || requiresTags ? currentTags : options.clearTags ? [] : options.mergeTags ? [...new Set([...currentTags, ...desired])] : desired;
      const changed = tagSignature(currentTags) !== tagSignature(nextTags);
      const candidate = row.candidate && !hardLink && (requiresTags || changed);
      if (candidate && changed) operations.push({ file: row.file, currentTags, tags: nextTags });
      return { ...row, currentTags, nextTags, candidate, action: candidate && changed ? 'tags' : 'keep',
        reason: hardLink ? message('reason.hardLink') : row.reason };
    });
    return { rows: taggedRows, requiresTags, warnings: hardLinks.size ? [message('warning.hardLinks', { count: hardLinks.size })] : [],
      plan: { ...plan, snapshots, operations } };
  }

  async tagValues(files, snapshots) {
    let done = 0;
    this.progress('tags', message('progress.readTags'), 0, files.length);
    const values = await mapLimited(files, async file => {
      const tags = await this.readTags(file);
      done++;
      if (done % 8 === 0 || done === files.length) this.progress('tags', message('progress.readTags'), done, files.length);
      return tags;
    }, () => this.check());
    // Ensure the file versions shown in the preview are the versions whose tags were read.
    await mapLimited(snapshots, s => verifySnapshot(s), () => this.check());
    return new Map(files.map((file, i) => [file, values[i]]));
  }

  async prepareTags(options) {
    this.progress('scan', message('progress.scanTags'));
    const roots = [options.base, ...options.targets];
    const groups = await mapLimited(roots, root => getFiles(root, options.recursive, options.depth, () => this.check()), () => this.check());
    const [baseFiles, ...targetGroups] = groups;
    const files = groups.flat();
    const metadata = await this.metadata(files);
    const meta = new Map(files.map((file, i) => [file, metadata[i]]));
    const snapshots = metadata.map(item => item.snapshot);
    const tags = await this.tagValues(files, snapshots);
    let operations, conflicts = [];
    if (options.tagAction === 'sync') {
      const sync = await createTagSyncPlan(baseFiles, targetGroups, { ...options, readTags: async file => tags.get(file) });
      operations = sync.operations;
      conflicts = sync.conflicts;
    } else {
      const selected = createPlan(baseFiles, targetGroups, options).filesToUpdate;
      const desired = options.tagAction === 'clear' ? [] : options.colors.map(finderColorAsTag);
      operations = selected.filter(file => tagSignature(tags.get(file)) !== tagSignature(desired))
        .map(file => ({ file, currentTags: tags.get(file), tags: desired }));
    }
    const warnings = [];
    const hardLinks = new Set(operations.filter(op => meta.get(op.file).links > 1n).map(op => op.file));
    if (hardLinks.size) warnings.push(message('warning.hardLinks', { count: hardLinks.size }));
    operations = operations.filter(op => !hardLinks.has(op.file));
    const operationMap = new Map(operations.map(op => [op.file, op]));
    const baseIndex = new Map();
    for (const file of baseFiles) {
      const key = getMatchKey(file);
      if (!baseIndex.has(key)) baseIndex.set(key, []);
      baseIndex.get(key).push(file);
    }
    const displayGroups = options.scope === 'targets' ? targetGroups : options.scope === 'base' ? [baseFiles] : groups;
    const displayRoots = options.scope === 'targets' ? options.targets : options.scope === 'base' ? [options.base] : roots;
    let rowNumber = 0;
    const rows = displayGroups.flatMap((group, i) => group.map(file => {
      const operation = operationMap.get(file);
      const matches = file.startsWith(`${options.base}${path.sep}`)
        ? []
        : baseIndex.get(getMatchKey(file)) ?? [];
      const reason = message(hardLinks.has(file) ? 'reason.hardLink'
        : conflicts.length ? 'reason.conflict'
        : operation ? options.tagAction === 'sync'
          ? options.mergeTags ? 'reason.mergeTags' : 'reason.replaceTags'
          : options.tagAction === 'clear' ? 'reason.clearTags' : 'reason.colorTags'
        : 'reason.unchanged');
      return { id: `row-${rowNumber++}`, file, name: path.basename(file), relative: path.relative(displayRoots[i], file),
        root: displayRoots[i], size: meta.get(file).size, candidate: Boolean(operation) && !conflicts.length,
        action: operation && !conflicts.length ? 'tags' : 'keep', reason, matches,
        currentTags: tags.get(file), nextTags: operation?.tags ?? tags.get(file) };
    }));
    return { rows, conflicts, warnings, plan: { operations, snapshots, baseIndex,
      inventories: roots.map((root, i) => ({ root, files: groups[i], recursive: options.recursive, depth: options.depth })) } };
  }

  selection(id, selectedIds, allowKept = false) {
    if (!this.active || this.active.id !== id) throw appError('error.expired');
    if (this.active.conflicts?.length) throw appError('error.conflict');
    if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) {
      throw appError('error.selection');
    }
    const rows = new Map(this.active.rows.map(row => [row.id, row]));
    const selected = selectedIds.map(id => rows.get(id));
    if (selected.some(row => !row || !allowKept && !row.candidate)) throw appError('error.notCandidate');
    return selected;
  }

  tagSelection(id, selectedIds) {
    const selected = this.selection(id, selectedIds, true);
    const mode = this.active.options.desktopMode ?? this.active.options.mode;
    if (!['list', 'filter', 'compare'].includes(mode)) throw appError('error.option');
    if (mode !== 'list' && selected.some(row => !row.matched)) throw appError('error.notCandidate');
    return selected;
  }

  async selectedTags(id, selectedIds) {
    if (this.busy) throw appError('error.busy');
    const selected = this.tagSelection(id, selectedIds);
    const original = this.active;
    this.busy = true;
    this.cancelled = false;
    try {
      // Opening the tag dialog only reads checked files. Keep the original
      // directory scan and validate its selected snapshots instead of rescanning.
      const snapshots = new Map([...original.plan.snapshots, ...(original.plan.previewSnapshots ?? [])].map(snapshot => [snapshot.file, snapshot]));
      const selectedSnapshots = selected.map(row => snapshots.get(row.file));
      if (selectedSnapshots.some(snapshot => !snapshot)) throw appError('error.expired');
      const links = await mapLimited(selectedSnapshots, async snapshot => {
        await verifySnapshot(snapshot);
        return (await fs.lstat(snapshot.file, { bigint: true })).nlink;
      }, () => this.check());
      const hardLinks = links.filter(count => count > 1n).length;
      if (hardLinks) throw appError('selection.hardLinks', { count: hardLinks });
      const tags = await this.tagValues(selected.map(row => row.file), selectedSnapshots);
      this.check();
      // Cache the exact values displayed in the dialog without rewriting the
      // cleanup/review plan. Submission rejects later changes to these tags.
      original.selectionTagValues ??= new Map();
      const rows = selected.map(row => ({ ...row, currentTags: [...tags.get(row.file)] }));
      for (const row of rows) original.selectionTagValues.set(row.id, [...row.currentTags]);
      return rows;
    } finally { await this.settled(); }
  }

  async tagSelected(id, selectedIds, input, { confirm = async () => true } = {}) {
    if (this.busy) throw appError('error.busy');
    const selected = this.tagSelection(id, selectedIds);
    const original = this.active;
    const activationVersion = this.activationVersion;
    const mode = original.options.desktopMode ?? original.options.mode;
    if (!input || typeof input !== 'object' || !Array.isArray(input.colors)) throw appError('error.config');
    const clearTags = bool(input.clearTags);
    const action = mode === 'filter' ? { filterAction: 'tags' } : mode === 'compare' ? { compareAction: 'tags' } : { listAction: 'tags' };
    const options = { ...original.options, ...action, clearTags, colors: selectedColors(input, !clearTags), mergeTags: bool(input.mergeTags, true) };
    this.busy = true;
    this.cancelled = false;
    let executing = false;
    try {
      this.progress('verify', message('progress.verify'), 0, selected.length);
      for (const inventory of original.plan.inventories) await verifyInventory(inventory, () => this.check());
      for (const snapshot of [...original.plan.snapshots, ...(original.plan.previewSnapshots ?? [])]) { this.check(); await verifySnapshot(snapshot); }
      const metadata = await this.metadata(selected.map(row => row.file));
      const prepared = await this.prepareSelectedTags(selected.map(row => ({ ...row, candidate: true })), options,
        { inventories: original.plan.inventories, snapshots: [], liveSnapshots: [] }, metadata);
      this.check();
      if (prepared.rows.some((row, i) => {
        const shownTags = original.selectionTagValues?.get(selected[i].id) ?? selected[i].currentTags;
        return shownTags !== undefined && tagSignature(row.currentTags) !== tagSignature(shownTags);
      })) throw appError('error.stale');
      // Never silently omit a checked hard link while claiming all files were tagged.
      if (prepared.warnings.length) throw appError('selection.hardLinks', { count: metadata.filter(item => item.links > 1n).length });
      const changed = prepared.rows.filter(row => row.candidate).map(row => row.id);
      if (!changed.length) return { unchanged: true };
      this.active = { ...prepared, id: randomUUID(), options, tempDirectory: original.tempDirectory };
      this.busy = false;
      executing = true;
      const result = await this.execute(this.active.id, changed, { confirm });
      if ('declined' in result && this.activationVersion === activationVersion) this.active = original;
      return result;
    } catch (error) {
      if (this.active && this.activationVersion === activationVersion) this.active = original;
      throw error;
    } finally { if (!executing) await this.settled(); }
  }

  async execute(id, selectedIds, { confirm = async () => true } = {}) {
    if (this.busy) throw appError('error.busy');
    const selected = this.selection(id, selectedIds);
    if (planAction(this.active.options) === 'review') throw appError('error.option');
    if (this.active.requiresTags) throw appError('selection.chooseTagsHint');
    this.busy = true;
    this.cancelled = false;
    const active = this.active;
    let consumed = false;
    try {
      this.progress('confirm', message('progress.confirm'), 0, selected.length);
      const accepted = await confirm({ count: selected.length, action: planAction(active.options),
        roots: [...new Set(selected.map(r => r.root))], files: selected.map(r => r.file) });
      if (!accepted || this.cancelled) return { declined: true };
      this.active = null;
      consumed = true;
      await this.clearPlans(active);
      const startedAt = new Date().toISOString();
      const records = selected.map(row => ({ file: row.file, name: row.name, action: row.action, status: 'pending',
        ...(row.action === 'tags' ? { beforeTags: row.currentTags, afterTags: row.nextTags } : {}) }));
      const recordMap = new Map(records.map(r => [r.file, r]));
      let completed = 0, cancelled = false;
      this.progress('verify', message('progress.verify'), 0, selected.length);
      try {
        if (planAction(active.options) === 'trash') {
          const plan = { ...active.plan, filesToUpdate: selected.map(r => r.file) };
          const result = await executeCleanup(plan, { apply: true, permanent: false }, {
            shouldCancel: () => this.cancelled,
            trash: async file => {
              await this.trash(file);
              recordMap.get(file).status = 'completed';
              this.progress('execute', message('progress.file', { file: path.basename(file) }), ++completed, selected.length);
            },
          });
          cancelled = Boolean(result.cancelled);
          for (const failure of result.failures) Object.assign(recordMap.get(failure.file), { status: 'failed', error: describeError(failure.error) });
        } else {
          for (const inventory of active.plan.inventories) await verifyInventory(inventory, () => this.check());
          for (const snapshot of active.plan.snapshots) { this.check(); await verifySnapshot(snapshot); }
          const snapshots = new Map(active.plan.snapshots.map(s => [s.file, s]));
          const operations = new Map(active.plan.operations.map(op => [op.file, op]));
          for (const row of selected) {
            if (this.cancelled) { cancelled = true; break; }
            const record = recordMap.get(row.file);
            try {
              const op = operations.get(row.file);
              const references = [...(active.plan.liveSnapshots ?? []), ...(active.options.tagAction === 'sync'
                ? (active.plan.baseIndex.get(getMatchKey(row.file)) ?? []).map(file => snapshots.get(file)) : [])];
              for (const snapshot of references) await verifySnapshot(snapshot);
              await verifySnapshot(snapshots.get(row.file));
              if (tagSignature(await this.readTags(row.file)) !== tagSignature(op.currentTags)) throw appError('error.stale');
              if (this.cancelled) { cancelled = true; break; }
              // Reading tags may await several native metadata subprocesses.
              // Check the referenced and target file versions again after that
              // interval, before handing the path to the tag writer.
              for (const snapshot of references) await verifySnapshot(snapshot);
              await verifySnapshot(snapshots.get(row.file));
              if (this.cancelled) { cancelled = true; break; }
              await this.writeTags(row.file, op.tags);
              record.status = 'completed';
              this.progress('execute', message('progress.file', { file: row.name }), ++completed, selected.length);
            } catch (error) {
              Object.assign(record, { status: 'failed', error: describeError(error) });
              break;
            }
          }
        }
      } catch (error) {
        if (error?.key === 'error.cancelled') cancelled = true;
        else {
          // Whole-plan validation failed before any operation; retain an explicit run-level error.
          for (const record of records) if (record.status === 'pending') record.error = describeError(error);
        }
      }
      const failure = records.find(r => r.status === 'failed' || r.error);
      const result = { id: randomUUID(), mode: active.options.desktopMode ?? active.options.mode,
        action: planAction(active.options), startedAt, finishedAt: new Date().toISOString(),
        completed, failed: records.filter(r => r.status === 'failed').length,
        unattempted: records.filter(r => r.status === 'pending').length, cancelled,
        error: failure?.error ?? null, records };
      this.history.unshift(result);
      this.history = this.history.slice(0, 20);
      return result;
    } finally {
      if (consumed) await this.disposePlan(active).catch(() => {});
      await this.settled();
    }
  }
}
