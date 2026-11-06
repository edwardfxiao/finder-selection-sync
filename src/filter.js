import path from 'node:path';
import { Script } from 'node:vm';
import { setImmediate } from 'node:timers/promises';

function invalid(code, message) {
  return Object.assign(new Error(message), { code });
}

// Pure criteria shared by desktop callers; no file operations or UI dependencies.
export function validateFileFilters(input = {}) {
  const result = {};
  for (const key of ['nameContains', 'nameExcludes', 'nameRegex']) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > 1024 || value.includes('\0')) {
      throw invalid('FILTER_TEXT', 'Filename filters must be text of at most 1024 characters, without NUL.');
    }
    result[key] = value.normalize('NFC');
  }
  for (const key of ['ignoreCase', 'invert']) {
    const value = input[key] ?? (key === 'ignoreCase');
    if (typeof value !== 'boolean') throw invalid('FILTER_OPTION', 'Filter flags must be boolean.');
    result[key] = value;
  }
  for (const key of ['includeExt', 'excludeExt']) {
    const value = input[key] ?? [];
    if (!Array.isArray(value) || value.some(ext => typeof ext !== 'string' || !/^\.?[a-z0-9]+$/i.test(ext))) {
      throw invalid('FILTER_EXTENSIONS', 'Extensions must be an array of file extensions.');
    }
    result[key] = [...new Set(value.map(ext => `.${ext.replace(/^\./, '').toLowerCase()}`))];
  }
  for (const key of ['sizeMin', 'sizeMax', 'modifiedFrom', 'modifiedBefore']) {
    const value = input[key];
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value)
      || Math.abs(value) > Number.MAX_SAFE_INTEGER || (key.startsWith('size') && value < 0))) {
      throw invalid(key.startsWith('size') ? 'FILTER_SIZE' : 'FILTER_DATE', 'Invalid filter range.');
    }
    result[key] = value ?? null;
  }
  if (result.sizeMin != null && result.sizeMax != null && result.sizeMin > result.sizeMax) {
    throw invalid('FILTER_SIZE', 'Minimum file size must not exceed maximum file size.');
  }
  if (result.modifiedFrom != null && result.modifiedBefore != null && result.modifiedFrom >= result.modifiedBefore) {
    throw invalid('FILTER_DATE', 'The modification date range is reversed or empty.');
  }
  if (result.nameRegex) {
    try { new RegExp(result.nameRegex, result.ignoreCase ? 'iu' : 'u'); }
    catch { throw invalid('FILTER_REGEX', 'Invalid filename regular expression.'); }
  }
  return result;
}

const regexBatch = new Script(`(() => {
  const expression = new RegExp(pattern, flags);
  return names.map(name => expression.test(name));
})()`);

// Entries contain { file, size, modifiedMs }. All non-empty criteria are ANDed;
// inversion complements the complete predicate within the scanned file set.
export async function filterFiles(entries, input = {}, { shouldCancel = () => false } = {}) {
  const options = validateFileFilters(input);
  const normalize = value => options.ignoreCase ? value.normalize('NFC').toLocaleLowerCase('en-US') : value.normalize('NFC');
  const contains = normalize(options.nameContains), excludes = normalize(options.nameExcludes);
  const result = [];
  for (let offset = 0; offset < entries.length; offset += 256) {
    await setImmediate();
    if (shouldCancel()) throw invalid('FILTER_CANCELLED', 'Filtering cancelled.');
    const batch = entries.slice(offset, offset + 256);
    let regexMatches;
    if (options.nameRegex) {
      try {
        // Only this fixed script executes. The pattern is data, never source code.
        // A pathological expression cannot block the app indefinitely.
        regexMatches = regexBatch.runInNewContext({
          names: batch.map(entry => path.basename(entry.file).normalize('NFC')),
          pattern: options.nameRegex, flags: options.ignoreCase ? 'iu' : 'u',
        }, { timeout: 100 });
      } catch (error) {
        if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw invalid('FILTER_REGEX_TIMEOUT', 'The filename regular expression took too long. Simplify it.');
        throw error;
      }
    }
    for (let i = 0; i < batch.length; i++) {
      const entry = batch[i], name = normalize(path.basename(entry.file)), ext = path.extname(entry.file).toLowerCase();
      const matches = (!contains || name.includes(contains)) && (!excludes || !name.includes(excludes))
        && (!regexMatches || regexMatches[i])
        && (!options.includeExt.length || options.includeExt.includes(ext)) && !options.excludeExt.includes(ext)
        && (options.sizeMin == null || entry.size >= options.sizeMin) && (options.sizeMax == null || entry.size <= options.sizeMax)
        && (options.modifiedFrom == null || entry.modifiedMs >= options.modifiedFrom)
        && (options.modifiedBefore == null || entry.modifiedMs < options.modifiedBefore);
      if (options.invert ? !matches : matches) result.push(entry);
    }
  }
  if (shouldCancel()) throw invalid('FILTER_CANCELLED', 'Filtering cancelled.');
  return result;
}
