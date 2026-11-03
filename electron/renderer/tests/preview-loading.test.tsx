import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/app';
import { defaults } from '@/lib/config';
import type { Catalog, FinderAPI, Plan, ProgressInfo } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const catalog: Catalog = { current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] };
const plan: Plan = {
  id: 'loading', mode: 'tags', createdAt: '', roots: ['/photos'], conflicts: [], warnings: [], total: 1, candidates: 1,
  rows: [{ id: 'photo', name: 'photo.jpg', relative: 'photo.jpg', file: '/photos/photo.jpg', root: '/photos', size: 100,
    candidate: true, action: 'tags', reason: { key: 'reason.listKeepMiss' }, matches: [], currentTags: [], nextTags: ['Green\n2'] }],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const config = defaults();
  config.tags.base = '/reference'; config.tags.targets = ['/photos'];
  localStorage.setItem('finder-workbench', JSON.stringify({ mode: 'tags', config }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const api = {
    version: vi.fn().mockResolvedValue('2.2.0'), locales: vi.fn().mockResolvedValue(catalog), history: vi.fn().mockResolvedValue([]),
    setLocale: vi.fn().mockResolvedValue(catalog), reloadLocales: vi.fn().mockResolvedValue(catalog), openLocaleFolder: vi.fn().mockResolvedValue(undefined),
    choose: vi.fn().mockResolvedValue([]), dropped: vi.fn().mockResolvedValue([]), preview: vi.fn<FinderAPI['preview']>().mockResolvedValue(plan),
    discard: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), execute: vi.fn<FinderAPI['execute']>().mockResolvedValue({ declined: true }),
    reveal: vi.fn().mockResolvedValue(undefined), copyPath: vi.fn().mockResolvedValue(undefined), exportResult: vi.fn().mockResolvedValue(false),
    image: vi.fn().mockRejectedValue(new Error('No image decoder in this test')),
    onProgress: vi.fn((_callback: (progress: ProgressInfo) => void) => () => {}),
  } satisfies FinderAPI;
  window.finder = api;
  return api;
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
const ready = () => screen.findByRole('checkbox', { name: 'Process photo.jpg' });

it('copying a pathname uses the desktop clipboard bridge and reports success without applying any changes', async () => {
  const api = setup(), user = userEvent.setup();
  const file = '/photos/选片 (1).jpg';
  api.preview.mockResolvedValue({ ...plan, rows: [{ ...plan.rows[0], file }] });
  render(<App />);
  const checkbox = await ready();
  fireEvent.contextMenu(checkbox.closest('.file-row')!, { clientX: 100, clientY: 100 });
  await user.click(await screen.findByRole('menuitem', { name: 'Copy pathname' }));
  expect(api.copyPath).toHaveBeenCalledExactlyOnceWith(file);
  expect(await screen.findByText('Pathname copied')).toBeTruthy();
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  expect(api.execute).not.toHaveBeenCalled();
  expect(api.reveal).not.toHaveBeenCalled();
});

it('manual and automatic refresh show a skeleton immediately and cannot execute stale results', async () => {
  const api = setup(), manual = deferred<Plan>(), automatic = deferred<Plan>();
  api.preview.mockResolvedValueOnce(plan).mockReturnValueOnce(manual.promise).mockReturnValueOnce(automatic.promise);
  const user = userEvent.setup();
  const { container } = render(<App />);
  await ready();
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(screen.getByRole('region', { name: 'Preview' }).getAttribute('aria-busy')).toBe('true');
  expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  expect(container.querySelector('.progress-panel')).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Process photo.jpg' })).toBeNull();
  const execute = screen.getByRole('button', { name: 'Update tags on 0 files' }) as HTMLButtonElement;
  expect(execute.disabled).toBe(true);
  await user.click(execute);
  expect(api.execute).not.toHaveBeenCalled();
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2));
  await act(async () => manual.resolve({ ...plan, id: 'manual' }));
  await ready();
  expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: 'Keep existing target tags' }));
  expect(screen.getByRole('region', { name: 'Preview' }).getAttribute('aria-busy')).toBe('true');
  expect(container.querySelector('.progress-panel')).toBeNull();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(3));
  await act(async () => automatic.resolve({ ...plan, id: 'automatic' }));
  await ready();
});

it('the same persistent workflow title toggles settings repeatedly, and a refresh keeps them collapsed', async () => {
  const api = setup(), next = deferred<Plan>();
  api.preview.mockResolvedValueOnce(plan).mockReturnValueOnce(next.promise);
  const user = userEvent.setup();
  const { container } = render(<App />);
  await ready();
  const title = screen.getByRole('button', { name: 'Finder tags: Collapse folder options' });
  for (const collapsed of [true, false, true]) {
    await user.click(title);
    expect(title.getAttribute('aria-expanded')).toBe(String(!collapsed));
    expect(container.querySelector('.workspace-settings')?.hasAttribute('inert')).toBe(collapsed);
    expect(screen.getByRole('button', { name: `Finder tags: ${collapsed ? 'Show all folder options' : 'Collapse folder options'}` })).toBe(title);
  }
  expect(container.querySelector('.workspace-settings')?.hasAttribute('inert')).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(title));
  fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
  expect(screen.getByRole('region', { name: 'Preview' }).getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('button', { name: /Show all folder options$/ })).toBe(title);
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2));
  await act(async () => next.resolve({ ...plan, id: 'refresh' }));
  await ready();
  expect(container.querySelector('.workspace-settings')?.hasAttribute('inert')).toBe(true);
  await user.click(title);
  expect(screen.getByRole('button', { name: /Collapse folder options$/ })).toBe(title);
  expect(container.querySelector('.workspace-settings')?.hasAttribute('inert')).toBe(false);
});

it('actual file operations retain their progress and stop controls', async () => {
  const api = setup(), execution = deferred<{ declined: true }>();
  api.execute.mockReturnValueOnce(execution.promise);
  const user = userEvent.setup();
  const { container } = render(<App />);
  await ready();
  await user.click(screen.getByRole('button', { name: 'Update tags on 1 files' }));
  expect(container.querySelector('.progress-panel')).toBeTruthy();
  expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Reset all' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => execution.resolve({ declined: true }));
  await ready();
});

it('Reset all during a refresh rejects the old preview and a pending folder picker result', async () => {
  const api = setup(), scan = deferred<Plan>(), picker = deferred<string[]>(), user = userEvent.setup();
  api.preview.mockResolvedValueOnce(plan).mockReturnValueOnce(scan.promise);
  api.choose.mockReturnValueOnce(picker.promise);
  render(<App />); await ready();
  await user.click(screen.getByRole('button', { name: '/reference' }));
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole('button', { name: 'Reset all' }));
  await act(async () => { picker.resolve(['/late-folder']); scan.resolve({ ...plan, id: 'late-preview' }); });
  expect(screen.queryByRole('checkbox', { name: 'Process photo.jpg' })).toBeNull();
  expect(screen.queryByRole('button', { name: '/late-folder' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', { name: 'Update tags on 0 files' }) as HTMLButtonElement).disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem('finder-workbench')!).config.tags).toMatchObject({ base: '', targets: [], list: '', listText: '' });
  expect(api.preview).toHaveBeenCalledTimes(2);
  expect(api.execute).not.toHaveBeenCalled();
});
