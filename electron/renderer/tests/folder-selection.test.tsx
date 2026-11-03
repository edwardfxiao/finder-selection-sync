import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/app';
import { defaults } from '@/lib/config';
import type { Catalog, FinderAPI, Mode } from '@/types';
import en from '../../locales/en-US.json';

const catalog: Catalog = { current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr',
  messages: Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }] };

function setup(mode: Mode = 'tags', targets = ['/one/photos', '/two/photos']) {
  const config = defaults();
  config[mode] = { ...config[mode], base: '/reference', targets, list: '/names.txt' };
  localStorage.setItem('finder-workbench', JSON.stringify({ mode, config }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const api = {
    version: vi.fn().mockResolvedValue('2.2.0'), locales: vi.fn().mockResolvedValue(catalog), history: vi.fn().mockResolvedValue([]),
    setLocale: vi.fn().mockResolvedValue(catalog), reloadLocales: vi.fn().mockResolvedValue(catalog), openLocaleFolder: vi.fn().mockResolvedValue(undefined),
    choose: vi.fn<FinderAPI['choose']>().mockResolvedValue([]), dropped: vi.fn().mockResolvedValue([]),
    preview: vi.fn<FinderAPI['preview']>().mockImplementation(async config => ({
      id: 'selection', mode: config.mode, createdAt: '', roots: config.targets, base: config.base, rows: [], conflicts: [], warnings: [], total: 0, candidates: 0,
    })),
    discard: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), execute: vi.fn().mockResolvedValue({ declined: true }),
    reveal: vi.fn().mockResolvedValue(undefined), copyPath: vi.fn().mockResolvedValue(undefined), exportResult: vi.fn().mockResolvedValue(false),
    image: vi.fn().mockRejectedValue(new Error('No images in folder selection fixtures')),
    onProgress: vi.fn(() => () => {}),
  } satisfies FinderAPI;
  window.finder = api;
  return api;
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

for (const mode of ['orphans', 'tags', 'list'] as const) {
  it(`${mode}: clicking a target replaces only that row, while Add appends folders`, async () => {
    const api = setup(mode), user = userEvent.setup();
    api.choose.mockResolvedValueOnce(['/replacement']).mockResolvedValueOnce(['/third', '/fourth']);
    render(<App />);
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: '/two/photos' }));
    expect(api.choose).toHaveBeenCalledExactlyOnceWith('targets', '/two/photos');
    await waitFor(() => expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ mode, targets: ['/one/photos', '/replacement'] })));
    expect(screen.queryByRole('button', { name: '/two/photos' })).toBeNull();
    const first = screen.getByRole('button', { name: '/one/photos' }).closest('.folder-item')!;
    const replacement = screen.getByRole('button', { name: '/replacement' }).closest('.folder-item')!;
    expect(first.classList.contains('is-picking')).toBe(false);
    expect(replacement.classList.contains('is-picking')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Add target folder' }));
    expect(api.choose).toHaveBeenLastCalledWith('targets');
    await waitFor(() => expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ targets: ['/one/photos', '/replacement', '/third', '/fourth'] })));
    expect(api.execute).not.toHaveBeenCalled();
  });

  it(`${mode}: cancelling the source and target pickers clears both temporary highlights`, async () => {
    const api = setup(mode), user = userEvent.setup();
    let finish!: (paths: string[]) => void;
    api.choose.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { container } = render(<App />);
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
    const source = mode === 'list' ? '/names.txt' : '/reference';
    for (const file of [source, '/one/photos', '/two/photos']) {
      const button = screen.getByRole('button', { name: file });
      const row = button.closest('.folder-item')!;
      await user.click(button);
      expect(row.classList.contains('is-picking')).toBe(true);
      expect(container.querySelectorAll('.folder-item.is-picking')).toHaveLength(1);
      await act(async () => finish([]));
      expect(container.querySelectorAll('.folder-item.is-picking')).toHaveLength(0);
      expect(screen.getByRole('button', { name: file })).toBe(button);
    }
    expect(api.preview).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('finder-workbench')!).config[mode].targets).toEqual(['/one/photos', '/two/photos']);
  });
}

it('replacing the only target keeps one target and cancelling or choosing the same folder preserves the preview', async () => {
  const api = setup('tags', ['/one/photos']), user = userEvent.setup();
  api.choose.mockResolvedValueOnce(['/replacement']).mockResolvedValueOnce([]).mockResolvedValueOnce(['/replacement']);
  render(<App />);
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: '/one/photos' }));
  await waitFor(() => expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ targets: ['/replacement'] })));
  await user.click(screen.getByRole('button', { name: '/replacement' }));
  await user.click(screen.getByRole('button', { name: '/replacement' }));
  expect(api.choose).toHaveBeenCalledTimes(3);
  expect(api.preview).toHaveBeenCalledTimes(2);
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.tags.targets).toEqual(['/replacement']);
});

it('choosing an existing target for replacement reports the duplicate without removing either row', async () => {
  const api = setup(), user = userEvent.setup();
  api.choose.mockResolvedValueOnce(['/one/photos']);
  render(<App />);
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: '/two/photos' }));
  expect(await screen.findByText('That target folder is already selected. Choose a different folder.')).toBeTruthy();
  expect(screen.getByRole('button', { name: '/one/photos' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '/two/photos' })).toBeTruthy();
  expect(api.preview).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.tags.targets).toEqual(['/one/photos', '/two/photos']);
});

it('a picker failure clears its highlight and leaves the selected paths intact', async () => {
  const api = setup(), user = userEvent.setup();
  let reject!: (error: Error) => void;
  api.choose.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const { container } = render(<App />);
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: '/two/photos' }));
  expect(container.querySelectorAll('.folder-item.is-picking')).toHaveLength(1);
  await act(async () => reject(new Error('Picker unavailable')));
  expect(await screen.findByText('Picker unavailable')).toBeTruthy();
  expect(container.querySelectorAll('.folder-item.is-picking')).toHaveLength(0);
  expect(api.preview).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.tags.targets).toEqual(['/one/photos', '/two/photos']);
});

it('a delayed folder drop cannot change another workflow after switching modes', async () => {
  const api = setup(), user = userEvent.setup();
  let finish!: (paths: string[]) => void;
  api.dropped.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<App />);
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
  const card = screen.getByRole('button', { name: '/reference' }).closest('.folder-card')!;
  fireEvent.drop(card, { dataTransfer: { files: [new File([''], 'folder')] } });
  expect(api.dropped).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Clean by reference' }));
  await act(async () => finish(['/late-folder']));
  expect(screen.queryByRole('button', { name: '/late-folder' })).toBeNull();
  const saved = JSON.parse(localStorage.getItem('finder-workbench')!);
  expect(saved.config.orphans.base).toBe('');
  expect(saved.config.tags.base).toBe('/reference');
});

it('a delayed drop error stays with its original workflow instead of appearing on the new page', async () => {
  const api = setup(), user = userEvent.setup();
  let reject!: (error: Error) => void;
  api.dropped.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<App />);
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
  fireEvent.drop(screen.getByRole('button', { name: '/reference' }).closest('.folder-card')!, { dataTransfer: { files: [] } });
  await user.click(screen.getByRole('button', { name: 'Organize by list' }));
  await act(async () => reject(new Error('Old workflow drop failure')));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('leaving and returning to a workflow invalidates its still-pending picker result', async () => {
  const api = setup(), user = userEvent.setup();
  let finish!: (paths: string[]) => void;
  api.choose.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<App />);
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: '/reference' }));
  await user.click(screen.getByRole('button', { name: 'Clean by reference' }));
  await user.click(screen.getByRole('button', { name: 'Finder tags' }));
  await act(async () => finish(['/stale-reference']));
  expect(screen.queryByRole('button', { name: '/stale-reference' })).toBeNull();
  expect(screen.getByRole('button', { name: '/reference' })).toBeTruthy();
});
