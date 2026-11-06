import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileResults } from '@/components/file-results';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { Mode, Plan } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });
const name = (i: number) => `file-${String(i).padStart(3, '0')}.txt`;
function fixture(mode: Mode, count: number): Plan {
  return {
    id: 'selection', mode, action: mode === 'compare' ? 'review' : mode === 'tags' ? 'tags' : 'trash',
    createdAt: '', roots: ['/files'], conflicts: [], warnings: [], total: count, candidates: count - 1,
    rows: Array.from({ length: count }, (_, i) => ({
      id: `row-${i}`, name: name(i), relative: name(i), file: `/files/${name(i)}`, root: '/files', size: 100,
      candidate: i !== 2, matched: i !== 2, action: i === 2 || mode === 'compare' ? 'keep' : mode === 'tags' ? 'tags' : 'trash',
      matches: [], reason: { key: i === 2 ? 'reason.hardLink' : 'filter.reasonMatched' },
    })),
  };
}
function mount(mode: Mode = 'filter', count = 8) {
  const changes = vi.fn();
  const plan = fixture(mode, count);
  function Preview() {
    const [selected, setSelected] = useState(new Set<string>());
    return <I18nContext.Provider value={language}><FileResults plan={plan} selected={selected} setSelected={value => { changes(value); setSelected(value); }} reveal={() => {}} copyPath={() => {}} /></I18nContext.Provider>;
  }
  render(<Preview />);
  return () => [...(changes.mock.lastCall?.[0] ?? [])].sort();
}
function row(i: number, scope: Pick<typeof screen, 'getByRole'> = screen) {
  return scope.getByRole('checkbox', { name: `Process ${name(i)}` }).closest<HTMLElement>('[data-file-row]')!;
}
function file(i: number, scope: Pick<typeof screen, 'getByRole'> = screen) { return row(i, scope).querySelector<HTMLButtonElement>('.file-button')!; }
const ids = (...values: number[]) => values.map(i => `row-${i}`).sort();
const key = (value: string, modifiers: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement!, { key: value, ...modifiers });

for (const mode of ['orphans', 'tags', 'list', 'filter', 'compare'] as const) {
  it(`${mode}: filename, metadata, reason and blank row areas toggle exactly once, as does the checkbox`, async () => {
    const chosen = mount(mode), user = userEvent.setup();
    for (const area of ['.file-name', '.file-meta', '.matching', '.status', null]) {
      await user.click(area ? row(0).querySelector<HTMLElement>(area)! : row(0));
      expect(chosen()).toEqual(ids(0));
      expect(file(0).getAttribute('aria-pressed')).toBe('true');
      await user.click(screen.getByRole('checkbox', { name: `Process ${name(0)}` }));
      expect(chosen()).toEqual([]);
    }
    await user.click(file(1)); await user.click(file(0));
    expect(chosen()).toEqual(ids(0, 1));
    await user.keyboard(' ');
    expect(chosen()).toEqual(ids(1));
    await user.click(screen.getByRole('checkbox', { name: `Process ${name(0)}` }));
    await user.keyboard(' ');
    expect(chosen()).toEqual(ids(1));
  });
}

it('Shift-click expands, shrinks and reverses a range, skipping protected rows', async () => {
  const chosen = mount(), user = userEvent.setup();
  await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
  await user.click(file(3));
  await user.keyboard('{Shift>}'); await user.click(row(6).querySelector('.matching')!);
  expect(chosen()).toEqual(ids(3, 4, 5, 6));
  await user.click(file(4)); expect(chosen()).toEqual(ids(3, 4));
  await user.click(file(0)); expect(chosen()).toEqual(ids(0, 1, 3));
  await user.keyboard('{/Shift}');
  await user.click(row(2)); expect(chosen()).toEqual(ids(0, 1, 3));
});

it('Command-click toggles individually and Command-Shift adds a reversible range', async () => {
  const chosen = mount(), user = userEvent.setup();
  await user.click(file(0));
  await user.keyboard('{Meta>}'); await user.click(file(4)); await user.keyboard('{/Meta}');
  expect(chosen()).toEqual(ids(0, 4));
  await user.keyboard('{Meta>}{Shift>}'); await user.click(file(7));
  expect(chosen()).toEqual(ids(0, 4, 5, 6, 7));
  await user.click(file(5)); expect(chosen()).toEqual(ids(0, 4, 5));
  await user.keyboard('{/Shift}{/Meta}');
  key('ArrowDown', { shiftKey: true, metaKey: true });
  expect(chosen()).toEqual(ids(0, 4, 5, 6));
});

it('arrow keys move the active selection and Shift arrows extend, shrink and reverse it', async () => {
  const chosen = mount(), user = userEvent.setup();
  await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
  await user.click(file(3));
  key('ArrowDown', { shiftKey: true }); key('ArrowDown', { shiftKey: true });
  expect(chosen()).toEqual(ids(3, 4, 5)); expect(document.activeElement).toBe(file(5));
  key('ArrowUp', { shiftKey: true }); expect(chosen()).toEqual(ids(3, 4));
  key('ArrowUp', { shiftKey: true }); key('ArrowUp', { shiftKey: true });
  expect(chosen()).toEqual(ids(1, 3)); expect(document.activeElement).toBe(file(1));
  key('ArrowDown'); expect(chosen()).toEqual(ids(3));
});

for (const expanded of [false, true]) {
  it(`${expanded ? 'expanded' : 'inline'}: keyboard selection crosses pages and Option jumps or extends to result boundaries`, async () => {
    const chosen = mount('filter', 105), user = userEvent.setup();
    // Show the protected file so crossing page 1 is not an artifact of filtering.
    await user.click(screen.getByRole('checkbox', { name: 'Matches only' }));
    if (expanded) await user.click(screen.getByRole('button', { name: 'Expand preview' }));
    const scope = expanded ? within(await screen.findByRole('dialog', { name: 'Full preview' })) : screen;
    await user.click(file(99, scope)); key('ArrowDown', { shiftKey: true });
    expect(chosen()).toEqual(ids(99, 100)); expect(document.activeElement).toBe(file(100, scope));
    key('ArrowUp', { shiftKey: true });
    expect(chosen()).toEqual(ids(99)); expect(document.activeElement).toBe(file(99, scope));
    key('ArrowDown', { altKey: true });
    expect(chosen()).toEqual(ids(104)); expect(document.activeElement).toBe(file(104, scope));
    key('ArrowUp', { altKey: true, shiftKey: true });
    expect(chosen()).toHaveLength(104); expect(chosen()).not.toContain('row-2'); expect(document.activeElement).toBe(file(0, scope));
    key('ArrowDown', { altKey: true, shiftKey: true });
    expect(chosen()).toEqual(ids(104)); expect(document.activeElement).toBe(file(104, scope));
    key('ArrowUp', { altKey: true });
    expect(chosen()).toEqual(ids(0)); expect(document.activeElement).toBe(file(0, scope));
    key('a', { metaKey: true }); expect(chosen()).toHaveLength(104);
    key('a', { metaKey: true, shiftKey: true }); expect(chosen()).toEqual([]);
  });
}

it('shortcuts respect search results and leave text fields and menu navigation alone', async () => {
  const chosen = mount('filter', 15), user = userEvent.setup();
  await user.click(file(14));
  const search = screen.getByRole('searchbox');
  await user.type(search, 'file-00');
  const before = chosen();
  expect(fireEvent.keyDown(search, { key: 'a', metaKey: true })).toBe(true);
  expect(chosen()).toEqual(before);
  await user.click(file(0)); key('a', { metaKey: true });
  expect(chosen()).toEqual(ids(0, 1, 3, 4, 5, 6, 7, 8, 9, 14));
  fireEvent.contextMenu(row(1), { clientX: 200, clientY: 300 });
  await screen.findByRole('menu');
  const beforeMenu = chosen();
  await user.keyboard('{ArrowDown}'); expect(chosen()).toEqual(beforeMenu);
  await user.keyboard('{Escape}'); await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Expand preview' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Full preview' }));
  const dialogSearch = dialog.getByRole('searchbox');
  expect(fireEvent.keyDown(dialogSearch, { key: 'a', metaKey: true })).toBe(true);
  expect(fireEvent.keyDown(dialogSearch, { key: 'ArrowDown', shiftKey: true })).toBe(true);
  expect(chosen()).toEqual(beforeMenu);
});

it('list selection can include kept files for tagging, and shortcut help does not change selections', async () => {
  const chosen = mount('list'), user = userEvent.setup();
  await user.click(file(2)); expect(chosen()).toEqual(ids(2));
  key('a', { metaKey: true }); expect(chosen()).toHaveLength(8);
  await user.click(screen.getByRole('button', { name: 'Selection shortcuts' }));
  const help = await screen.findByRole('dialog', { name: 'Selection shortcuts' });
  expect(within(help).getByText('Select through first / last result')).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(chosen()).toHaveLength(8);
});
