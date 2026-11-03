import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { appError, describeError, message } from './messages.js';
import {
  createPlan, createTagSyncPlan, finderColorAsTag, getFinderTags, getMatchKey, setFinderTags,
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

export function normalizeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw appError('error.config');
  const mode = choice(input.mode, ['orphans', 'tags', 'list'], 'orphans');
  const mixed = mode === 'orphans' && bool(input.mixed);
  const base = mode !== 'list' ? absolute(input.base) : undefined;
  const targets = mixed ? [base] : input.targets;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 32) throw appError('error.targets');
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
  if (mode === 'list') {
    const source = choice(input.listSource, ['file', 'text'], 'file');
    if (source === 'text' && (typeof input.listText !== 'string' || Buffer.byteLength(input.listText) > 2 * 1024 * 1024)) {
      throw appError('error.listSize');
    }
    return { ...options, command: 'clean-list', desktopMode: 'list',
      mode: choice(input.listMode, ['keep', 'delete'], 'keep'), listSource: source,
      list: source === 'file' ? absolute(input.list) : undefined,
      listText: source === 'text' ? input.listText : undefined,
      matchBy: choice(input.matchBy, ['name', 'relative', 'stem'], 'name'),
      ignoreCase: bool(input.ignoreCase), includeExt: extensionList(input.includeExt), excludeExt: extensionList(input.excludeExt) };
  }
  const tagAction = choice(input.tagAction, ['sync', 'color', 'clear'], 'sync');
  // Accept older desktop preferences that stored a single color.
  const selectedColors = input.colors === undefined ? [input.color ?? 'green'] : input.colors;
  if (!Array.isArray(selectedColors) || selectedColors.some(color => !colors.has(color))) throw appError('error.color');
  if (tagAction === 'color' && !selectedColors.length) throw appError('error.tagsRequired');
  return { ...options, tagAction, colors: [...new Set(selectedColors)],
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
  async discard() {
    if (this.busy) { this.cancel(); return; }
    const old = this.active;
    this.active = null;
    await this.disposePlan(old);
  }

  async preview(input) {
    if (this.busy) throw appError('error.busy');
    this.busy = true;
    this.cancelled = false;
    let tempDirectory;
    const previous = this.active;
    this.active = null;
    try {
      await this.disposePlan(previous);
      const options = normalizeConfig(input);
      this.progress('scan', message('progress.folders'));
      options.targets = await Promise.all(options.targets.map(directoryRoot));
      if (options.base) options.base = await directoryRoot(options.base);
      try { assertSeparateRoots(options.mixed ? options.targets : [options.base, ...options.targets].filter(Boolean)); }
      catch (error) {
        const key = options.command === 'clean-orphans' ? 'error.overlapOrphans'
          : options.command === 'clean-list' ? 'error.overlapList' : 'error.overlapTags';
        throw Object.assign(appError(key), { raw: error.message });
      }
      this.check();
      if (options.listSource === 'text') {
        tempDirectory = await fs.mkdtemp(path.join(this.tempRoot, 'finder-selection-list-'));
        options.list = path.join(tempDirectory, 'selection.txt');
        await fs.writeFile(options.list, options.listText, { mode: 0o600 });
      }
      const prepared = options.command ? await this.prepareCleanup(options) : await this.prepareTags(options);
      this.check();
      const id = randomUUID();
      this.active = { ...prepared, id, options, tempDirectory };
      return {
        id, mode: options.desktopMode ?? options.mode, createdAt: new Date().toISOString(),
        roots: options.targets, base: options.base, rows: prepared.rows,
        conflicts: prepared.conflicts ?? [], warnings: prepared.warnings ?? [],
        total: prepared.rows.length, candidates: prepared.rows.filter(r => r.candidate).length,
        listEntries: prepared.plan.listEntries,
      };
    } catch (error) {
      await this.disposePlan({ tempDirectory });
      throw error;
    } finally { this.busy = false; }
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
    const plan = await prepareCleanup(options);
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
      for (const snapshot of plan.liveSnapshots) await verifySnapshot(snapshot);
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
          : `reason.list${options.mode === 'keep' ? 'Keep' : 'Delete'}${matched ? 'Hit' : 'Miss'}`);
      }
      return { id: `row-${i}`, file, name: path.basename(file), relative: path.relative(root, file), root,
        size, candidate, action: candidate ? 'trash' : 'keep', reason, matches };
    });
    return { plan, rows };
  }

  async prepareTags(options) {
    this.progress('scan', message('progress.scanTags'));
    const roots = [options.base, ...options.targets];
    const groups = await Promise.all(roots.map(root => getFiles(root, options.recursive, options.depth)));
    const [baseFiles, ...targetGroups] = groups;
    const files = groups.flat();
    const metadata = await this.metadata(files);
    const meta = new Map(files.map((file, i) => [file, metadata[i]]));
    const snapshots = metadata.map(item => item.snapshot);
    let done = 0;
    this.progress('tags', message('progress.readTags'), 0, files.length);
    const values = await mapLimited(files, async file => {
      const tags = await this.readTags(file);
      done++;
      if (done % 8 === 0 || done === files.length) this.progress('tags', message('progress.readTags'), done, files.length);
      return tags;
    }, () => this.check());
    const tags = new Map(files.map((file, i) => [file, values[i]]));
    // Ensure the file versions shown in the preview are the versions whose tags were read.
    await mapLimited(snapshots, s => verifySnapshot(s), () => this.check());
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

  selection(id, selectedIds) {
    if (!this.active || this.active.id !== id) throw appError('error.expired');
    if (this.active.conflicts?.length) throw appError('error.conflict');
    if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) {
      throw appError('error.selection');
    }
    const rows = new Map(this.active.rows.map(row => [row.id, row]));
    const selected = selectedIds.map(id => rows.get(id));
    if (selected.some(row => !row?.candidate)) throw appError('error.notCandidate');
    return selected;
  }

  async execute(id, selectedIds, { confirm = async () => true } = {}) {
    if (this.busy) throw appError('error.busy');
    const selected = this.selection(id, selectedIds);
    this.busy = true;
    this.cancelled = false;
    const active = this.active;
    let consumed = false;
    try {
      const accepted = await confirm({ count: selected.length, action: active.options.command ? 'trash' : 'tags',
        roots: [...new Set(selected.map(r => r.root))], files: selected.map(r => r.file) });
      if (!accepted || this.cancelled) return { declined: true };
      this.active = null;
      consumed = true;
      const startedAt = new Date().toISOString();
      const records = selected.map(row => ({ file: row.file, name: row.name, action: row.action, status: 'pending',
        ...(row.action === 'tags' ? { beforeTags: row.currentTags, afterTags: row.nextTags } : {}) }));
      const recordMap = new Map(records.map(r => [r.file, r]));
      let completed = 0, cancelled = false;
      this.progress('verify', message('progress.verify'), 0, selected.length);
      try {
        if (active.options.command) {
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
          for (const inventory of active.plan.inventories) await verifyInventory(inventory);
          for (const snapshot of active.plan.snapshots) await verifySnapshot(snapshot);
          const snapshots = new Map(active.plan.snapshots.map(s => [s.file, s]));
          const operations = new Map(active.plan.operations.map(op => [op.file, op]));
          for (const row of selected) {
            if (this.cancelled) { cancelled = true; break; }
            const record = recordMap.get(row.file);
            try {
              const op = operations.get(row.file);
              if (active.options.tagAction === 'sync') {
                for (const file of active.plan.baseIndex.get(getMatchKey(row.file)) ?? []) await verifySnapshot(snapshots.get(file));
              }
              await verifySnapshot(snapshots.get(row.file));
              if (tagSignature(await this.readTags(row.file)) !== tagSignature(op.currentTags)) throw appError('error.stale');
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
        // Whole-plan validation failed before any operation; retain an explicit run-level error.
        for (const record of records) if (record.status === 'pending') record.error = describeError(error);
      }
      const failure = records.find(r => r.status === 'failed' || r.error);
      const result = { id: randomUUID(), mode: active.options.desktopMode ?? active.options.mode,
        action: active.options.command ? 'trash' : 'tags', startedAt, finishedAt: new Date().toISOString(),
        completed, failed: records.filter(r => r.status === 'failed').length,
        unattempted: records.filter(r => r.status === 'pending').length, cancelled,
        error: failure?.error ?? null, records };
      this.history.unshift(result);
      this.history = this.history.slice(0, 20);
      return result;
    } finally {
      this.busy = false;
      if (consumed) await this.disposePlan(active).catch(() => {});
    }
  }
}
