const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(name, payload) {
  const response = await ipcRenderer.invoke(`finder:${name}`, payload);
  if (!response.ok) throw Object.assign(new Error(response.error.raw || response.error.key), response.error);
  return response.value;
}
contextBridge.exposeInMainWorld('finder', {
  version: () => call('version'),
  locales: () => call('locales'),
  setLocale: locale => call('locale', locale),
  reloadLocales: () => call('reload-locales'),
  openLocaleFolder: () => call('locale-folder'),
  choose: (kind, replace) => call('choose', { kind, replace }),
  dropped: (files, kind) => call('paths', { paths: files.map(file => webUtils.getPathForFile(file)), kind }),
  preview: config => call('preview', config),
  discard: () => call('discard'),
  execute: (id, selectedIds) => call('execute', { id, selectedIds }),
  cancel: () => call('cancel'),
  history: () => call('history'),
  clearHistory: () => call('clear-history'),
  image: (file, kind) => call('image', { file, kind }),
  reveal: (file, kind) => call('reveal', kind ? { file, kind } : file),
  copyPath: file => call('copy-path', file),
  exportResult: id => call('export', id),
  onProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('finder:progress', listener);
    return () => ipcRenderer.removeListener('finder:progress', listener);
  },
});
