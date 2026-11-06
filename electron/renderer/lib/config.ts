import type { Config, Mode } from '../types';
export const finderColors = ['green', 'red', 'blue', 'orange', 'yellow', 'purple', 'gray'];
export const finderColorCodes: Record<string, number> = { gray: 1, green: 2, purple: 3, blue: 4, yellow: 5, red: 6, orange: 7 };
const common: Config = {
  mode: 'orphans', base: '', targets: [], recursive: true, depth: '', mixed: false, referenceExt: '', matchBy: 'relative',
  tagAction: 'sync', colors: ['green'], select: 'matched', scope: 'targets', match: 'any', mergeTags: true, includeClear: false,
  listSource: 'file', list: '', listText: '', listMode: 'keep', ignoreCase: false, includeExt: '', excludeExt: '',
  nameContains: '', nameExcludes: '', nameRegex: '', invertFilter: false,
  sizeMin: '', sizeMax: '', sizeUnit: 'MB', modifiedFrom: '', modifiedTo: '', filterAction: 'trash',
  listAction: 'trash', compareAction: 'review', compareSelection: 'common',
};
export const defaults = (): Record<Mode, Config> => ({
  orphans: structuredClone(common), tags: { ...structuredClone(common), mode: 'tags' },
  list: { ...structuredClone(common), mode: 'list', matchBy: 'name' },
  filter: { ...structuredClone(common), mode: 'filter', ignoreCase: true },
  compare: { ...structuredClone(common), mode: 'compare', matchBy: 'name', scope: 'both' },
});
export function preferences() {
  const config = defaults();
  let mode: Mode = 'orphans';
  try {
    const saved = JSON.parse(localStorage.getItem('finder-workbench') || 'null');
    if (['orphans', 'tags', 'list', 'filter', 'compare'].includes(saved?.mode)) mode = saved.mode;
    for (const key of Object.keys(config) as Mode[]) {
      if (saved?.config?.[key]) for (const field of Object.keys(common) as (keyof Config)[]) {
        const value = saved.config[key][field];
        if (field === 'colors') {
          if (Array.isArray(value)) config[key].colors = finderColors.filter(color => value.includes(color));
          else if (value === undefined && finderColors.includes(saved.config[key].color)) config[key].colors = [saved.config[key].color];
        } else if (field === 'targets' && Array.isArray(value)) config[key].targets = value.filter(p => typeof p === 'string').slice(0, 32);
        else if (typeof value === typeof common[field] && field !== 'mode' && field !== 'targets') Object.assign(config[key], { [field]: value });
      }
      config[key].mode = key;
    }
    // Tagging is a separate selection action; old preferences must not switch
    // the filename-list workflow away from its original cleanup rules.
    config.list.listAction = 'trash';
    config.filter.filterAction = 'trash';
    config.compare.compareAction = 'review';
  } catch { /* Use defaults if preferences are unavailable. */ }
  return { mode, config };
}
export const basename = (file: string) => file.split('/').filter(Boolean).at(-1) || file;
export function sizeText(size: number) {
  return size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB`
    : size < 1024 ** 3 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${(size / 1024 ** 3).toFixed(2)} GB`;
}
