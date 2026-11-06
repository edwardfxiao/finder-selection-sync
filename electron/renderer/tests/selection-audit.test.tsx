import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileResults } from '@/components/file-results';
import App from '@/app';
import { defaults } from '@/lib/config';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { Catalog, FinderAPI, Mode, Plan, ProgressInfo, Row } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });
const filename = (index: number) => `file-${String(index).padStart(3, '0')}.txt`;
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

function mount(mode: Mode = 'filter', count = 12) {
  const changes = vi.fn();
  const plan: Plan = {
    id: 'selection-audit', mode, action: 'trash', createdAt: '', roots: ['/files'], conflicts: [], warnings: [], total: count, candidates: count - 1,
    rows: Array.from({ length: count }, (_, index) => ({
      id: String(index), name: filename(index), relative: filename(index), file: `/files/${filename(index)}`, root: '/files', size: 100,
      candidate: index !== 0, matched: index !== 0, action: index === 0 ? 'keep' : 'trash', matches: [], reason: { key: 'reason.listKeepHit' },
    })),
  };
  function Preview() {
    const [selected, setSelected] = useState(new Set<string>());
    return <I18nContext.Provider value={language}><FileResults plan={plan} selected={selected} setSelected={value => { changes(value); setSelected(value); }} reveal={() => {}} copyPath={() => {}} /></I18nContext.Provider>;
  }
  render(<Preview />);
  return () => [...(changes.mock.lastCall?.[0] ?? [])].sort();
}
function file(index: number, scope: Pick<typeof screen, 'getByRole'> = screen) {
  return scope.getByRole('checkbox', { name: `Process ${filename(index)}` }).closest<HTMLElement>('[data-file-row]')!.querySelector<HTMLButtonElement>('.file-button')!;
}

for (const additive of [false, true]) {
  it(`${additive ? 'Command-Shift' : 'Shift'} click starts at the clicked result when filtering hid the old range anchor`, async () => {
    const chosen = mount(), user = userEvent.setup();
    await user.click(file(10));
    await user.type(screen.getByRole('searchbox'), 'file-00');
    expect(screen.queryByRole('checkbox', { name: `Process ${filename(10)}` })).toBeNull();
    await user.keyboard(additive ? '{Meta>}{Shift>}' : '{Shift>}');
    await user.click(file(3));
    await user.keyboard(additive ? '{/Shift}{/Meta}' : '{/Shift}');
    expect(chosen()).toEqual(['10', '3']);
    expect(file(3).getAttribute('aria-pressed')).toBe('true');
  });
}

it('Shift-click remains usable after Changes only hides the selected kept list item', async () => {
  const chosen = mount('list'), user = userEvent.setup();
  await user.click(file(0));
  await user.click(screen.getByRole('checkbox', { name: 'Changes only' }));
  expect(screen.queryByRole('checkbox', { name: `Process ${filename(0)}` })).toBeNull();
  await user.keyboard('{Shift>}'); await user.click(file(3)); await user.keyboard('{/Shift}');
  expect(chosen()).toEqual(['0', '3']);
});

it('keyboard shortcuts in inline or expanded search fields do not change file checks', async () => {
  const chosen = mount(), user = userEvent.setup();
  await user.click(file(3));
  for (const expanded of [false, true]) {
    if (expanded) await user.click(screen.getByRole('button', { name: 'Expand preview' }));
    const scope = expanded ? within(await screen.findByRole('dialog', { name: 'Full preview' })) : screen;
    const search = scope.getByRole('searchbox');
    search.focus();
    for (const event of [{ key: 'a', metaKey: true }, { key: 'a', shiftKey: true, metaKey: true }, { key: 'ArrowDown', shiftKey: true, altKey: true }, { key: 'End', shiftKey: true }]) {
      expect(fireEvent.keyDown(search, event)).toBe(true);
      expect(chosen()).toEqual(['3']);
    }
    if (expanded) {
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
  }
});

it('opening and closing the expanded preview preserves an existing reversible range anchor', async () => {
  const chosen = mount(), user = userEvent.setup();
  await user.click(file(1));
  await user.keyboard('{Shift>}'); await user.click(file(4)); await user.keyboard('{/Shift}');
  expect(chosen()).toEqual(['1', '2', '3', '4']);
  await user.click(screen.getByRole('button', { name: 'Expand preview' }));
  const expanded = within(await screen.findByRole('dialog', { name: 'Full preview' }));
  await user.keyboard('{Shift>}'); await user.click(file(6, expanded)); await user.keyboard('{/Shift}');
  expect(chosen()).toEqual(['1', '2', '3', '4', '5', '6']);
  await user.click(expanded.getByRole('button', { name: 'Back to workspace' }));
  await user.keyboard('{Shift>}'); await user.click(file(2)); await user.keyboard('{/Shift}');
  expect(chosen()).toEqual(['1', '2']);
});

it('mouse range selection crosses result pages and can reverse without retaining the old range tail', async () => {
  const chosen = mount('filter', 105), user = userEvent.setup();
  await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
  await user.click(file(98));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.keyboard('{Shift>}'); await user.click(file(101)); await user.keyboard('{/Shift}');
  expect(chosen()).toEqual(['100', '101', '98', '99']);
  await user.click(screen.getByRole('button', { name: 'Previous' }));
  await user.keyboard('{Shift>}'); await user.click(file(96)); await user.keyboard('{/Shift}');
  expect(chosen()).toEqual(['96', '97', '98']);
});

it('cancelling a loading tag dialog opened from the Compare footer eventually restores focus to its opener', async () => {
  const config = defaults();
  config.compare.base = '/a'; config.compare.targets = ['/b'];
  localStorage.setItem('finder-workbench', JSON.stringify({ mode: 'compare', config }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const catalog: Catalog = { current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] };
  const plan: Plan = { id: 'compare-focus', mode: 'compare', action: 'review', createdAt: '', roots: ['/a', '/b'], conflicts: [], warnings: [], total: 1, candidates: 1, matched: 1,
    rows: [{ id: 'first', file: '/a/file.txt', name: 'file.txt', relative: 'file.txt', root: '/a', size: 10, matched: true, candidate: true, action: 'keep', matches: ['/b/file.txt'], reason: { key: 'compare.common' } }] };
  let finish!: (rows: Row[]) => void;
  const api = {
    version: vi.fn().mockResolvedValue('2.2.2'), locales: vi.fn().mockResolvedValue(catalog), history: vi.fn().mockResolvedValue([]), clearHistory: vi.fn().mockResolvedValue([]),
    setTheme: vi.fn().mockResolvedValue(undefined), setLocale: vi.fn().mockResolvedValue(catalog), reloadLocales: vi.fn().mockResolvedValue(catalog), openLocaleFolder: vi.fn().mockResolvedValue(undefined),
    choose: vi.fn().mockResolvedValue([]), dropped: vi.fn().mockResolvedValue([]), preview: vi.fn<FinderAPI['preview']>().mockResolvedValue(plan), activate: vi.fn<FinderAPI['activate']>().mockResolvedValue(plan),
    discard: vi.fn().mockResolvedValue(undefined), discardAll: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn<FinderAPI['execute']>().mockResolvedValue({ declined: true }), tagSelected: vi.fn<FinderAPI['tagSelected']>().mockResolvedValue({ declined: true }),
    selectedTags: vi.fn<FinderAPI['selectedTags']>(() => new Promise<Row[]>(resolve => { finish = resolve; })),
    reveal: vi.fn().mockResolvedValue(undefined), copyPath: vi.fn().mockResolvedValue(undefined), exportResult: vi.fn().mockResolvedValue(false), image: vi.fn().mockRejectedValue(new Error('No image')),
    onProgress: vi.fn((_callback: (progress: ProgressInfo) => void) => () => {}),
  } satisfies FinderAPI;
  window.finder = api;
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('checkbox', { name: 'Process file.txt' }));
  const opener = screen.getByRole('button', { name: 'Set tags on 1 files' });
  await user.click(opener);
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => finish(plan.rows));
  await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false));
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it('cached expanded previews keep both result surfaces inert and delay image requests until native activation is ready', async () => {
  const image = vi.fn().mockResolvedValue({ dataURL: 'data:image/png;base64,AA==', width: 1, height: 1 });
  vi.stubGlobal('finder', { image });
  const plan: Plan = { id: 'cached-ready', mode: 'filter', action: 'trash', createdAt: '', roots: ['/files'], conflicts: [], warnings: [], total: 2, candidates: 2, matched: 2,
    rows: ['one.jpg', 'two.jpg'].map((name, index) => ({ id: String(index), file: `/files/${name}`, name, relative: name, root: '/files', size: 100, matched: true, candidate: true, action: 'trash', matches: [], reason: { key: 'filter.reasonMatched' } })) };
  const selectedChanged = vi.fn();
  function Preview({ ready }: { ready: boolean }) {
    const [selected, setSelected] = useState(new Set(['0']));
    return <I18nContext.Provider value={language}><div className="output" inert={!ready}>
      <FileResults plan={plan} selected={selected} setSelected={value => { selectedChanged(value); setSelected(value); }} ready={ready}
        viewState={{ query: '', onlyChanges: true, page: 1, expanded: true }} reveal={() => {}} copyPath={() => {}} />
    </div></I18nContext.Provider>;
  }
  const user = userEvent.setup(), rendered = render(<Preview ready={false} />);
  const dialogElement = await screen.findByRole('dialog', { name: 'Full preview' }), dialog = within(dialogElement);
  // The portal lies outside .output, so each results section needs its own lock.
  expect(rendered.container.querySelector('.output')?.contains(dialogElement)).toBe(false);
  const results = [...document.querySelectorAll<HTMLElement>('.results')];
  expect(results).toHaveLength(2);
  for (const section of results) {
    expect(section.hasAttribute('inert')).toBe(true);
    expect(section.getAttribute('aria-busy')).toBe('true');
  }
  const checkbox = dialog.getByRole('checkbox', { name: 'Process one.jpg' });
  const row = checkbox.closest<HTMLElement>('[data-file-row]')!;
  fireEvent.keyDown(row.querySelector('.file-button')!, { key: 'a', metaKey: true });
  fireEvent.click(row);
  expect(selectedChanged).not.toHaveBeenCalled();
  expect(image).not.toHaveBeenCalled();
  expect((dialog.getByRole('button', { name: 'Preview image: one.jpg' }) as HTMLButtonElement).disabled).toBe(true);
  rendered.rerender(<Preview ready />);
  await waitFor(() => expect(image).toHaveBeenCalledWith('/files/one.jpg', 'thumbnail'));
  for (const section of results) expect(section.hasAttribute('inert')).toBe(false);
  await user.click(dialog.getByRole('button', { name: 'Select all results' }));
  expect([...selectedChanged.mock.lastCall![0]]).toEqual(['0', '1']);
});
