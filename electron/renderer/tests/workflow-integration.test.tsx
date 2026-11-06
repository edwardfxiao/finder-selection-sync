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

const workflowNames = { orphans: 'Clean by reference', tags: 'Finder tags', list: 'Organize by list', filter: 'Filter files', compare: 'Compare folders' };
for (const mode of ['orphans', 'tags', 'list', 'filter', 'compare'] as const) {
  it(`${mode}: sidebar navigation restores checked files and planned tags, including an intentional empty selection`, async () => {
    const f = await setup(mode, { filterAction: 'tags', listAction: 'tags', tagAction: 'color', colors: ['red'], ...(mode === 'compare' ? { matchBy: 'stem' } : {}) });
    const user = userEvent.setup();
    render(<App />);
    const name = mode === 'compare' ? 'Process Folder A / A.NEF' : mode === 'list' || mode === 'orphans' ? 'Process C.txt' : 'Process A.txt';
    await screen.findByRole('checkbox', { name });
    await user.click(screen.getByRole('button', { name: 'Deselect all' }));
    await user.click(screen.getByRole('checkbox', { name }));
    const firstPlan = f.service.active!.id;
    for (const destination of ['Activity', mode === 'filter' ? 'Finder tags' : 'Filter files']) {
      await user.click(screen.getByRole('button', { name: destination }));
      if (destination === 'Activity') await screen.findByText('No activity yet');
      else await ready();
      await user.click(screen.getByRole('button', { name: workflowNames[mode] }));
      const checkbox = await screen.findByRole('checkbox', { name });
      expect(checkbox.getAttribute('aria-checked')).toBe('true');
      expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(1);
      expect(f.service.active!.id).toBe(firstPlan);
      if (mode === 'tags') {
        expect(within(checkbox.closest<HTMLElement>('.file-row')!).getByRole('img', { name: 'Red' })).toBeTruthy();
        expect((action('tags', 1) as HTMLButtonElement).disabled).toBe(false);
      }
    }
    await user.click(screen.getByRole('button', { name: 'Deselect all' }));
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    await screen.findByText('No activity yet');
    await user.click(screen.getByRole('button', { name: workflowNames[mode] }));
    expect((await screen.findByRole('checkbox', { name })).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('checkbox', { name: /^Process /, checked: true })).toBeNull();
    expect(f.api.execute).not.toHaveBeenCalled();
  });
}

it('returning to a workflow reuses its preview and checked files until explicit Refresh discovers external changes', async () => {
  const f = await setup('filter', { colors: ['red'] }), user = userEvent.setup();
  render(<App />); await ready();
  const firstPlan = f.service.active!.id;
  for (const name of ['A.txt', 'B.txt']) await user.click(screen.getByRole('checkbox', { name: `Process ${name}` }));
  await user.click(screen.getByRole('button', { name: 'Activity' }));
  await screen.findByText('No activity yet');
  f.tags.set(path.join(f.target, 'B.txt'), ['Red\n6']);
  await fs.writeFile(path.join(f.target, 'E.txt'), 'new file');
  await user.click(screen.getByRole('button', { name: 'Filter files' }));
  expect((await ready()).getAttribute('aria-checked')).toBe('true');
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(2);
  expect((screen.getByRole('checkbox', { name: 'Process B.txt' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('checkbox', { name: 'Process B.txt' }).getAttribute('aria-checked')).toBe('true');
  expect(f.service.active!.id).toBe(firstPlan);
  expect(f.api.preview).toHaveBeenCalledTimes(1);
  expect((action('filter', 2) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('checkbox', { name: 'Process E.txt' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect((await ready()).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('checkbox', { name: 'Process E.txt' }).getAttribute('aria-checked')).toBe('false');
  await user.click(screen.getByRole('button', { name: 'Activity' }));
  await screen.findByText('No activity yet');
  await user.click(screen.getByRole('button', { name: 'Filter files' }));
  expect((await ready()).getAttribute('aria-checked')).toBe('false');
  expect(f.api.execute).not.toHaveBeenCalled();
});

it('workflow navigation restores each search, page, collapsed state and scroll position without rescanning', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  await Promise.all(Array.from({ length: 101 }, (_, index) => fs.writeFile(path.join(f.target, `Extra-${String(index).padStart(3, '0')}.txt`), 'fixture')));
  const { container } = render(<App />); await ready();
  await user.type(screen.getByRole('searchbox'), 'Extra-');
  await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('checkbox', { name: 'Process Extra-100.txt' }));
  await user.click(screen.getByRole('button', { name: /Collapse folder options$/ }));
  const workspace = () => container.querySelector<HTMLElement>('.workspace-scroll')!;
  workspace().scrollTop = 190;
  await user.click(screen.getByRole('button', { name: 'Organize by list' })); await ready();
  await user.type(screen.getByRole('searchbox'), 'A.txt');
  workspace().scrollTop = 75;
  for (const destination of ['Filter files', 'Organize by list']) {
    await user.click(screen.getByRole('button', { name: destination }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Reset workflow' }) as HTMLButtonElement).disabled).toBe(false));
    if (destination === 'Filter files') {
      expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Extra-');
      expect(screen.getByRole('checkbox', { name: 'Matches only' }).getAttribute('aria-checked')).toBe('false');
      expect(screen.getByRole('checkbox', { name: 'Process Extra-100.txt' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.queryByRole('checkbox', { name: 'Process Extra-000.txt' })).toBeNull();
      expect(screen.getByRole('button', { name: /Show all folder options$/ })).toBeTruthy();
      expect(workspace().scrollTop).toBe(190);
    } else {
      expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('A.txt');
      expect(screen.getByRole('button', { name: /Collapse folder options$/ })).toBeTruthy();
      expect(workspace().scrollTop).toBe(75);
    }
  }
  await user.click(screen.getByRole('button', { name: 'Activity' })); await screen.findByText('No activity yet');
  await user.click(screen.getByRole('button', { name: 'Organize by list' })); await ready();
  expect(workspace().scrollTop).toBe(75);
  expect(f.api.preview).toHaveBeenCalledTimes(2);
  expect(f.api.execute).not.toHaveBeenCalled();
});

it('a cancelled tag metadata request cannot reopen its dialog and leaves the selection available for navigation', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  render(<App />); await ready();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  const selectedRow = f.service.active!.rows.find((row: Row) => row.name === 'A.txt');
  let finish!: (rows: Row[]) => void;
  f.api.selectedTags.mockImplementationOnce(() => new Promise<Row[]>(resolve => { finish = resolve; }));
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(f.api.cancel).toHaveBeenCalled();
  await act(async () => finish([{ ...selectedRow, currentTags: ['Blue\n4'] }]));
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Organize by list' }));
  await ready();
  expect(screen.getByRole('button', { name: 'Organize by list' }).getAttribute('aria-current')).toBe('page');
  await user.click(screen.getByRole('button', { name: 'Filter files' }));
  expect((await ready()).getAttribute('aria-checked')).toBe('true');
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(1);
  expect(f.api.tagSelected).not.toHaveBeenCalled();
  expect(f.api.execute).not.toHaveBeenCalled();
});

it('refresh shortcuts wait for cancelled tag reads to finish without losing the preview or selection', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  render(<App />); await ready();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  const planId = f.service.active!.id, scans = f.api.preview.mock.calls.length;
  let release!: () => void;
  f.readTags.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return []; });
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect((screen.getByRole('button', { name: 'Filter files' }) as HTMLButtonElement).disabled).toBe(true);
  try {
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(f.api.preview).toHaveBeenCalledTimes(scans);
  } finally {
    await act(async () => release());
  }
  await waitFor(() => expect((screen.getByRole('button', { name: 'Filter files' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole('alert')).toBeNull();
  expect((await ready()).getAttribute('aria-checked')).toBe('true');
  expect(f.service.active!.id).toBe(planId);
  fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(f.api.preview).toHaveBeenCalledTimes(scans + 1));
  await ready();
});

it('cached thumbnails wait for native preview activation and load after returning to a workflow', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  const photo = path.join(f.target, 'Photo.png');
  await fs.writeFile(photo, 'thumbnail fixture');
  f.api.image.mockImplementation(async (file: string) => {
    if (!f.service.active?.rows.some((row: Row) => row.file === file)) throw new Error('Preview is not active');
    return { dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', width: 1, height: 1 };
  });
  const { container } = render(<App />); await ready();
  await waitFor(() => expect(container.querySelector('.image-thumbnail img')).toBeTruthy());
  await user.click(screen.getByRole('checkbox', { name: 'Process Photo.png' }));
  await user.click(screen.getByRole('button', { name: 'Activity' }));
  await screen.findByText('No activity yet');
  const requests = f.api.image.mock.calls.length;
  let release!: () => void;
  f.api.activate.mockImplementationOnce(async id => {
    await new Promise<void>(resolve => { release = resolve; });
    return await f.service.activate(id) as Plan | null;
  });
  await user.click(screen.getByRole('button', { name: 'Filter files' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  try {
    expect(f.api.image).toHaveBeenCalledTimes(requests);
  } finally {
    await act(async () => release());
  }
  await waitFor(() => expect(container.querySelector('.image-thumbnail img')).toBeTruthy());
  expect(screen.getByRole('checkbox', { name: 'Process Photo.png' }).getAttribute('aria-checked')).toBe('true');
  expect(f.api.preview).toHaveBeenCalledTimes(1);
});

it('tag dialogs explain hard-link restrictions before enabling any changes and keep list selection intact', async () => {
  const f = await setup('list'), user = userEvent.setup();
  await fs.link(path.join(f.target, 'A.txt'), path.join(f.root, 'other-path.txt'));
  render(<App />); await ready();
  await user.click(screen.getByRole('button', { name: 'Deselect all' }));
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  const scans = f.api.preview.mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect((await dialog.findByRole('alert')).textContent).toContain('Deselect those files to continue. No tags have been changed.');
  expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(true);
  expect(dialog.queryByRole('img')).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('checkbox', { name: 'Process A.txt' }).getAttribute('aria-checked')).toBe('true');
  expect(f.api.preview).toHaveBeenCalledTimes(scans);
  expect(f.writeTags).not.toHaveBeenCalled();
});

it('Filter files combines controls, previews automatically, and clears selection whenever conditions change', async () => {
  const f = await setup('filter', { base: '', list: '' }), user = userEvent.setup();
  render(<App />); await ready();
  expect(screen.getByRole('button', { name: 'Filter files' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByText('REFERENCE FOLDER')).toBeNull();
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: false })).toHaveLength(4);
  expect((action('filter', 0) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Filename contains'), { target: { value: '.txt' } });
  fireEvent.change(screen.getByLabelText('Filename does not contain'), { target: { value: 'D.' } });
  fireEvent.change(screen.getByLabelText('Include extensions'), { target: { value: '.TXT, jpg' } });
  fireEvent.change(screen.getByLabelText('Exclude extensions'), { target: { value: '.jpg' } });
  fireEvent.change(screen.getByLabelText('Filename regular expression'), { target: { value: '^[AB]\\.txt$' } });
  await waitFor(() => expect(candidateNames(f.service)).toEqual(['A.txt', 'B.txt']), { timeout: 5000 });
  await ready();
  expect(screen.getAllByRole('checkbox', { name: /^Process / })).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Select all results' }));
  expect((action('filter', 2) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole('checkbox', { name: 'Invert filter results' }));
  await screen.findByRole('checkbox', { name: 'Process C.txt' });
  expect(candidateNames(f.service)).toEqual(['C.txt', 'D.txt']);
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: false })).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Invert selection' }));
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Invert selection' }));
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: false })).toHaveLength(2);
  expect(f.api.execute).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await ready();
  expect(candidateNames(f.service)).toEqual(['A.txt', 'B.txt', 'C.txt', 'D.txt']);
  expect((screen.getByLabelText('Filename regular expression') as HTMLInputElement).value).toBe('');
});

it('Filter files tags only checked matches through an independent dialog and keeps cleanup rules unchanged', async () => {
  const f = await setup('filter', { colors: ['green', 'red'] }), user = userEvent.setup();
  render(<App />); await ready();
  const initialPlan = f.service.active!.id;
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  await user.click(screen.getByRole('checkbox', { name: 'Process B.txt' }));
  await user.click(screen.getByRole('checkbox', { name: 'Process B.txt' }));
  expect(screen.queryByRole('combobox', { name: 'Selected files' })).toBeNull();
  expect((action('filter', 1) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog();
  expect(dialog.getByText('Current → After')).toBeTruthy();
  expect(dialog.getByText('A.txt')).toBeTruthy();
  expect(dialog.queryByText('B.txt')).toBeNull();
  expect(dialog.getAllByRole('img', { name: 'Blue' })).toHaveLength(2);
  expect(dialog.getByRole('img', { name: 'Green' })).toBeTruthy();
  expect(f.api.selectedTags).toHaveBeenCalledExactlyOnceWith(initialPlan, [expect.any(String)]);
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Orange' }));
  await user.keyboard('{Escape}');
  await user.click(dialog.getByRole('checkbox', { name: 'Keep existing tags' }));
  expect(dialog.getAllByRole('img', { name: 'Blue' })).toHaveLength(1);
  const desired = ['Green\n2', 'Red\n6', 'Orange\n7'];
  expect(f.service.active!.id).toBe(initialPlan);
  expect(f.service.active!.options.filterAction).toBe('trash');
  expect(f.api.preview).toHaveBeenCalledTimes(1);
  f.confirm.mockResolvedValueOnce(false);
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(false));
  expect(f.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'tags', files: [path.join(f.target, 'A.txt')] }));
  expect(f.writeTags).not.toHaveBeenCalled();
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await ready()).getAttribute('aria-checked')).toBe('true');
  expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'), desired);
  expect(f.trashFile).not.toHaveBeenCalled();
  expect(f.tags.has(path.join(f.target, 'B.txt'))).toBe(false);
  expect(f.service.active!.options.filterAction).toBe('trash');
  expect((action('filter', 1) as HTMLButtonElement).disabled).toBe(false);
});

it('Filter files keeps checked files when colors are deselected or the independent tag dialog is cancelled', async () => {
  const f = await setup('filter', { colors: ['green'] }), user = userEvent.setup();
  f.tags.set(path.join(f.target, 'B.txt'), ['Green\n2']);
  render(<App />); await ready();
  expect(screen.getByText('4 scanned · 4 matches')).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog();
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitem', { name: 'Deselect colors' }));
  await user.keyboard('{Escape}');
  expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(true);
  expect(dialog.getByText('No colors chosen. Existing file tags will stay unchanged.')).toBeTruthy();
  expect(dialog.getByRole('listitem').querySelector('.tag-change-arrow')).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Red' }));
  await user.keyboard('{Escape}');
  expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('checkbox', { name: 'Process A.txt' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getAllByRole('checkbox', { name: /^Process / })).toHaveLength(4);
  expect(f.api.preview).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Filename contains'), { target: { value: 'A' } });
  await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Process / })).toHaveLength(1));
  expect((await ready()).getAttribute('aria-checked')).toBe('false');
  expect(f.api.tagSelected).not.toHaveBeenCalled();
  expect(f.writeTags).not.toHaveBeenCalled();
});

it('Organize by list tags kept or extension-protected files without switching its cleanup rules', async () => {
  const f = await setup('list', { includeExt: '.jpg', colors: [] }), user = userEvent.setup();
  const { container } = render(<App />); await ready();
  expect(screen.getByRole('combobox', { name: 'List purpose' }).textContent).toBe('Keep listed files');
  expect(screen.queryByRole('combobox', { name: 'Selected files' })).toBeNull();
  const checkbox = screen.getByRole('checkbox', { name: 'Process A.txt' });
  expect((checkbox as HTMLButtonElement).disabled).toBe(false);
  await user.click(checkbox);
  await user.type(screen.getByRole('searchbox'), 'A.txt');
  await user.click(screen.getByRole('button', { name: /Collapse folder options$/ }));
  const workspace = container.querySelector<HTMLElement>('.workspace-scroll')!;
  workspace.scrollTop = 225;
  expect((action('list', 0) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog();
  expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(true);
  expect(dialog.getAllByRole('img', { name: 'Blue' })).toHaveLength(1);
  expect(dialog.queryByText('Unchanged')).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Red' }));
  await user.click(screen.getByRole('menuitem', { name: 'Deselect colors' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Red' }));
  await user.keyboard('{Escape}');
  expect(dialog.getAllByRole('img', { name: 'Blue' })).toHaveLength(2);
  expect(dialog.getByRole('listitem').querySelector('.tag-change-arrow')).not.toBeNull();
  expect(f.api.preview).toHaveBeenCalledTimes(1);
  let answer!: (accepted: boolean) => void;
  f.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve; }));
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect(answer).toBeTypeOf('function'));
  expect(container.querySelector('.list-extension-notice')).not.toBeNull();
  expect(container.querySelector('.progress-panel')).toBeNull();
  expect(workspace.scrollTop).toBe(225);
  await act(async () => answer(false));
  await waitFor(() => expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(false));
  expect(container.querySelector('.workspace-settings')?.getAttribute('data-collapsed')).toBe('true');
  expect(container.querySelector<HTMLInputElement>('.search input')?.value).toBe('A.txt');
  expect(workspace.scrollTop).toBe(225);
  expect(f.writeTags).not.toHaveBeenCalled();
  const write = f.writeTags.getMockImplementation()!;
  let finishWrite!: () => void;
  f.writeTags.mockImplementationOnce(async (file, values) => {
    await new Promise<void>(resolve => { finishWrite = resolve; });
    return write(file, values);
  });
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect(finishWrite).toBeTypeOf('function'));
  expect(container.querySelector('.list-extension-notice')).not.toBeNull();
  expect(container.querySelector('.progress-panel')).toBeNull();
  expect(container.querySelector('.workspace-settings')?.getAttribute('data-collapsed')).toBe('true');
  expect(workspace.scrollTop).toBe(225);
  await act(async () => finishWrite());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await ready()).getAttribute('aria-checked')).toBe('true');
  expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'), ['Blue\n4', 'Red\n6']);
  const updatedRow = within(screen.getByRole('checkbox', { name: 'Process A.txt' }).closest<HTMLElement>('.file-row')!);
  expect(updatedRow.getByRole('img', { name: 'Blue' })).toBeTruthy();
  expect(updatedRow.getByRole('img', { name: 'Red' })).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('A.txt');
  expect(container.querySelector('.workspace-settings')?.getAttribute('data-collapsed')).toBe('true');
  expect(workspace.scrollTop).toBe(225);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Set tags' })));
  expect(f.trashFile).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /Show all folder options$/ }));
  expect(screen.getByRole('combobox', { name: 'List purpose' }).textContent).toBe('Keep listed files');
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.list).toMatchObject({ listMode: 'keep', includeExt: '.jpg', listAction: 'trash' });
  expect((action('list', 0) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Filter files' })); await ready();
  await user.click(screen.getByRole('button', { name: 'Organize by list' }));
  expect((await ready()).getAttribute('aria-checked')).toBe('true');
});

it('the list tag menu separates color deselection from clearing file tags, including an empty color choice', async () => {
  const f = await setup('list', { colors: ['green'], includeExt: '.jpg' }), user = userEvent.setup();
  const originalTags = ['Green\n2', 'Red\n6', 'Blue\n4'];
  f.tags.set(path.join(f.target, 'A.txt'), originalTags);
  f.tags.set(path.join(f.target, 'B.txt'), ['Red\n6']);
  render(<App />); await ready();
  for (const name of ['A.txt', 'C.txt']) await user.click(screen.getByRole('checkbox', { name: `Process ${name}` }));
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  let dialog = await tagsDialog();
  expect(dialog.queryByText('Already has the chosen tags')).toBeNull();
  expect(dialog.queryByText('B.txt')).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitem', { name: 'Deselect colors' }));
  expect(screen.getByRole('menuitem', { name: 'Deselect colors' }).hasAttribute('data-disabled')).toBe(true);
  expect(screen.getByRole('menuitem', { name: 'Clear file tags' }).hasAttribute('data-disabled')).toBe(false);
  await user.keyboard('{Escape}');
  const unchanged = dialog.getByText('A.txt').closest('li')!;
  expect(unchanged.querySelector('.tag-change-arrow')).toBeNull();
  expect(within(unchanged).getAllByRole('img')).toHaveLength(3);
  expect(dialog.getByText('No colors chosen. Existing file tags will stay unchanged.')).toBeTruthy();
  expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitem', { name: 'Clear file tags' }));
  expect(dialog.getByRole('heading', { name: 'Clear tags from selected files (2)' })).toBeTruthy();
  const removal = dialog.getByText('A.txt').closest('li')!;
  expect(removal.querySelector('.tag-change-arrow')).not.toBeNull();
  expect(within(removal).getByRole('img', { name: 'No tags' })).toBeTruthy();
  expect(dialog.queryByText('Already untagged')).toBeNull();
  expect((dialog.getByRole('button', { name: 'Clear file tags' }) as HTMLButtonElement).disabled).toBe(false);
  expect(f.writeTags).not.toHaveBeenCalled();
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(f.tags.get(path.join(f.target, 'A.txt'))).toEqual(originalTags);
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  dialog = await tagsDialog();
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitem', { name: 'Clear file tags' }));
  f.confirm.mockResolvedValueOnce(false);
  await user.click(dialog.getByRole('button', { name: 'Clear file tags' }));
  await waitFor(() => expect((dialog.getByRole('button', { name: 'Clear file tags' }) as HTMLButtonElement).disabled).toBe(false));
  expect(f.writeTags).not.toHaveBeenCalled();
  await user.click(dialog.getByRole('button', { name: 'Clear file tags' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await ready();
  expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'), []);
  expect(f.tags.get(path.join(f.target, 'B.txt'))).toEqual(['Red\n6']);
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(2);
  expect(f.trashFile).not.toHaveBeenCalled();
});

it('Organize by list clears tags without selecting colors, previews removal and keeps unchecked files unchanged', async () => {
  const f = await setup('list', { colors: [], includeExt: '.jpg' }), user = userEvent.setup();
  f.tags.set(path.join(f.target, 'B.txt'), ['Red\n6']);
  render(<App />); await ready();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog();
  await user.click(dialog.getByRole('combobox', { name: 'Action' }));
  await user.click(await screen.findByRole('option', { name: 'Clear file tags' }));
  expect(dialog.queryByRole('button', { name: 'Tags' })).toBeNull();
  const filePreview = within(dialog.getByRole('listitem'));
  expect(filePreview.getByRole('img', { name: 'Blue' })).toBeTruthy();
  expect(filePreview.getByRole('img', { name: 'No tags' })).toBeTruthy();
  expect(dialog.getByRole('listitem').querySelector('.tag-change-arrow')).not.toBeNull();
  expect((dialog.getByRole('button', { name: 'Clear file tags' }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(dialog.getByRole('button', { name: 'Clear file tags' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await ready()).getAttribute('aria-checked')).toBe('true');
  expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'), []);
  expect(f.tags.get(path.join(f.target, 'B.txt'))).toEqual(['Red\n6']);
  const updatedRow = within(screen.getByRole('checkbox', { name: 'Process A.txt' }).closest<HTMLElement>('.file-row')!);
  expect(updatedRow.getByRole('img', { name: 'No tags' })).toBeTruthy();
  expect(updatedRow.queryByRole('img', { name: 'Blue' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'List purpose' }).textContent).toBe('Keep listed files');
  expect((action('list', 0) as HTMLButtonElement).disabled).toBe(true);
  expect(f.trashFile).not.toHaveBeenCalled();
});

it('Organize by list can tag a mixed selection, while Trash still processes only checked cleanup candidates', async () => {
  const f = await setup('list', { colors: ['red'] }), user = userEvent.setup();
  render(<App />); await ready();
  await user.click(screen.getByRole('button', { name: 'Deselect all' }));
  for (const name of ['A.txt', 'C.txt']) await user.click(screen.getByRole('checkbox', { name: `Process ${name}` }));
  expect((action('list', 1) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog();
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await ready();
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(2);
  expect(f.writeTags.mock.calls.map(call => path.basename(call[0]))).toEqual(['A.txt','C.txt']);
  expect(f.trashFile).not.toHaveBeenCalled();
  await user.click(action('list', 1));
  await screen.findByRole('heading', { name: 'Processing complete' });
  expect(f.trashFile).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'C.txt'));
  expect(await fs.readFile(path.join(f.target, 'A.txt'), 'utf8')).toBe('fixture A.txt');
});

it('Compare folders reviews full-name matches on both sides and independently tags only checked files', async () => {
  const f = await setup('compare'), user = userEvent.setup();
  await fs.mkdir(path.join(f.base, 'sub'));
  await fs.writeFile(path.join(f.base, 'sub/A.txt'), 'base fixture');
  render(<App />);
  const a = await screen.findByRole('checkbox', { name: 'Process Folder A / sub/A.txt' });
  expect(a.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('checkbox', { name: 'Process Folder B / A.txt' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('combobox', { name: 'Match by' }).textContent).toBe('Full filename');
  expect(screen.getAllByRole('checkbox', { name: /^Process / })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Tags' })).toBeNull();
  expect((screen.getByRole('button', { name: 'Set tags on 0 files' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(a);
  const originalPlan = f.service.active!.id;
  await user.click(screen.getByRole('button', { name: 'Set tags on 1 files' }));
  const dialog = await tagsDialog();
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitem', { name: 'Deselect colors' })); await user.keyboard('{Escape}');
  expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(true);
  expect(f.service.active!.id).toBe(originalPlan);
  await user.click(dialog.getByRole('button', { name: 'Tags' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Red' })); await user.keyboard('{Escape}');
  expect(dialog.getByRole('img', { name: 'Red' })).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await screen.findByRole('checkbox', { name: 'Process Folder A / sub/A.txt' })).getAttribute('aria-checked')).toBe('true');
  expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.base, 'sub/A.txt'), ['Red\n6']);
  expect(f.tags.get(path.join(f.target, 'A.txt'))).toEqual(['Blue\n4']);
  expect(f.trashFile).not.toHaveBeenCalled();
  expect(f.api.execute).not.toHaveBeenCalled();
});

it('Compare folders changes matching and unique-side rules without carrying checkboxes into new results', async () => {
  const f = await setup('compare', { matchBy: 'stem' }), user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('checkbox', { name: 'Process Folder A / A.NEF' }));
  await user.click(screen.getByRole('combobox', { name: 'Compare results' }));
  await user.click(screen.getByRole('option', { name: 'Only in folder B' }));
  await screen.findByRole('checkbox', { name: 'Process Folder B / C.txt' });
  expect(screen.getAllByRole('checkbox', { name: /^Process / })).toHaveLength(2);
  expect(screen.queryByRole('checkbox', { name: /^Process /, checked: true })).toBeNull();
  expect(f.api.execute).not.toHaveBeenCalled();
});

it('Appearance applies native theme preferences without rescanning or clearing checked files', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  render(<App />); await ready();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  const previews = f.api.preview.mock.calls.length;
  for (const [name, theme] of [['Dark', 'dark'], ['Light', 'light'], ['Follow system', 'system']]) {
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('menuitemradio', { name }));
    await waitFor(() => expect(f.api.setTheme).toHaveBeenLastCalledWith(theme));
    expect(localStorage.getItem('finder-appearance')).toBe(theme);
    expect(screen.getByRole('checkbox', { name: 'Process A.txt' }).getAttribute('aria-checked')).toBe('true');
  }
  expect(f.api.preview).toHaveBeenCalledTimes(previews);
});

it('Filter files validates ranges and regex in the GUI and recovers without modifying files', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  await fs.utimes(path.join(f.target, 'A.txt'), new Date('2026-03-08T12:00:00'), new Date('2026-03-08T12:00:00'));
  render(<App />); await ready();
  for (const label of ['Modified from', 'Modified through']) {
    await user.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-day')).toBe(true));
    await user.click(screen.getByRole('combobox', { name: 'Choose the Year' }));
    await user.click(await screen.findByRole('option', { name: '2026' }));
    await user.click(screen.getByRole('combobox', { name: 'Choose the Month' }));
    await user.click(await screen.findByRole('option', { name: 'Mar' }));
    await user.click(screen.getByRole('button', { name: /Sunday, March 8th, 2026/ }));
  }
  await waitFor(() => expect(candidateNames(f.service)).toEqual(['A.txt']));
  await ready();
  await user.click(screen.getByRole('combobox', { name: 'Unit' }));
  await user.click(await screen.findByRole('option', { name: 'B' }));
  fireEvent.change(screen.getByLabelText('Minimum size'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Maximum size'), { target: { value: '100' } });
  await ready();
  await waitFor(() => expect(f.api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ sizeMin: '1', sizeMax: '100', sizeUnit: 'B' })));
  fireEvent.change(screen.getByLabelText('Minimum size'), { target: { value: '101' } });
  expect(await screen.findByText('Use non-negative sizes. Minimum size must not exceed maximum size.')).toBeTruthy();
  expect((action('filter', 0) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await ready();
  fireEvent.change(screen.getByLabelText('Filename regular expression'), { target: { value: '[' } });
  expect(await screen.findByText('Invalid regular expression. Check the pattern and omit / delimiters.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filename regular expression'), { target: { value: '^A\\.txt$' } });
  await ready();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(candidateNames(f.service)).toEqual(['A.txt']);
  expect(f.trashFile).not.toHaveBeenCalled();
});

it('Filter files only moves checked matches after confirmation; reset clears criteria and keeps other workflows', async () => {
  const f = await setup('filter', { nameRegex: '^[AB]\\.txt$' }), user = userEvent.setup();
  const saved = JSON.parse(localStorage.getItem('finder-workbench')!);
  render(<App />); await ready();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  f.confirm.mockResolvedValueOnce(false);
  await user.click(action('filter', 1));
  await waitFor(() => expect((action('filter', 1) as HTMLButtonElement).disabled).toBe(false));
  expect(f.trashFile).not.toHaveBeenCalled();
  await user.click(action('filter', 1));
  expect(await screen.findByRole('heading', { name: 'Processing complete' })).toBeTruthy();
  expect(f.trashFile).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'));
  expect(await fs.readdir(f.target)).toEqual(['B.txt', 'C.txt', 'D.txt']);
  expect(f.service.history[0]).toMatchObject({ mode: 'filter', action: 'trash', completed: 1 });
  await user.click(screen.getByRole('button', { name: 'Preview again' }));
  await screen.findByRole('checkbox', { name: 'Process B.txt' });
  await user.click(screen.getByRole('button', { name: 'Reset workflow' }));
  await waitFor(() => expect(f.service.active).toBeNull());
  const current = JSON.parse(localStorage.getItem('finder-workbench')!);
  expect(current.config.filter).toEqual(defaults().filter);
  expect(current.config.tags).toEqual(saved.config.tags);
  expect(screen.queryByRole('checkbox', { name: /^Process / })).toBeNull();
});

it('Filter files exposes recursion and depth without More options, and rescans when either changes', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  await fs.mkdir(path.join(f.target, 'nested', 'deep'), { recursive: true });
  await fs.writeFile(path.join(f.target, 'nested', 'E.txt'), 'nested');
  await fs.writeFile(path.join(f.target, 'nested', 'deep', 'F.txt'), 'deep');
  render(<App />); await ready();
  expect(f.service.active!.rows).toHaveLength(6);
  const depth = screen.getByLabelText('Maximum depth') as HTMLInputElement;
  fireEvent.change(depth, { target: { value: '1' } });
  await waitFor(() => expect(f.service.active!.rows).toHaveLength(5));
  await user.click(screen.getByRole('checkbox', { name: 'Include subfolders' }));
  await waitFor(() => expect(f.service.active!.rows).toHaveLength(4));
  expect(depth.disabled).toBe(true);
  await user.click(screen.getByRole('checkbox', { name: 'Include subfolders' }));
  await waitFor(() => expect(f.service.active!.rows).toHaveLength(5));
  expect(depth.value).toBe('1');
});

it('Filter files inverts matching checkboxes across pages and respects the current search', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  await Promise.all(Array.from({ length: 105 }, (_, i) => fs.writeFile(path.join(f.target, `image-${String(i).padStart(3, '0')}.txt`), 'image')));
  render(<App />); await ready();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a file' }), { target: { value: 'image-' } });
  await user.click(screen.getByRole('button', { name: 'Invert selection' }));
  expect((action('filter', 105) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(5);
  await user.click(screen.getByRole('button', { name: 'Invert selection' }));
  expect((action('filter', 0) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a file' }), { target: { value: 'A.txt' } });
  await user.click(screen.getByRole('button', { name: 'Invert selection' }));
  expect((action('filter', 1) as HTMLButtonElement).disabled).toBe(false);
  expect(f.trashFile).not.toHaveBeenCalled();
});

for (const mode of ['orphans', 'tags', 'list'] as const) {
  it(`${mode}: Reset workflow clears paths, lists and the executable plan and restores default rules in this workflow`, async () => {
    const f = await setup(mode, { recursive: false, listSource: 'text', listText: 'A.txt\nB.txt' }), user = userEvent.setup();
    const saved = JSON.parse(localStorage.getItem('finder-workbench')!);
    const { container } = render(<App />); await ready();
    await user.click(screen.getByRole('button', { name: /: Collapse folder options$/ }));
    const reset = screen.getByRole('button', { name: 'Reset workflow' });
    await user.click(reset);
    expect(screen.getByRole('button', { name: 'Reset workflow' })).toBe(reset);
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.workspace-settings')?.hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /^Process / })).toBeNull();
    expect((action(mode, 0) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(f.service.active).toBeNull());
    await waitFor(async () => expect(await fs.readdir(f.tempRoot)).toEqual([]));
    const cleared = JSON.parse(localStorage.getItem('finder-workbench')!);
    expect(cleared.config).toEqual({ ...saved.config, [mode]: defaults()[mode] });
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

it('Set tags keeps the color menu open for multiple selections, previews them and writes only checked files', async () => {
  const f = await setup('tags'), user = userEvent.setup();
  render(<App />); await ready();
  await user.click(screen.getByRole('combobox', { name: 'Action' }));
  await user.click(await screen.findByRole('option', { name: 'Set tags' }));
  await ready();
  const trigger = screen.getByRole('button', { name: 'Tags' });
  expect(trigger.querySelector('.tag-dot.color-2')).toBeTruthy();
  await user.click(trigger);
  const list = await screen.findByRole('menu', { name: 'Tags' });
  const names = ['Gray', 'Green', 'Purple', 'Blue', 'Yellow', 'Red', 'Orange'];
  for (const [index, name] of names.entries()) expect(within(list).getByRole('menuitemcheckbox', { name }).querySelector(`.tag-dot.color-${index + 1}`)).toBeTruthy();
  await user.click(within(list).getByRole('menuitemcheckbox', { name: 'Red' }));
  expect(within(list).getByRole('menuitemcheckbox', { name: 'Green', checked: true })).toBeTruthy();
  expect(within(list).getByRole('menuitemcheckbox', { name: 'Red', checked: true })).toBeTruthy();
  await user.click(within(list).getByRole('menuitemcheckbox', { name: 'Blue' }));
  const clear = within(list).getByRole('menuitem', { name: 'Deselect colors' });
  await user.click(clear);
  expect(within(list).getAllByRole('menuitemcheckbox', { checked: false })).toHaveLength(7);
  expect(clear.getAttribute('aria-disabled')).toBe('true');
  await waitFor(() => expect(f.service.active).toBeNull());
  expect(f.writeTags).not.toHaveBeenCalled();
  expect(trigger.textContent).toBe('Choose tags');
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.tags.colors).toEqual([]);
  await user.click(within(list).getByRole('menuitemcheckbox', { name: 'Red' }));
  await user.click(within(list).getByRole('menuitemcheckbox', { name: 'Blue' }));
  expect(clear.getAttribute('aria-disabled')).not.toBe('true');
  expect(screen.getByRole('menu', { name: 'Tags' })).toBe(list);
  await user.keyboard('{Escape}');
  await ready();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.querySelector('.tag-dot.color-6')).toBeTruthy();
  expect(trigger.querySelector('.tag-dot.color-4')).toBeTruthy();
  expect(trigger.querySelector('.tag-dot.color-2')).toBeNull();
  expect(trigger.textContent).toBe('2 tags');
  expect(f.service.active!.rows.find((row: { name: string }) => row.name === 'A.txt').nextTags).toEqual(['Red\n6', 'Blue\n4']);
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.tags.colors).toEqual(['red', 'blue']);
  expect(f.writeTags).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox', { name: 'Process B.txt' }));
  await user.click(action('tags', 1));
  expect(await screen.findByRole('heading', { name: 'Processing complete' })).toBeTruthy();
  expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'), ['Red\n6', 'Blue\n4']);
  expect(f.tags.get(path.join(f.base, 'A.NEF'))).toEqual(['Green\n2']);
  expect(f.tags.get(path.join(f.target, 'B.txt'))).toBeUndefined();
  expect(f.service.history[0].records[0].afterTags).toEqual(['Red\n6', 'Blue\n4']);
  expect(f.trashFile).not.toHaveBeenCalled();
});

it('tag choices loop with arrow keys, leave on Tab, and an empty selection disables processing until tags are chosen', async () => {
  const f = await setup('tags', { tagAction: 'color' }), user = userEvent.setup();
  render(<App />); await ready();
  const trigger = screen.getByRole('button', { name: 'Tags' });
  await user.click(trigger);
  const first = await screen.findByRole('menuitemcheckbox', { name: 'Green' });
  const last = screen.getByRole('menuitemcheckbox', { name: 'Gray' });
  const clear = screen.getByRole('menuitem', { name: 'Deselect colors' });
  await user.keyboard('{End}');
  await waitFor(() => expect(document.activeElement).toBe(last));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(document.activeElement).toBe(clear));
  await user.keyboard('{ArrowUp}');
  await waitFor(() => expect(document.activeElement).toBe(last));
  await user.keyboard('{Enter}');
  expect(last.getAttribute('aria-checked')).toBe('true');
  await user.keyboard(' ');
  expect(last.getAttribute('aria-checked')).toBe('false');
  await user.keyboard('{Home}');
  await waitFor(() => expect(document.activeElement).toBe(clear));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(document.activeElement).toBe(first));
  await user.keyboard('{Enter}');
  expect(first.getAttribute('aria-checked')).toBe('false');
  await user.tab();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Selection' })));
  await waitFor(() => expect(f.service.active).toBeNull());
  expect(trigger.textContent).toBe('Choose tags');
  expect(screen.getByText('Choose at least one tag to preview. To remove tags, use Clear tags.')).toBeTruthy();
  expect((action('tags', 0) as HTMLButtonElement).disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.tags.colors).toEqual([]);
  expect(f.writeTags).not.toHaveBeenCalled();
  await user.click(trigger);
  await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Blue' }));
  await user.tab({ shift: true });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Action' })));
  await ready();
  expect(f.service.active!.rows.find((row: { name: string }) => row.name === 'B.txt').nextTags).toEqual(['Blue\n4']);
  expect(screen.queryByRole('alert')).toBeNull();
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

it('Reset workflow clears filter-only inputs, dates and options even before any folder is chosen', async () => {
  const f = await setup('filter', {
    base: '', targets: [], list: '', nameContains: 'photo', nameExcludes: 'draft', nameRegex: '^photo',
    includeExt: '.jpg', excludeExt: '.png', invertFilter: true, sizeMin: '1', sizeMax: '50', sizeUnit: 'KB',
    modifiedFrom: '2026-11-03', modifiedTo: '2026-11-05', recursive: false, depth: '2', ignoreCase: false,
    filterAction: 'tags', colors: ['red', 'blue'], mergeTags: false,
  }), user = userEvent.setup();
  const saved = JSON.parse(localStorage.getItem('finder-workbench')!);
  render(<App />);
  const reset = screen.getByRole('button', { name: 'Reset workflow' });
  await waitFor(() => expect((reset as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText('Include extensions') as HTMLInputElement).value).toBe('.jpg');
  await user.click(reset);
  for (const label of ['Filename contains', 'Filename does not contain', 'Filename regular expression', 'Include extensions', 'Exclude extensions', 'Minimum size', 'Maximum size', 'Maximum depth']) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
  }
  expect((await screen.findByLabelText('Modified from')).textContent).toContain('Any date');
  expect((await screen.findByLabelText('Modified through')).textContent).toContain('Any date');
  expect((reset as HTMLButtonElement).disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config).toEqual({ ...saved.config, filter: defaults().filter });
  expect(f.api.execute).not.toHaveBeenCalled();
  expect(f.trashFile).not.toHaveBeenCalled(); expect(f.writeTags).not.toHaveBeenCalled();
  // A pending debounced edit is also discarded by Reset workflow.
  fireEvent.change(screen.getByLabelText('Include extensions'), { target: { value: '.jpg' } });
  expect((reset as HTMLButtonElement).disabled).toBe(false);
  await user.click(reset);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
  expect((screen.getByLabelText('Include extensions') as HTMLInputElement).value).toBe('');
  expect(f.service.active).toBeNull();
});

it('Clean by reference requires an explicit reference format before scanning and does not restore NEF after reset', async () => {
  const f = await setup('orphans', { referenceExt: '' }), user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Reset workflow' }) as HTMLButtonElement).disabled).toBe(false));
  const format = screen.getByRole('textbox', { name: 'Reference format' }) as HTMLInputElement;
  expect(format.value).toBe('');
  expect(format.placeholder).toBe('CR3, NEF, etc...');
  expect(f.api.preview).not.toHaveBeenCalled();
  expect((action('orphans', 0) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(format, { target: { value: '  ' } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
  expect(f.api.preview).not.toHaveBeenCalled();
  fireEvent.change(format, { target: { value: 'NEF' } });
  await ready();
  expect(candidateNames(f.service)).toEqual(['C.txt', 'D.txt']);
  await user.click(screen.getByRole('button', { name: 'Reset workflow' }));
  expect(format.value).toBe('');
  expect(screen.queryByRole('checkbox', { name: /^Process / })).toBeNull();
  expect(f.trashFile).not.toHaveBeenCalled(); expect(f.writeTags).not.toHaveBeenCalled();
});

it('global Reset all requires confirmation; Cancel and Escape keep folders, filters, selected files and the preview view', async () => {
  const f = await setup('filter', { includeExt: '.jpg' }), user = userEvent.setup();
  await fs.writeFile(path.join(f.target, 'photo.jpg'), 'image fixture');
  render(<App />);
  await user.click(await screen.findByRole('checkbox', { name: 'Process photo.jpg' }));
  await user.type(screen.getByRole('searchbox'), 'photo');
  await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
  const saved = localStorage.getItem('finder-workbench');
  const previews = f.api.preview.mock.calls.length;
  const reset = screen.getByRole('button', { name: 'Reset all' });
  for (const dismiss of ['Cancel', 'Escape']) {
    await user.click(reset);
    const dialog = within(await screen.findByRole('dialog', { name: 'Reset all workflows?' }));
    await waitFor(() => expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Cancel' })));
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    if (dismiss === 'Cancel') await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    else await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(reset));
    expect(localStorage.getItem('finder-workbench')).toBe(saved);
    expect((screen.getByLabelText('Include extensions') as HTMLInputElement).value).toBe('.jpg');
    expect(screen.getByRole('button', { name: f.target })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Process photo.jpg' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('photo');
    expect(screen.getByRole('checkbox', { name: 'Matches only' }).getAttribute('aria-checked')).toBe('false');
  }
  expect(f.api.preview).toHaveBeenCalledTimes(previews);
  expect(f.api.execute).not.toHaveBeenCalled();
  expect(f.trashFile).not.toHaveBeenCalled(); expect(f.writeTags).not.toHaveBeenCalled();
});

it('confirming global reset clears all five workflows and cached selections while keeping the current page, Activity, language and appearance', async () => {
  const f = await setup('filter', { includeExt: '.jpg', colors: ['red'], modifiedFrom: '2026-01-01' }), user = userEvent.setup();
  await fs.writeFile(path.join(f.target, 'photo.jpg'), 'image fixture');
  const history: Run = { id: 'earlier-run', mode: 'tags', action: 'tags', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', completed: 1, failed: 0, unattempted: 0, cancelled: false, error: null,
    records: [{ file: path.join(f.target, 'A.txt'), name: 'A.txt', action: 'tags', status: 'completed' }] };
  f.api.history.mockResolvedValue([history]);
  f.api.locales.mockResolvedValue({ ...catalog, current: 'en-GB', bundles: [{ ...catalog.bundles[0], code: 'en-GB', label: 'British English' }] });
  localStorage.setItem('finder-appearance', 'dark');
  const { container } = render(<App />);
  await user.click(await screen.findByRole('checkbox', { name: 'Process photo.jpg' }));
  await user.type(screen.getByRole('searchbox'), 'photo');
  await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
  await user.click(screen.getByRole('button', { name: 'Organize by list' })); await ready();
  await user.click(screen.getByRole('button', { name: 'Deselect all' }));
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  await user.type(screen.getByRole('searchbox'), 'A.txt');
  await user.click(screen.getByRole('button', { name: 'Filter files' }));
  expect((await screen.findByRole('checkbox', { name: 'Process photo.jpg' })).getAttribute('aria-checked')).toBe('true');
  await user.click(screen.getByRole('button', { name: /Collapse folder options$/ }));
  await user.click(screen.getByRole('button', { name: 'Reset all' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Reset all workflows?' })).getByRole('button', { name: 'Reset all' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Filter files' }).getAttribute('aria-current')).toBe('page');
  expect(JSON.parse(localStorage.getItem('finder-workbench')!)).toEqual({ mode: 'filter', config: defaults() });
  expect((screen.getByLabelText('Include extensions') as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText('Modified from').textContent).toContain('Any date');
  expect(container.querySelector('.workspace-settings')?.getAttribute('data-collapsed')).toBe('false');
  expect(screen.queryByRole('checkbox', { name: /^Process / })).toBeNull();
  expect((action('filter', 0) as HTMLButtonElement).disabled).toBe(true);
  expect(localStorage.getItem('finder-appearance')).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.lang).toBe('en-GB');
  expect(screen.getByRole('button', { name: 'Language' }).textContent).toBe('British English');
  // Reusing the same folder must start with a clean result view and no old checks.
  f.api.choose.mockResolvedValueOnce([f.target]);
  await user.click(screen.getByRole('button', { name: 'Choose: FOLDERS TO SEARCH' }));
  await ready();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('checkbox', { name: 'Matches only' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByRole('checkbox', { name: /^Process /, checked: true })).toBeNull();
  await user.click(screen.getByRole('button', { name: /Activity/ }));
  expect(screen.getByText('1 completed')).toBeTruthy();
  expect(f.api.clearHistory).not.toHaveBeenCalled();
  expect(f.api.setLocale).not.toHaveBeenCalled();
  expect(f.api.execute).not.toHaveBeenCalled();
  expect(f.trashFile).not.toHaveBeenCalled(); expect(f.writeTags).not.toHaveBeenCalled();
});

it('global Reset all is also available on Activity and keeps its records and the current page', async () => {
  const f = await setup('filter', { includeExt: '.jpg' }), user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Reset all' }) as HTMLButtonElement).disabled).toBe(false));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Activity' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Activity' }));
  await screen.findByText('No activity yet');
  await user.click(screen.getByRole('button', { name: 'Reset all' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Reset all workflows?' })).getByRole('button', { name: 'Reset all' }));
  expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
  expect(screen.getByText('No activity yet')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config).toEqual(defaults());
  expect(f.api.clearHistory).not.toHaveBeenCalled();
  expect(f.api.execute).not.toHaveBeenCalled();
});

it('declining confirmation retains search, pagination, selection, collapsed settings and scroll position', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  await Promise.all(Array.from({ length: 101 }, (_, index) => fs.writeFile(path.join(f.target, `Extra-${String(index).padStart(3, '0')}.txt`), 'fixture')));
  const { container } = render(<App />); await ready();
  await user.type(screen.getByRole('searchbox'), 'Extra-');
  await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('checkbox', { name: 'Process Extra-100.txt' }));
  await user.click(screen.getByRole('button', { name: /Collapse folder options$/ }));
  const workspace = container.querySelector<HTMLElement>('.workspace-scroll')!;
  workspace.scrollTop = 190;
  let answer!: (accepted: boolean) => void;
  f.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve; }));
  await user.click(action('filter', 1));
  await waitFor(() => expect(answer).toBeTypeOf('function'));
  expect(container.querySelector('.progress-panel')).toBeNull();
  expect(container.querySelector('.output')?.hasAttribute('inert')).toBe(true);
  expect((screen.getByRole('button', { name: 'Reset workflow' }) as HTMLButtonElement).disabled).toBe(true);
  expect(workspace.scrollTop).toBe(190);
  await act(async () => answer(false));
  await waitFor(() => expect((action('filter', 1) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Extra-');
  expect(screen.getByRole('checkbox', { name: 'Matches only' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('checkbox', { name: 'Process Extra-100.txt' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByRole('checkbox', { name: 'Process Extra-000.txt' })).toBeNull();
  expect(screen.getByRole('button', { name: /Show all folder options$/ })).toBeTruthy();
  expect(workspace.scrollTop).toBe(190);
  expect(container.querySelector('.output')?.hasAttribute('inert')).toBe(false);
  expect(f.trashFile).not.toHaveBeenCalled(); expect(f.writeTags).not.toHaveBeenCalled();
});

it('independent tagging retains preview search, visibility settings and scroll through its refreshed plan', async () => {
  const f = await setup('filter'), user = userEvent.setup();
  const { container } = render(<App />); await ready();
  await user.click(screen.getByRole('checkbox', { name: 'Process A.txt' }));
  await user.type(screen.getByRole('searchbox'), 'A.txt');
  await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
  const workspace = container.querySelector<HTMLElement>('.workspace-scroll')!;
  workspace.scrollTop = 250;
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog();
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await ready();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('A.txt');
  expect(screen.getByRole('checkbox', { name: 'Matches only' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getAllByRole('checkbox', { name: /^Process / })).toHaveLength(1);
  expect(screen.getByRole('checkbox', { name: 'Process A.txt' }).getAttribute('aria-checked')).toBe('true');
  expect(workspace.scrollTop).toBe(250);
  expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(path.join(f.target, 'A.txt'), ['Blue\n4', 'Green\n2']);
  expect(f.api.execute).not.toHaveBeenCalled();
});

for (const mode of ['filter', 'compare'] as const) {
  it(`${mode}: no-op color choices keep the selected file available without rebuilding the result plan`, async () => {
    const f = await setup(mode, { colors: ['red'], matchBy: 'stem' }), user = userEvent.setup();
    render(<App />);
    const name = mode === 'filter' ? 'Process A.txt' : 'Process Folder A / A.NEF';
    const color = mode === 'filter' ? 'Blue' : 'Green';
    await user.click(await screen.findByRole('checkbox', { name }));
    const originalPlan = f.service.active!.id;
    await user.click(screen.getByRole('button', { name: 'Set tags' }));
    const dialog = await tagsDialog();
    await user.click(dialog.getByRole('button', { name: 'Tags' }));
    await user.click(screen.getByRole('menuitem', { name: 'Deselect colors' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: color }));
    await user.keyboard('{Escape}');
    expect(dialog.getByRole('listitem').querySelector('.tag-change-arrow')).toBeNull();
    expect(dialog.getByRole('img', { name: color })).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Tags' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Red' }));
    await user.keyboard('{Escape}');
    expect(dialog.getByRole('listitem').querySelector('.tag-change-arrow')).not.toBeNull();
    expect(f.service.active!.id).toBe(originalPlan);
    expect(f.api.preview).toHaveBeenCalledTimes(1);
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('checkbox', { name }).getAttribute('aria-checked')).toBe('true');
    expect(f.writeTags).not.toHaveBeenCalled(); expect(f.trashFile).not.toHaveBeenCalled();
  });

  it(`${mode}: Clear file tags removes tags only from checked files while Deselect colors performs no operation`, async () => {
    const f = await setup(mode, { colors: [], matchBy: 'stem' }), user = userEvent.setup();
    render(<App />);
    const name = mode === 'filter' ? 'Process A.txt' : 'Process Folder A / A.NEF';
    const file = path.join(mode === 'filter' ? f.target : f.base, mode === 'filter' ? 'A.txt' : 'A.NEF');
    const unchangedFile = path.join(mode === 'filter' ? f.base : f.target, mode === 'filter' ? 'A.NEF' : 'A.txt');
    const unchangedTags = f.tags.get(unchangedFile);
    await user.click(await screen.findByRole('checkbox', { name }));
    await user.click(screen.getByRole('button', { name: 'Set tags' }));
    const dialog = await tagsDialog();
    expect((dialog.getByRole('button', { name: 'Set tags' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(dialog.getByRole('button', { name: 'Tags' }));
    expect(screen.getByRole('menuitem', { name: 'Deselect colors' }).hasAttribute('data-disabled')).toBe(true);
    await user.click(screen.getByRole('menuitem', { name: 'Clear file tags' }));
    expect(dialog.getByRole('heading', { name: 'Clear tags from selected files (1)' })).toBeTruthy();
    expect(dialog.getByRole('listitem').querySelector('.tag-change-arrow')).not.toBeNull();
    expect(dialog.getByRole('img', { name: 'No tags' })).toBeTruthy();
    expect(dialog.queryByText('Already untagged')).toBeNull();
    await user.click(dialog.getByRole('button', { name: 'Clear file tags' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findByRole('checkbox', { name })).getAttribute('aria-checked')).toBe('true');
    expect(f.writeTags).toHaveBeenCalledExactlyOnceWith(file, []);
    expect(f.tags.get(unchangedFile)).toEqual(unchangedTags);
    expect(f.trashFile).not.toHaveBeenCalled();
    expect(f.api.execute).not.toHaveBeenCalled();
  });
}

it('independent Filter tags reject a hard-linked file without modifying it or other selected files', async () => {
  const f = await setup('filter', { colors: ['red'] }), user = userEvent.setup();
  await fs.link(path.join(f.target, 'A.txt'), path.join(f.root, 'hard-linked.txt'));
  render(<App />); await ready();
  await user.click(screen.getByRole('button', { name: 'Select all results' }));
  await user.click(screen.getByRole('button', { name: 'Set tags' }));
  const dialog = await tagsDialog();
  await user.click(dialog.getByRole('button', { name: 'Set tags' }));
  await dialog.findByRole('alert');
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.writeTags).not.toHaveBeenCalled();
  expect(f.trashFile).not.toHaveBeenCalled();
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(4);
});
