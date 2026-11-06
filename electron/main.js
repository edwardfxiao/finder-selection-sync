import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, protocol, session, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopService } from './service.js';
import { fileSystem } from 'finder-selection-sync/files';
import { loadLocales, resolveLocale, translator } from './i18n.js';
import { appError, describeError } from './messages.js';
import { ImagePreviews } from './image-previews.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.join(here, 'renderer-dist');
const entryURL = 'finder-sync://app/index.html';
const assets = new Map();
// Radix portals inject styles for positioning and scroll locking. Scripts remain local-only.
const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
let window, running, closePending = false, quitPending = false;
let catalog, locale, localeDirectory, preferencePath, t;
const allowedPaths = new Set();
const service = new DesktopService({
  trash: file => shell.trashItem(file),
  onProgress: progress => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('finder:progress', progress);
      window.setProgressBar(progress.total ? progress.completed / progress.total : 2);
    }
  },
});
function updateWindowTheme() {
  if (window && !window.isDestroyed()) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#292928' : '#f4f4f2');
}
const images = new ImagePreviews({
  isAllowed: file => !!service.active?.rows.some(row => row.file === file),
  decode: async (file, size) => {
    const image = await nativeImage.createThumbnailFromPath(file, size);
    if (image.isEmpty()) throw appError('image.unavailable');
    return { dataURL: image.toDataURL({ scaleFactor: 1 }), ...image.getSize() };
  },
});

app.setName('Finder Selection Sync');
protocol.registerSchemesAsPrivileged([{ scheme: 'finder-sync', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(start).catch(error => { console.error(error); app.quit(); });
}

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
    || event.senderFrame.url !== entryURL) throw appError('error.unknownSender');
}
function handle(name, fn) {
  ipcMain.handle(`finder:${name}`, async (event, payload) => {
    try {
      trusted(event);
      return { ok: true, value: await fn(payload) };
    } catch (error) { return { ok: false, error: describeError(error) }; }
  });
}
async function task(fn) {
  if (running) throw appError('error.busy');
  running = Promise.resolve().then(fn);
  try { return await running; }
  finally {
    running = null;
    if (window && !window.isDestroyed()) window.setProgressBar(-1);
    if (closePending) {
      await service.discardAll();
      window?.destroy();
      if (quitPending) app.quit();
    }
  }
}
async function checkedPaths(paths, kind) {
  if (!['base', 'targets', 'list', 'compareA', 'compareB'].includes(kind) || !Array.isArray(paths) || !paths.length || paths.length > 32) throw appError('error.path');
  if (kind !== 'targets' && paths.length !== 1) throw appError('error.singlePath');
  const result = [];
  for (const input of paths) {
    if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw appError('error.path');
    const canonical = await fileSystem.realpath(input);
    const stat = await fileSystem.stat(canonical);
    if (kind === 'list' ? !stat.isFile() : !stat.isDirectory()) throw appError(kind === 'list' ? 'error.listFile' : 'error.directory');
    if (kind === 'list' && stat.size > 2 * 1024 * 1024) throw appError('error.listSize');
    allowedPaths.add(canonical);
    if (!result.includes(canonical)) result.push(canonical);
  }
  return result;
}
function knownPath(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')
    || !(allowedPaths.has(file) || service.active?.rows.some(row => row.file === file)
      || service.history.some(run => run.records.some(row => row.file === file)))) throw appError('error.knownPath');
  return file;
}

async function start() {
  // Development needs an explicit icon for both the Dock and native dialogs.
  // Packaged apps use their embedded bundle icon.
  let appIcon;
  if (process.platform === 'darwin' && !app.isPackaged) {
    const icon = nativeImage.createFromPath(path.join(here, 'build', 'icon.png'));
    if (!icon.isEmpty()) {
      appIcon = icon;
      app.dock.setIcon(icon);
    }
  }
  localeDirectory = path.join(app.getPath('userData'), 'locales');
  preferencePath = path.join(app.getPath('userData'), 'preferences.json');
  catalog = await loadLocales(path.join(here, 'locales'), localeDirectory);
  let savedLocale;
  try { savedLocale = JSON.parse(await fs.readFile(preferencePath, 'utf8')).locale; } catch { /* first launch */ }
  locale = resolveLocale(catalog, app.getLocale(), savedLocale);
  t = translator(catalog, locale);
  const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  async function indexAssets(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await indexAssets(file);
      else if (entry.isFile() && mimeTypes[path.extname(file)]) assets.set(`/${path.relative(rendererRoot, file).split(path.sep).join('/')}`, mimeTypes[path.extname(file)]);
    }
  }
  await indexAssets(rendererRoot);
  protocol.handle('finder-sync', async request => {
    const url = new URL(request.url);
    const mime = assets.get(url.pathname);
    if (url.host !== 'app' || !mime || request.method !== 'GET') return new Response('Not found', { status: 404 });
    return new Response(await fs.readFile(path.join(rendererRoot, url.pathname.slice(1))), {
      headers: { 'Content-Type': mime, 'Content-Security-Policy': policy, 'X-Content-Type-Options': 'nosniff' },
    });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  handle('version', () => app.getVersion());
  handle('theme', source => {
    if (!['light', 'dark', 'system'].includes(source)) throw appError('error.option', { value: String(source) });
    nativeTheme.themeSource = source;
    updateWindowTheme();
  });
  nativeTheme.on('updated', updateWindowTheme);
  handle('locales', () => ({ ...catalog, current: locale }));
  handle('locale', async code => {
    if (!catalog.bundles.some(b => b.code === code)) throw appError('error.locale');
    locale = code;
    t = translator(catalog, locale);
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(preferencePath, JSON.stringify({ locale }), { mode: 0o600 });
    buildMenu();
    return { ...catalog, current: locale };
  });
  handle('reload-locales', async () => {
    catalog = await loadLocales(path.join(here, 'locales'), localeDirectory);
    if (!catalog.bundles.some(b => b.code === locale)) locale = 'en-US';
    t = translator(catalog, locale); buildMenu();
    return { ...catalog, current: locale };
  });
  handle('locale-folder', async () => {
    await fs.mkdir(localeDirectory, { recursive: true });
    const bundled = await loadLocales(path.join(here, 'locales'));
    for (const { code } of bundled.bundles) {
      try { await fs.writeFile(path.join(localeDirectory, `${code}.template.json`), await fs.readFile(path.join(here, 'locales', `${code}.json`)), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const error = await shell.openPath(localeDirectory);
    if (error) throw new Error(error);
  });
  handle('choose', async ({ kind, replace } = {}) => {
    if (!['base', 'targets', 'list', 'compareA', 'compareB'].includes(kind)) throw appError('error.path');
    if (replace !== undefined && (kind !== 'targets' || typeof replace !== 'string' || !path.isAbsolute(replace) || replace.includes('\0'))) throw appError('error.path');
    const result = await dialog.showOpenDialog(window, {
      title: t(replace ? 'dialog.replaceTarget' : kind === 'compareA' ? 'compare.chooseA' : kind === 'compareB' ? 'compare.chooseB' : kind === 'list' ? 'dialog.chooseList' : kind === 'base' ? 'dialog.chooseBase' : 'dialog.chooseTargets'),
      defaultPath: replace, buttonLabel: t(replace ? 'folder.change' : 'folder.choose'),
      properties: kind === 'list' ? ['openFile'] : kind === 'targets' && !replace ? ['openDirectory', 'multiSelections'] : ['openDirectory'],
    });
    if (!result.canceled && replace && result.filePaths.length !== 1) throw appError('error.singlePath');
    return result.canceled ? [] : checkedPaths(result.filePaths, kind);
  });
  handle('paths', ({ paths, kind } = {}) => checkedPaths(paths, kind));
  handle('preview', config => task(() => service.preview(config)));
  handle('activate', id => task(() => service.activate(id)));
  handle('discard', mode => service.discard(mode));
  handle('discard-all', () => service.discardAll());
  handle('cancel', () => { service.cancel(); return true; });
  const confirmation = {
    confirm: async summary => {
      const action = t(summary.action === 'trash' ? 'dialog.trash' : 'dialog.tags');
      const { response } = await dialog.showMessageBox(window, {
        icon: appIcon,
        type: 'question', title: t('dialog.confirmTitle'), message: t('dialog.summary', { action, count: summary.count }),
        detail: t('dialog.detail', { roots: summary.roots.join('\n'), note: t(summary.action === 'trash' ? 'dialog.trashNote' : 'dialog.tagsNote') }),
        buttons: [t('dialog.cancel'), action], defaultId: 0, cancelId: 0, noLink: true,
      });
      return response === 1;
    },
  };
  handle('execute', ({ id, selectedIds } = {}) => task(() => service.execute(id, selectedIds, confirmation)));
  handle('tag-selected', ({ id, selectedIds, options } = {}) => task(() => service.tagSelected(id, selectedIds, options, confirmation)));
  handle('selected-tags', ({ id, selectedIds } = {}) => task(() => service.selectedTags(id, selectedIds)));
  handle('history', () => service.history);
  handle('clear-history', () => {
    if (running) throw appError('error.busy');
    return service.clearHistory();
  });
  handle('image', ({ file, kind } = {}) => images.read(file, kind));
  handle('copy-path', file => clipboard.writeText(knownPath(file)));
  handle('reveal', async payload => {
    // Restored workspace paths may not have been picked during this session.
    // Validate their type and canonical path before revealing them in Finder.
    const file = typeof payload === 'string' ? payload : (await checkedPaths([payload?.file], payload?.kind))[0];
    await fileSystem.access(knownPath(file));
    shell.showItemInFolder(file);
  });
  handle('export', async id => {
    const run = service.history.find(item => item.id === id);
    if (!run) throw appError('error.report');
    const result = await dialog.showSaveDialog(window, {
      title: t('dialog.export'), defaultPath: `finder-sync-${run.startedAt.replace(/[:.]/g, '-')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return false;
    await fs.writeFile(result.filePath, JSON.stringify(run, null, 2) + '\n', { mode: 0o600 });
    return true;
  });
  buildMenu();
  createWindow();
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: t('menu.edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: t('menu.view'), submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    { label: t('menu.window'), submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]));
}

function createWindow() {
  closePending = false;
  window = new BrowserWindow({
    width: 1180, height: 860, minWidth: 860, minHeight: 660,
    title: 'Finder Selection Sync', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#292928' : '#f4f4f2', show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-fail-load', (_event, code, description) => console.error('Page load failed:', code, description));
  window.webContents.on('render-process-gone', () => { service.cancel(); if (!running) service.discardAll().catch(console.error); });
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (running) { event.preventDefault(); closePending = true; service.cancel(); }
    else service.discardAll().catch(console.error);
  });
  window.on('closed', () => { window = null; });
  window.loadURL(entryURL);
}
app.on('before-quit', event => {
  if (running) { event.preventDefault(); quitPending = true; closePending = true; service.cancel(); }
});
app.on('activate', () => { if (!window && app.isReady()) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
