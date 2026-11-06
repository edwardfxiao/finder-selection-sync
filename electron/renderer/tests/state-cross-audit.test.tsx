/// <reference types="node" />
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/app';
import { defaults } from '@/lib/config';
import type { Catalog, Config, FinderAPI, Mode, Plan, ProgressInfo, Row, Run } from '@/types';
import { DesktopService } from '../../service.js';
import { describeError } from '../../messages.js';
import en from '../../locales/en-US.json';

// Real planners, snapshots, directory scans and React interactions. Only the OS
// picker, confirmation, clipboard, tag adapter and Trash adapter are substituted.
// The Trash substitute moves fixtures into a sibling directory, never user Trash.
const catalog: Catalog = { current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr',
  messages: Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }] };
const fixtures: { root: string; service: DesktopService }[] = [];

async function setup(mode: Mode, patch: Partial<Config> = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'finder-ui-integration-')));
  const base = path.join(root, '参考 原片'), target = path.join(root, '导出 files'), trash = path.join(root, 'trash'), tempRoot = path.join(root, 'temp');
  await Promise.all([base, target, trash, tempRoot].map(dir => fs.mkdir(dir)));
  const entries = { 'A.NEF': base, 'B.NEF': base, 'A.txt': target, 'B.txt': target, 'C.txt': target, 'D.txt': target };
  await Promise.all(Object.entries(entries).map(([name, dir]) => fs.writeFile(path.join(dir, name), `fixture ${name}`)));
  const list = path.join(root, '選択リスト.txt');
  await fs.writeFile(list, 'A.txt\nB.txt\n');
  const tags = new Map<string, string[]>([[path.join(base, 'A.NEF'), ['Green\n2']], [path.join(base, 'B.NEF'), ['Red\n6']], [path.join(target, 'A.txt'), ['Blue\n4']]]);
  const trashFile = vi.fn(async (file: string) => {
    const destination = path.join(trash, path.basename(file));
    await fs.rename(file, destination);
    return destination;
  });
  const writeTags = vi.fn(async (file: string, values: string[]) => { tags.set(file, [...values]); return [...values]; });
  const readTags = vi.fn(async (file: string) => tags.get(file) ?? []);
  let progress: ((value: ProgressInfo) => void) | undefined;
  const service = new DesktopService({ tempRoot, trash: trashFile, readTags, writeTags,
    onProgress: (...values: ProgressInfo[]) => { if (values[0]) progress?.(values[0]); } });
  fixtures.push({ root, service });
  const config = defaults();
  for (const current of ['orphans', 'tags', 'list', 'filter', 'compare'] as const) config[current] = { ...config[current], base, targets: [target], list };
  config.orphans.referenceExt = 'NEF';
  config[mode] = { ...config[mode], ...patch };
  localStorage.setItem('finder-workbench', JSON.stringify({ mode, config }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const confirm = vi.fn(async () => true);
  const api = {
    version: vi.fn().mockResolvedValue('2.2.0'), locales: vi.fn().mockResolvedValue(catalog),
    setTheme: vi.fn().mockResolvedValue(undefined), setLocale: vi.fn().mockResolvedValue(catalog), reloadLocales: vi.fn().mockResolvedValue(catalog), openLocaleFolder: vi.fn().mockResolvedValue(undefined),
    choose: vi.fn<FinderAPI['choose']>().mockResolvedValue([]), dropped: vi.fn<FinderAPI['dropped']>().mockResolvedValue([]),
    preview: vi.fn(async (value: Config) => { try { return await service.preview(value) as Plan; } catch (error) { throw describeError(error); } }),
    activate: vi.fn<FinderAPI['activate']>(async id => await service.activate(id) as Plan | null),
    discard: vi.fn<FinderAPI['discard']>(async mode => { await service.discard(mode); }), cancel: vi.fn(async () => { service.cancel(); }),
    discardAll: vi.fn<FinderAPI['discardAll']>(async () => { await service.discardAll(); }),
    execute: vi.fn(async (id: string, ids: string[]) => await service.execute(id, ids, { confirm }) as Run | { declined: true }),
    tagSelected: vi.fn<FinderAPI['tagSelected']>(async (id, ids, options) => await service.tagSelected(id, ids, options, { confirm }) as Run | { declined: true } | { unchanged: true }),
    selectedTags: vi.fn<FinderAPI['selectedTags']>(async (id, ids) => await service.selectedTags(id, ids)),
    history: vi.fn(async () => service.history as Run[]), clearHistory: vi.fn(async () => service.clearHistory() as Run[]),
    reveal: vi.fn().mockResolvedValue(undefined), copyPath: vi.fn().mockResolvedValue(undefined), exportResult: vi.fn().mockResolvedValue(true),
    image: vi.fn().mockRejectedValue(new Error('Text fixtures have no images')),
    onProgress: vi.fn((callback: (value: ProgressInfo) => void) => { progress = callback; return () => { progress = undefined; }; }),
  } satisfies FinderAPI;
  window.finder = api;
  return { root, base, target, trash, tempRoot, list, tags, trashFile, readTags, writeTags, service, confirm, api };
}

afterEach(async () => {
  cleanup();
  for (const { root, service } of fixtures.splice(0)) { await service.discardAll(); await fs.rm(root, { recursive: true, force: true }); }
  localStorage.clear(); vi.unstubAllGlobals();
});
const ready = () => screen.findByRole('checkbox', { name: 'Process A.txt' }, { timeout: 10000 });
const action = (mode: Mode, count: number) => screen.getByRole('button', { name: mode === 'tags' ? `Update tags on ${count} files` : `Move ${count} files to Trash` });
const candidateNames = (service: DesktopService) => service.active!.rows.filter((row: { candidate: boolean }) => row.candidate).map((row: { name: string }) => row.name).sort();
const tagsDialog = async () => {
  const dialog = within(await screen.findByRole('dialog'));
  await dialog.findAllByRole('listitem');
  await waitFor(() => expect(dialog.queryByText(catalog.bundles[0].messages['progress.readTags'])).toBeNull());
  return dialog;
};



for (const trigger of ['Stop', 'Escape']) {
  it(`independent tag execution ${trigger} stops after the current write drains and shows its partial result`, async () => {
    const f = await setup('filter', { colors: ['green'] }), user = userEvent.setup();
    let release!: () => void, started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    f.writeTags.mockImplementation(async (file, values) => {
      if (first) { first = false; started(); await gate; }
      f.tags.set(file, [...values]);
      return [...values];
    });
    render(<App />); await ready();
    await user.click(screen.getByRole('button', { name: 'Select all results' }));
    await user.click(screen.getByRole('button', { name: 'Set tags' }));
    const dialog = await tagsDialog();
    await user.click(dialog.getByRole('button', { name: 'Set tags' }));
    await act(async () => writing);
    const cancellations = f.api.cancel.mock.calls.length;
    try {
      expect(f.service.busy).toBe(true);
      expect((dialog.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
      expect(dialog.getByRole('status').textContent).toContain('0 / 4');
      expect((dialog.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(false);
      if (trigger === 'Stop') await user.click(dialog.getByRole('button', { name: 'Stop' }));
      else await user.keyboard('{Escape}');
      expect(f.api.cancel).toHaveBeenCalledTimes(cancellations + 1);
      expect((dialog.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(true);
      await user.keyboard('{Escape}');
      expect(f.api.cancel).toHaveBeenCalledTimes(cancellations + 1);
      expect(screen.getByRole('dialog')).toBeTruthy();
    } finally { await act(async () => release()); }
    await screen.findByRole('heading', { name: 'Stopped by you' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(f.service.history[0]).toMatchObject({ completed: 1, unattempted: 3, cancelled: true, error: null });
    expect(f.writeTags).toHaveBeenCalledTimes(1);
    expect(f.trashFile).not.toHaveBeenCalled();
  });
}

it('independent tag preparation can stop before native confirmation without losing the checked rows', async () => {
  const f = await setup('filter', { colors: ['green'] }), user = userEvent.setup();
  render(<App />); await ready();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog(), oldPlan = f.service.active!.id;
  let release!: () => void, started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.readTags.mockImplementation(async file => { started(); await gate; return f.tags.get(file) ?? []; });
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await act(async () => reading);
  try {
    await user.click(dialog.getByRole('button', { name: 'Stop' }));
    expect(f.api.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(f.confirm).not.toHaveBeenCalled();
  } finally { await act(async () => release()); }
  await waitFor(() => expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(false));
  expect(dialog.queryByRole('alert')).toBeNull();
  expect(f.service.active!.id).toBe(oldPlan);
  expect(f.service.history).toHaveLength(0);
  expect(f.writeTags).not.toHaveBeenCalled();
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect((await ready()).getAttribute('aria-checked')).toBe('true');
});

it('waiting for native tag confirmation disables Stop and leaves cancellation to the native response', async () => {
  const f = await setup('filter', { colors: ['green'] }), user = userEvent.setup();
  let answer!: (accepted: boolean) => void;
  f.confirm.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  render(<App />); await ready();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog(), oldPlan = f.service.active!.id;
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect(answer).toBeTypeOf('function'));
  try {
    expect(dialog.getByRole('status').textContent).toContain('Waiting for confirmation');
    expect((dialog.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{Escape}');
    expect(f.api.cancel).not.toHaveBeenCalled();
  } finally { await act(async () => answer(false)); }
  await waitFor(() => expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(false));
  expect(f.service.active!.id).toBe(oldPlan);
  expect(f.writeTags).not.toHaveBeenCalled();
});

for (const source of ['drop', 'picker']) {
  it(`a delayed folder ${source} cannot invalidate an already-open independent tag dialog`, async () => {
    const f = await setup('filter', { colors: ['green'] }), user = userEvent.setup();
    let finishPath!: (paths: string[]) => void;
    if (source === 'drop') f.api.dropped.mockImplementationOnce(() => new Promise(resolve => { finishPath = resolve; }));
    else f.api.choose.mockImplementationOnce(() => new Promise(resolve => { finishPath = resolve; }));
    render(<App />); await ready();
    const oldPlan = f.service.active!.id;
    const folder = screen.getByRole('button', { name: f.target });
    if (source === 'drop') fireEvent.drop(folder.closest('.folder-card')!, { dataTransfer: { files: [new File([''], 'folder')] } });
    else await user.click(folder);
    await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
    await user.click(screen.getByRole('button', { name: 'Set tags' }));
    const dialog = await tagsDialog();
    expect((document.querySelector('.nav-button.active') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finishPath([f.base]));
    expect(f.service.active?.id).toBe(oldPlan);
    expect(f.api.preview).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.filter.targets).toEqual([f.target]);
    await user.click(dialog.getByRole('button', { name: 'Set tags' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(f.api.tagSelected).toHaveBeenCalledWith(oldPlan, expect.any(Array), expect.any(Object));
    expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'), ['Blue\n4', 'Green\n2']);
    expect(f.trashFile).not.toHaveBeenCalled();
  });
}

it('shortcut refresh after stopping a scan creates a fresh, usable Stop button', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  render(<App />); await ready();
  const saved = await f.api.preview.mock.results[0].value;
  let finishStopped!: (plan: Plan) => void, finishFresh!: (plan: Plan) => void;
  f.api.preview.mockImplementationOnce(() => new Promise<Plan>(resolve => { finishStopped = resolve; }))
    .mockImplementationOnce(() => new Promise<Plan>(resolve => { finishFresh = resolve; }));
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(f.api.preview).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  await act(async () => finishStopped(saved));
  expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
  fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(f.api.preview).toHaveBeenCalledTimes(3));
  try {
    const button = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    const cancellations = f.api.cancel.mock.calls.length;
    await user.click(button);
    expect(f.api.cancel).toHaveBeenCalledTimes(cancellations + 1);
  } finally { await act(async () => finishFresh({ ...saved, id: 'fresh-scan' })); }
  expect(screen.queryByRole('checkbox', { name: 'Process A.txt' })).toBeNull();
});
