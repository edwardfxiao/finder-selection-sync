import path from 'node:path';

// Compare names/relative paths, not file contents. Keep every duplicate match on
// both sides so callers can select individual files without losing information.
export function compareFolderFiles(filesA, filesB, { rootA, rootB, matchBy = 'name', ignoreCase = false, matchesLimit = Infinity } = {}) {
  if (!['name', 'relative', 'stem'].includes(matchBy)) throw new Error('Invalid comparison matching mode');
  if (typeof ignoreCase !== 'boolean') throw new Error('Comparison ignoreCase must be a boolean');
  if (matchesLimit !== Infinity && (!Number.isSafeInteger(matchesLimit) || matchesLimit < 0)) throw new Error('Invalid comparison matches limit');
  const roots = [rootA, rootB], groups = [filesA, filesB];
  const indexes = groups.map((files, side) => {
    const root = roots[side];
    if (typeof root !== 'string' || !path.isAbsolute(root) || !Array.isArray(files)) throw new Error('Comparison requires absolute roots and file arrays');
    const entries = new Map();
    for (const file of new Set(files)) {
      if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) throw new Error('Invalid comparison file path');
      const relative = path.relative(root, file);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Comparison file is outside its root');
      let key = (matchBy === 'relative' ? relative : matchBy === 'stem' ? path.parse(file).name : path.basename(file)).normalize('NFC');
      if (ignoreCase) key = key.toLocaleLowerCase('en-US');
      const matches = entries.get(key) ?? [];
      matches.push(file); entries.set(key, matches);
    }
    return entries;
  });
  return indexes.flatMap((index, side) => [...index].flatMap(([key, files]) => {
    const matches = indexes[1 - side].get(key) ?? [];
    return files.map(file => ({ file, root: roots[side], side: side ? 'b' : 'a',
      group: matches.length ? 'common' : side ? 'onlyB' : 'onlyA', matches: matches.slice(0, matchesLimit) }));
  }));
}
