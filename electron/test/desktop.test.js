import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopService, normalizeConfig } from '../service.js';
import { getFinderTags, setFinderTags } from 'finder-selection-sync';
import { loadLocales, resolveLocale, translator } from '../i18n.js';
import { PreviewController } from '../preview-controller.js';

async function fixture(t, entries = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'finder-desktop-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const directory of ['base', 'target', 'trash', 'temp']) await fs.mkdir(path.join(root, directory));
  for (const [name, content] of Object.entries(entries)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  const calls = [];
  const service = new DesktopService({ tempRoot: path.join(root, 'temp'), trash: async file => {
    calls.push(file); await fs.rename(file, path.join(root, 'trash', path.basename(file)));
  } });
  t.after(() => service.discard());
  return { root, service, calls, base: path.join(root, 'base'), targets: [path.join(root, 'target')] };
}
const selected = plan => plan.rows.filter(row => row.candidate).map(row => row.id);

test('desktop: executes only checked candidates, protects references, and consumes the preview', async t => {
  const f = await fixture(t, { 'base/A.NEF':'raw', 'target/A.JPG':'keep', 'target/B.JPG':'remove', 'target/B.XMP':'exclude' });
  const plan = await f.service.preview({ ...f, mode:'orphans', referenceExt:'NEF' });
  assert.equal(plan.candidates, 2);
  assert.equal(plan.total, 3);
  const row = plan.rows.find(row => row.name === 'B.JPG');
  const result = await f.service.execute(plan.id, [row.id]);
  assert.equal(result.completed, 1);
  assert.equal(await fs.readFile(path.join(f.targets[0], 'B.XMP'), 'utf8'), 'exclude');
  assert.equal(await fs.readFile(path.join(f.base, 'A.NEF'), 'utf8'), 'raw');
  await assert.rejects(f.service.execute(plan.id, [row.id]), /error.expired/);
});
test('desktop: forged, duplicate, protected, and old-plan row IDs cannot execute', async t => {
  const f = await fixture(t, { 'base/A.NEF':'raw', 'target/A.JPG':'keep', 'target/B.JPG':'remove' });
  const plan = await f.service.preview({ ...f, mode:'orphans' });
  const ids = selected(plan);
  await assert.rejects(f.service.execute(plan.id, ['../../outside']), /error.notCandidate/);
  await assert.rejects(f.service.execute(plan.id, [ids[0],ids[0]]), /error.selection/);
  await assert.rejects(f.service.execute(plan.id, [plan.rows.find(r => !r.candidate).id]), /error.notCandidate/);
  await f.service.preview({ ...f, mode:'orphans' });
  await assert.rejects(f.service.execute(plan.id, ids), /error.expired/);
  assert.deepEqual(f.calls, []);
});
test('desktop: a cancelled confirmation keeps the valid preview and does not mutate files', async t => {
  const f = await fixture(t, { 'base/A.NEF':'raw', 'target/B.JPG':'remove' });
  const plan = await f.service.preview({ ...f, mode:'orphans' });
  assert.deepEqual(await f.service.execute(plan.id, selected(plan), { confirm: async () => false }), { declined:true });
  assert.equal(f.service.active.id, plan.id);
  assert.deepEqual(f.calls, []);
});
for (const changed of ['candidate', 'reference', 'inventory']) {
  test(`desktop: ${changed} changes while confirming invalidate the whole plan`, async t => {
    const f = await fixture(t, { 'base/A.NEF':'raw', 'target/B.JPG':'remove' });
    const plan = await f.service.preview({ ...f, mode:'orphans' });
    const result = await f.service.execute(plan.id, selected(plan), { confirm: async () => {
      await fs.writeFile(path.join(changed === 'reference' ? f.base : f.targets[0], changed === 'candidate' ? 'B.JPG' : changed === 'reference' ? 'A.NEF' : 'new.JPG'), 'changed');
      return true;
    } });
    assert.equal(result.completed, 0);
    assert.equal(result.error.key, 'error.stale');
    assert.equal(result.unattempted, 1);
    assert.deepEqual(f.calls, []);
    assert.equal(f.service.active, null);
  });
}
test('desktop: cancellation stops after the current file and records remaining files', async t => {
  const f = await fixture(t, { 'base/A.NEF':'raw', 'target/B.JPG':'b', 'target/C.JPG':'c' });
  const plan = await f.service.preview({ ...f, mode:'orphans' });
  f.service.onProgress = value => { if (value.phase === 'execute') f.service.cancel(); };
  const result = await f.service.execute(plan.id, selected(plan));
  assert.equal(result.completed, 1);
  assert.equal(result.cancelled, true);
  assert.equal(result.unattempted, 1);
  assert.equal(f.calls.length, 1);
});
test('desktop: Trash failure stops later files with no permanent-delete fallback', async t => {
  const f = await fixture(t, { 'base/A.NEF':'raw', 'target/B.JPG':'b', 'target/C.JPG':'c' });
  f.service.trash = async () => { throw new Error('Trash failed'); };
  const plan = await f.service.preview({ ...f, mode:'orphans', permanent:true });
  const result = await f.service.execute(plan.id, selected(plan));
  assert.equal(result.failed, 1);
  assert.equal(result.unattempted, 1);
  assert.equal((await fs.readdir(f.targets[0])).length, 2);
  assert.equal(normalizeConfig({ ...f, mode:'orphans', permanent:true }).permanent, false);
});
test('desktop: pasted lists use the real list planner and temporary lists are removed', async t => {
  const f = await fixture(t, { 'target/A.JPG':'a', 'target/B.JPG':'b', 'target/C.NEF':'c' });
  const plan = await f.service.preview({ ...f, mode:'list', listSource:'text', listText:'A.JPG', listMode:'keep', excludeExt:'nef' });
  assert.deepEqual(plan.rows.filter(r => r.candidate).map(r => r.name), ['B.JPG']);
  assert.equal((await fs.readdir(path.join(f.root, 'temp'))).length, 1);
  const result = await f.service.execute(plan.id, selected(plan));
  assert.equal(result.completed, 1);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'temp')), []);
  await assert.rejects(f.service.preview({ ...f, mode:'list', listSource:'text', listText:'' }), /Empty list/);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'temp')), []);
});
test('desktop: a list and its hard links are protected from selected deletions', async t => {
  const f = await fixture(t, { 'target/list.txt':'list.txt\ncopy.txt\nA.JPG', 'target/A.JPG':'a' });
  await fs.link(path.join(f.targets[0], 'list.txt'), path.join(f.targets[0], 'copy.txt'));
  const plan = await f.service.preview({ ...f, mode:'list', list:path.join(f.targets[0], 'list.txt'), listMode:'delete' });
  assert.deepEqual(plan.rows.filter(r => r.candidate).map(r => r.name), ['A.JPG']);
});
test('desktop: mixed folders and multiple independent targets retain core matching rules', async t => {
  const f = await fixture(t, { 'base/A.NEF':'a', 'base/A.JPG':'a', 'base/B.JPG':'b', 'target/C.JPG':'c', 'other/D.JPG':'d' });
  const mixed = await f.service.preview({ ...f, mode:'orphans', mixed:true });
  assert.deepEqual(mixed.rows.filter(r => r.candidate).map(r => r.name), ['B.JPG']);
  const separate = await f.service.preview({ ...f, mode:'orphans', targets:[...f.targets,path.join(f.root, 'other')] });
  assert.deepEqual(separate.rows.filter(r => r.candidate).map(r => r.name), ['C.JPG','D.JPG']);
});
for (const [mode, key] of [['orphans', 'error.overlapOrphans'], ['tags', 'error.overlapTags'], ['list', 'error.overlapList']]) {
  test(`desktop: ${mode} overlap errors describe controls available in that workflow`, async t => {
    const f = await fixture(t, { 'base/A.NEF': 'a', 'target/B.JPG': 'b' });
    await assert.rejects(f.service.preview({ ...f, mode,
      targets: mode === 'list' ? [...f.targets, ...f.targets] : [f.base], listSource: 'text', listText: 'A.JPG'
    }), error => error.key === key);
  });
}
test('desktop: preview cancellation cleans up owned files and releases the scan lock', async t => {
  const f = await fixture(t, { 'target/A.JPG':'a' });
  f.service.onProgress = value => { if (value.phase === 'inspect') f.service.cancel(); };
  await assert.rejects(f.service.preview({ ...f, mode:'list', listSource:'text', listText:'A.JPG', listMode:'delete' }), /error.cancelled/);
  assert.equal(f.service.busy, false);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'temp')), []);
});
test('desktop: real Finder tags merge through processing suffixes and detect stale reference tags', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t, { 'base/A.NEF':'raw', 'target/A-[web].JPG':'a', 'target/B.JPG':'b' });
  await setFinderTags(path.join(f.base, 'A.NEF'), ['Selected\n2']);
  await setFinderTags(path.join(f.targets[0], 'A-[web].JPG'), ['Client\n4']);
  const plan = await f.service.preview({ ...f, mode:'tags', mergeTags:true });
  assert.equal(plan.candidates, 1);
  const result = await f.service.execute(plan.id, selected(plan));
  assert.equal(result.completed, 1);
  assert.deepEqual(new Set(await getFinderTags(path.join(f.targets[0], 'A-[web].JPG'))), new Set(['Selected\n2','Client\n4']));
  const replacement = await f.service.preview({ ...f, mode:'tags', mergeTags:false });
  await setFinderTags(path.join(f.base, 'A.NEF'), ['Changed\n6']);
  const blocked = await f.service.execute(replacement.id, selected(replacement));
  assert.equal(blocked.completed, 0);
  assert.equal(blocked.error.key, 'error.stale');
});
test('desktop: conflicting tag sources block all execution', async t => {
  const f = await fixture(t, { 'base/A.NEF':'a', 'base/A.JPG':'b', 'target/A.TIF':'c' });
  f.service.readTags = async file => file.endsWith('NEF') ? ['One'] : file.endsWith('JPG') ? ['Two'] : [];
  const plan = await f.service.preview({ ...f, mode:'tags' });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.candidates, 0);
  await assert.rejects(f.service.execute(plan.id, ['row-0']), /error.conflict/);
});
test('desktop: tags on hard-linked files are excluded to respect individual selection', async t => {
  const f = await fixture(t, { 'base/A.NEF':'a', 'target/A.JPG':'b' });
  await fs.link(path.join(f.targets[0], 'A.JPG'), path.join(f.root, 'outside-link'));
  f.service.readTags = async file => file.endsWith('NEF') ? ['Selected'] : [];
  const plan = await f.service.preview({ ...f, mode:'tags' });
  assert.equal(plan.candidates, 0);
  assert.equal(plan.warnings[0].key, 'warning.hardLinks');
});

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function previewHarness() {
  const requests = [], updates = [], timers = new Map();
  let next = 0;
  const api = { discard: async () => {}, cancel: async () => {}, preview: config => { const pending = deferred(); requests.push({config, ...pending}); return pending.promise; } };
  const controller = new PreviewController(api, patch => updates.push(patch), {
    setTimer: fn => { timers.set(++next, fn); return next; }, clearTimer: id => timers.delete(id),
  });
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { controller, requests, updates, flush, timers };
}
test('auto preview: default browser timers retain their global receiver across updates and cancellation', async t => {
  const timers = new Map(), updates = [], requests = [];
  let next = 0;
  // Browser timer methods reject a class instance as their receiver; Node's timers do not.
  t.mock.method(globalThis, 'setTimeout', function (callback) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    timers.set(++next, callback);
    return next;
  });
  t.mock.method(globalThis, 'clearTimeout', function (id) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    timers.delete(id);
  });
  const controller = new PreviewController({
    discard: async () => {}, cancel: async () => {},
    preview: async config => { requests.push(config); return { id: 'current' }; },
  }, patch => updates.push(patch));
  const config = { mode: 'list', targets: ['/target'], listSource: 'text', listText: 'A.JPG' };
  controller.update(config, 400);
  controller.update({ ...config, listText: 'B.JPG' }, 400);
  assert.equal(timers.size, 1);
  for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  await tick();
  assert.equal(requests[0].listText, 'B.JPG');
  assert.equal(updates.some(update => update.plan?.id === 'current'), true);
  controller.update(config, 400);
  controller.stop();
  assert.equal(timers.size, 0);
  controller.update(config, 400);
  controller.forget();
  assert.equal(timers.size, 0);
  controller.dispose();
});
test('auto preview: debounces text, runs one scan at a time, and suppresses stale results', async () => {
  const h = previewHarness();
  const config = { mode:'orphans',base:'/base',targets:['/target'],referenceExt:'NEF' };
  h.controller.update(config, 400);
  h.controller.update({...config,referenceExt:'JPG'}, 400);
  assert.equal(h.timers.size, 1);
  h.flush(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].config.referenceExt, 'JPG');
  h.controller.update({...config,referenceExt:'CR3'}, 0); h.flush();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({id:'old'}); await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].config.referenceExt, 'CR3');
  assert.equal(h.updates.some(update => update.plan?.id === 'old'), false);
  h.requests[1].resolve({id:'new'}); await tick();
  assert.equal(h.updates.some(update => update.plan?.id === 'new'), true);
});
test('auto preview: clearing required input and stopping prevent queued scans', async () => {
  const h = previewHarness(), config = {mode:'list',targets:['/target'],listSource:'text',listText:'A.JPG'};
  h.controller.update(config, 400);
  h.controller.update({...config,listText:''}, 400); h.flush();
  assert.equal(h.requests.length, 0);
  h.controller.update(config, 400); h.controller.stop(); h.flush();
  assert.equal(h.requests.length, 0);
  h.controller.update(config, 0); h.flush(); h.controller.stop();
  h.requests[0].resolve({id:'stopped'}); await tick();
  assert.equal(h.updates.some(update => update.plan?.id === 'stopped'), false);
});

test('language packs: bundled keys and interpolation placeholders stay aligned', async () => {
  const directory = new URL('../locales/', import.meta.url);
  const en = JSON.parse(await fs.readFile(new URL('en-US.json', directory), 'utf8'));
  for (const file of (await fs.readdir(directory)).filter(name => name.endsWith('.json'))) {
    const pack = JSON.parse(await fs.readFile(new URL(file, directory), 'utf8'));
    assert.deepEqual(Object.keys(en).sort(), Object.keys(pack).sort(), file);
    for (const key of Object.keys(en).filter(key => key !== '_meta')) {
      assert.equal(typeof pack[key], 'string', `${file}: ${key}`);
      assert.ok(pack[key].trim(), `${file}: ${key}`);
      assert.deepEqual((en[key].match(/\{\w+\}/g) ?? []).sort(), (pack[key].match(/\{\w+\}/g) ?? []).sort(), `${file}: ${key}`);
    }
  }
});
test('language packs: Japanese is discovered, interpolates messages, and follows system locale unless a choice was saved', async () => {
  const catalog = await loadLocales(fileURLToPath(new URL('../locales/', import.meta.url)));
  assert.equal(catalog.bundles.find(bundle => bundle.code === 'ja-JP').label, '日本語');
  assert.equal(translator(catalog, 'ja-JP')('preview.selected', { count: 3 }), '3件を選択中');
  assert.equal(resolveLocale(catalog, 'ja'), 'ja-JP');
  assert.equal(resolveLocale(catalog, 'ja-JP'), 'ja-JP');
  assert.equal(resolveLocale(catalog, 'JA_jp'), 'ja-JP');
  assert.equal(resolveLocale(catalog, 'ja-JP', 'zh-CN'), 'zh-CN');
  assert.equal(resolveLocale(catalog, 'ja', 'missing'), 'ja-JP');
  assert.equal(resolveLocale(catalog, 'zh-TW'), 'zh-CN');
  assert.equal(resolveLocale(catalog, 'de-DE'), 'en-US');
});
test('language packs: new JSON files are discovered, missing keys fall back, invalid packs are isolated', async t => {
  const f = await fixture(t);
  const localeDir = path.join(f.root, 'locales'); await fs.mkdir(localeDir);
  await fs.writeFile(path.join(localeDir,'fr-FR.json'), JSON.stringify({_meta:{label:'Français'},'task.tags':'Étiquettes Finder','preview.selected':'{count} fichiers'}));
  await fs.writeFile(path.join(localeDir,'de-DE.json'), 'invalid json');
  await fs.writeFile(path.join(localeDir,'en-US.template.json'), 'not a language');
  const catalog = await loadLocales(fileURLToPath(new URL('../locales/', import.meta.url)), localeDir);
  const tFr = translator(catalog, 'fr-FR');
  assert.equal(tFr('task.tags'), 'Étiquettes Finder');
  assert.equal(tFr('preview.selected', {count:3}), '3 fichiers');
  assert.equal(tFr('task.list'), 'Organize by list');
  assert.equal(catalog.warnings.length, 1);
  const bundled = await loadLocales(fileURLToPath(new URL('../locales/', import.meta.url)));
  assert.equal(catalog.bundles.length, bundled.bundles.length + 1);
});
