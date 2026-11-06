import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileResults } from '@/components/file-results';
import { SelectedTagsDialog } from '@/components/selected-tags-dialog';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { Mode, Plan, Row } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });
const rows: Row[] = ['one.txt', 'two.txt'].map(name => ({
  id: name, name, relative: name, file: `/files/${name}`, root: '/files', size: 100,
  candidate: true, matched: true, action: 'trash', reason: { key: 'filter.reasonMatched' }, matches: [], currentTags: ['Red\n6'],
}));

it('switching from the color menu to Clear file tags keeps keyboard focus inside the tag dialog', async () => {
  const apply = vi.fn().mockResolvedValue(undefined), user = userEvent.setup();
  render(<I18nContext.Provider value={language}><SelectedTagsDialog rows={rows} initialColors={['green']} initialMerge busy={false} close={() => {}} apply={apply} /></I18nContext.Provider>);
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Tags' }));
  const clear = await screen.findByRole('menuitem', { name: 'Clear file tags' });
  clear.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  const action = within(dialog).getByRole('combobox', { name: 'Action' });
  expect(action.textContent).toBe('Clear file tags');
  await waitFor(() => expect(document.activeElement).toBe(action));
  expect(apply).not.toHaveBeenCalled();
});

it('file context actions target their row without changing hidden selections in every workflow', async () => {
  const user = userEvent.setup();
  for (const mode of ['orphans', 'tags', 'list', 'filter', 'compare'] as Mode[]) {
    const reveal = vi.fn(), copy = vi.fn();
    const plan: Plan = { id: mode, mode, action: mode === 'compare' ? 'review' : mode === 'tags' ? 'tags' : 'trash',
      rows, roots: ['/files'], createdAt: '', total: 2, candidates: 2, matched: 2, conflicts: [], warnings: [] };
    function Preview() {
      const [selected, setSelected] = useState(new Set(['one.txt']));
      return <I18nContext.Provider value={language}><FileResults plan={plan} selected={selected} setSelected={setSelected} reveal={reveal} copyPath={copy} /></I18nContext.Provider>;
    }
    const rendered = render(<Preview />);
    await user.type(screen.getByRole('searchbox'), 'two.txt');
    const row = screen.getByRole('checkbox', { name: 'Process two.txt' }).closest<HTMLElement>('[data-file-row]')!;
    const filename = row.querySelector<HTMLButtonElement>('.file-button')!;
    filename.focus();
    fireEvent.keyDown(filename, { key: 'F10', shiftKey: true });
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy pathname' }));
    expect(copy).toHaveBeenCalledExactlyOnceWith('/files/two.txt');
    expect(reveal).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(filename));
    expect(screen.getByText('1 selected outside these results')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Process two.txt' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Show in Finder' }));
    expect(reveal).toHaveBeenCalledExactlyOnceWith('/files/two.txt');
    expect(screen.getByText('1 selected outside these results')).toBeTruthy();
    rendered.unmount();
  }
});
