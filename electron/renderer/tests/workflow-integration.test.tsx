/// <reference types="node" />
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/app';
import { defaults } from '@/lib/config';
import type { Catalog, Config, FinderAPI, Mode, Plan, ProgressInfo, Run } from '@/types';
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
  let progress: ((value: ProgressInfo) => void) | undefined;
  const service = new DesktopService({ tempRoot, trash: trashFile, readTags: async (file: string) => tags.get(file) ?? [], writeTags,
    onProgress: (...values: ProgressInfo[]) => { if (values[0]) progress?.(values[0]); } });
  fixtures.push({ root, service });
  const config = defaults();
  for (const current of ['orphans', 'tags', 'list'] as const) config[current] = { ...config[current], base, targets: [target], list };
  config[mode] = { ...config[mode], ...patch };
  localStorage.setItem('finder-workbench', JSON.stringify({ mode, config }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const confirm = vi.fn(async () => true);
  const api = {
    version: vi.fn().mockResolvedValue('2.2.0'), locales: vi.fn().mockResolvedValue(catalog),
    setLocale: vi.fn().mockResolvedValue(catalog), reloadLocales: vi.fn().mockResolvedValue(catalog), openLocaleFolder: vi.fn().mockResolvedValue(undefined),
    choose: vi.fn<FinderAPI['choose']>().mockResolvedValue([]), dropped: vi.fn<FinderAPI['dropped']>().mockResolvedValue([]),
    preview: vi.fn(async (value: Config) => { try { return await service.preview(value) as Plan; } catch (error) { throw describeError(error); } }),
    discard: vi.fn(async () => { await service.discard(); }), cancel: vi.fn(async () => { service.cancel(); }),
    execute: vi.fn(async (id: string, ids: string[]) => await service.execute(id, ids, { confirm }) as Run | { declined: true }),
    history: vi.fn(async () => service.history as Run[]), clearHistory: vi.fn(async () => service.clearHistory() as Run[]),
    reveal: vi.fn().mockResolvedValue(undefined), copyPath: vi.fn().mockResolvedValue(undefined), exportResult: vi.fn().mockResolvedValue(true),
    image: vi.fn().mockRejectedValue(new Error('Text fixtures have no images')),
    onProgress: vi.fn((callback: (value: ProgressInfo) => void) => { progress = callback; return () => { progress = undefined; }; }),
  } satisfies FinderAPI;
  window.finder = api;
  return { root, base, target, trash, tempRoot, list, tags, trashFile, writeTags, service, confirm, api };
}

afterEach(async () => {
  cleanup();
  for (const { root, service } of fixtures.splice(0)) { await service.discard(); await fs.rm(root, { recursive: true, force: true }); }
  localStorage.clear(); vi.unstubAllGlobals();
});
const ready = () => screen.findByRole('checkbox', { name: 'Process A.txt' }, { timeout: 10000 });
const action = (mode: Mode, count: number) => screen.getByRole('button', { name: mode === 'tags' ? `Update tags on ${count} files` : `Move ${count} files to Trash` });
const candidateNames = (service: DesktopService) => service.active!.rows.filter((row: { candidate: boolean }) => row.candidate).map((row: { name: string }) => row.name).sort();

for (const mode of ['orphans', 'tags', 'list'] as const) {
  it(`${mode}: Reset all clears paths, pasted lists and the executable plan while preserving rules and other workflows`, async () => {
    const f = await setup(mode, { recursive: false, listSource: 'text', listText: 'A.txt\nB.txt' }), user = userEvent.setup();
    const saved = JSON.parse(localStorage.getItem('finder-workbench')!);
    const { container } = render(<App />); await ready();
    await user.click(screen.getByRole('button', { name: /: Collapse folder options$/ }));
    const reset = screen.getByRole('button', { name: 'Reset all' });
    await user.click(reset);
    expect(screen.getByRole('button', { name: 'Reset all' })).toBe(reset);
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.workspace-settings')?.hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /^Process / })).toBeNull();
    expect((action(mode, 0) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(f.service.active).toBeNull());
    await waitFor(async () => expect(await fs.readdir(f.tempRoot)).toEqual([]));
    const cleared = JSON.parse(localStorage.getItem('finder-workbench')!);
    expect(cleared.config).toEqual({ ...saved.config, [mode]: { ...saved.config[mode], base: '', targets: [], list: '', listText: '' } });
    expect(await fs.readdir(f.target)).toEqual(['A.txt', 'B.txt', 'C.txt', 'D.txt']);
    expect(f.api.execute).not.toHaveBeenCalled();
    expect(f.trashFile).not.toHaveBeenCalled(); expect(f.writeTags).not.toHaveBeenCalled();
  });

  it(`${mode}: real files reach the GUI, declining does nothing, and only the checked file is processed`, async () => {
    const f = await setup(mode), user = userEvent.setup();
    render(<App />);
    await ready();
    expect(candidateNames(f.service)).toEqual(mode === 'tags' ? ['A.txt', 'B.txt'] : ['C.txt', 'D.txt']);
    const skipped = mode === 'tags' ? 'B.txt' : 'D.txt';
    const processed = mode === 'tags' ? 'A.txt' : 'C.txt';
    await user.click(screen.getByRole('checkbox', { name: `Process ${skipped}` }));
    f.confirm.mockResolvedValueOnce(false);
    await user.click(action(mode, 1));
    await waitFor(() => expect((action(mode, 1) as HTMLButtonElement).disabled).toBe(false));
    expect(f.service.history).toHaveLength(0);
    expect(f.writeTags).not.toHaveBeenCalled(); expect(f.trashFile).not.toHaveBeenCalled();
    expect(await fs.readdir(f.target)).toEqual(['A.txt', 'B.txt', 'C.txt', 'D.txt']);
    await user.click(action(mode, 1));
    expect(await screen.findByRole('heading', { name: 'Processing complete' })).toBeTruthy();
    expect(f.service.history[0]).toMatchObject({ mode, completed: 1, failed: 0, unattempted: 0 });
    expect(f.service.history[0].records.map((row: { name: string }) => row.name)).toEqual([processed]);
    expect(await fs.readFile(path.join(f.base, 'A.NEF'), 'utf8')).toBe('fixture A.NEF');
    expect(await fs.readFile(path.join(f.target, skipped), 'utf8')).toBe(`fixture ${skipped}`);
    if (mode === 'tags') {
      expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'), ['Blue\n4', 'Green\n2']);
      expect(f.trashFile).not.toHaveBeenCalled();
    } else {
      expect(f.trashFile).toHaveBeenCalledExactlyOnceWith(path.join(f.target, processed));
      expect(await fs.readFile(path.join(f.trash, processed), 'utf8')).toBe(`fixture ${processed}`);
      expect(f.writeTags).not.toHaveBeenCalled();
    }
    await user.click(screen.getByRole('button', { name: 'Export report' }));
    expect(f.api.exportResult).toHaveBeenCalledExactlyOnceWith(f.service.history[0].id);
    expect(screen.queryByRole('button', { name: /Load example/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Activity/ }));
    const clear = screen.getByRole('button', { name: 'Clear all' });
    // A rejected clear must keep the records available to view and export.
    f.api.clearHistory.mockRejectedValueOnce({ key: 'error.busy' });
    await user.click(clear);
    await waitFor(() => expect((clear as HTMLButtonElement).disabled).toBe(false));
    expect(f.service.history).toHaveLength(1);
    expect(screen.queryByText('No activity yet')).toBeNull();
    await user.click(clear);
    expect(await screen.findByText('No activity yet')).toBeTruthy();
    expect(f.service.history).toEqual([]);
    expect((clear as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Activity' }).querySelector('.nav-count')).toBeNull();
    // Returning to Activity reads the cleared service state, not just a UI reset.
    await user.click(screen.getByRole('button', { name: mode === 'tags' ? 'Finder tags' : mode === 'list' ? 'Organize by list' : 'Clean by reference' }));
    await screen.findByRole('checkbox', { name: 'Process A.txt' });
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('No activity yet')).toBeTruthy();
    expect(f.trashFile).toHaveBeenCalledTimes(mode === 'tags' ? 0 : 1);
    expect(f.writeTags).toHaveBeenCalledTimes(mode === 'tags' ? 1 : 0);
    expect(await fs.readFile(path.join(mode === 'tags' ? f.target : f.trash, processed), 'utf8')).toBe(`fixture ${processed}`);
  });

  it(`${mode}: a file added while confirming stops execution and presents the error in Activity`, async () => {
    const f = await setup(mode), user = userEvent.setup();
    render(<App />); await ready();
    f.confirm.mockImplementationOnce(async () => { await fs.writeFile(path.join(f.target, 'new.txt'), 'external edit'); return true; });
    await user.click(action(mode, 2));
    expect(await screen.findByRole('heading', { name: 'Processing stopped' })).toBeTruthy();
    expect(screen.getAllByText('Files, folders or references changed after preview. Processing stopped; preview again.').length).toBeGreaterThan(0);
    expect(f.service.history[0]).toMatchObject({ completed: 0, unattempted: 2 });
    expect(f.trashFile).not.toHaveBeenCalled(); expect(f.writeTags).not.toHaveBeenCalled();
    expect(await fs.readdir(f.target)).toEqual(['A.txt', 'B.txt', 'C.txt', 'D.txt', 'new.txt']);
  });
}

it('color choices display Finder color dots in the menu and selected value and update the real preview', async () => {
  const f = await setup('tags', { tagAction: 'color' }), user = userEvent.setup();
  render(<App />); await ready();
  const trigger = screen.getByRole('combobox', { name: 'Color' });
  expect(trigger.querySelector('.tag-dot.color-2')).toBeTruthy();
  await user.click(trigger);
  const list = await screen.findByRole('listbox');
  const names = ['Gray', 'Green', 'Purple', 'Blue', 'Yellow', 'Red', 'Orange'];
  for (const [index, name] of names.entries()) expect(within(list).getByRole('option', { name }).querySelector(`.tag-dot.color-${index + 1}`)).toBeTruthy();
  await user.click(within(list).getByRole('option', { name: 'Red' }));
  await ready();
  expect(trigger.querySelector('.tag-dot.color-6')).toBeTruthy();
  expect(trigger.textContent).toBe('Red');
  expect(f.service.active!.rows.find((row: { name: string }) => row.name === 'A.txt').nextTags).toEqual(['Red\n6']);
  expect(f.writeTags).not.toHaveBeenCalled();
});

it('list source switching, text edits and clearing produce new real plans and remove temporary list files', async () => {
  const f = await setup('list'), user = userEvent.setup();
  render(<App />); await ready();
  await user.click(screen.getByRole('tab', { name: 'Paste a list' }));
  expect(screen.queryByRole('checkbox', { name: 'Process A.txt' })).toBeNull();
  const editor = screen.getByRole('textbox', { name: 'One filename per line' });
  fireEvent.change(editor, { target: { value: 'C.txt\nD.txt' } });
  await ready();
  expect(candidateNames(f.service)).toEqual(['A.txt', 'B.txt']);
  expect(await fs.readdir(f.tempRoot)).toHaveLength(1);
  fireEvent.change(editor, { target: { value: ' \n ' } });
  await waitFor(() => expect(f.service.active).toBeNull());
  await waitFor(async () => expect(await fs.readdir(f.tempRoot)).toEqual([]));
  expect((action('list', 0) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('tab', { name: 'List file' }));
  await ready(); expect(candidateNames(f.service)).toEqual(['C.txt', 'D.txt']);
  expect(f.trashFile).not.toHaveBeenCalled();
});

it('invalid depth recovers after correction, and same-folder mode protects original files', async () => {
  const f = await setup('orphans'), user = userEvent.setup();
  await fs.writeFile(path.join(f.base, 'A.txt'), 'matched export');
  await fs.writeFile(path.join(f.base, 'C.txt'), 'orphan export');
  render(<App />); await ready();
  await user.click(screen.getByRole('tab', { name: 'Same folder' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Process A.NEF' }).getAttribute('disabled')).not.toBeNull());
  expect(candidateNames(f.service)).toEqual(['C.txt']);
  await user.click(screen.getByRole('button', { name: 'More options' }));
  const depth = screen.getByRole('textbox', { name: 'Maximum depth' });
  fireEvent.change(depth, { target: { value: '-1' } });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect((action('orphans', 0) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(depth, { target: { value: '0' } });
  await ready();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(candidateNames(f.service)).toEqual(['C.txt']);
  expect(f.trashFile).not.toHaveBeenCalled();
});

it('1,004 real target files paginate without losing selection across search and expanded preview', async () => {
  const f = await setup('orphans'), user = userEvent.setup();
  for (let start = 0; start < 1000; start += 50) await Promise.all(Array.from({ length: 50 }, (_, offset) =>
    fs.writeFile(path.join(f.target, `bulk-${String(start + offset).padStart(4, '0')}.txt`), 'bulk fixture')));
  const { container } = render(<App />); await ready();
  expect(f.service.active!.rows).toHaveLength(1004);
  expect(candidateNames(f.service)).toHaveLength(1002);
  expect(container.querySelectorAll('.file-row:not(.table-heading)')).toHaveLength(100);
  await user.click(screen.getByRole('button', { name: 'Deselect all' }));
  await user.click(screen.getByRole('checkbox', { name: 'Process bulk-0000.txt' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const row = screen.getAllByRole('checkbox', { name: /^Process / })[0];
  await user.click(row);
  const second = row.getAttribute('aria-label')!.slice('Process '.length);
  await user.click(screen.getByRole('button', { name: 'Expand preview' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a file' }), { target: { value: second } });
  expect(screen.getByRole('checkbox', { name: `Process ${second}` }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getAllByRole('checkbox', { name: /^Process / })).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Back to workspace' }));
  expect((action('orphans', 2) as HTMLButtonElement).disabled).toBe(false);
  await user.click(action('orphans', 2));
  expect(await screen.findByRole('heading', { name: 'Processing complete' })).toBeTruthy();
  expect(f.trashFile.mock.calls.map(([file]) => path.basename(file)).sort()).toEqual(['bulk-0000.txt', second].sort());
  expect(await fs.readdir(f.target)).toHaveLength(1002);
}, 30000);
