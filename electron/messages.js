export const message = (key, params = {}) => ({ key, params });
export function appError(key, params = {}) {
  return Object.assign(new Error(key), { key, params });
}
export function describeError(error) {
  if (error?.key) return { key: error.key, params: error.params ?? {}, raw: error.raw ?? error.message ?? error.key };
  const raw = error?.message || String(error);
  const rules = [
    [/Empty photo reference/, 'error.emptyReference'], [/Empty list/, 'error.emptyList'],
    [/folders overlap/i, 'error.overlap'],
    [/changed since planning|contents changed|matching reference appeared|substituted symlink|Not a regular file/i, 'error.stale'],
    [/EACCES|EPERM|Operation not permitted|Permission denied/, 'error.permission'],
    [/ENOENT/, 'error.missing'], [/Filesystem root/, 'error.root'],
    [/valid UTF-8|UTF-8 list|NUL characters/, 'error.utf8'],
    [/relative file paths without traversal|List entry must name a file/, 'error.listPath'],
    [/not a directory|ENOTDIR/i, 'error.directory'],
  ];
  return { key: rules.find(([pattern]) => pattern.test(raw))?.[1] ?? 'error.generic', params: { detail: raw }, raw };
}
export function translate(messages, fallback, key, params = {}) {
  const template = (Object.hasOwn(messages, key) ? messages[key] : fallback[key]) ?? key;
  return typeof template === 'string' ? template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match) : key;
}
