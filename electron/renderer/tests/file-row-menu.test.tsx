import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileResults, TagChanges, Tags } from '@/components/file-results';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { Mode, Plan } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });
function Preview({ mode = 'tags', action = mode === 'tags' ? 'tags' : 'trash', reveal, copyPath = () => {} }: { mode?: Mode; action?: Plan['action']; reveal: (file: string) => void; copyPath?: (file: string) => void }) {
  const plan: Plan = {
    id: 'menu', mode, action, createdAt: '', roots: ['/photos'], conflicts: [], warnings: [], total: 3, candidates: 2,
    rows: ['one.jpg', 'sub/one.jpg', 'keep.jpg'].map((relative, i) => ({
      id: relative, relative, name: relative.split('/').at(-1)!, file: `/photos/${relative}`, root: '/photos', size: 100,
      candidate: i < 2, action: i === 2 || action === 'review' ? 'keep' : action, reason: { key: 'reason.listKeepMiss' }, matches: [],
      currentTags: ['Blue\n4'], nextTags: ['Blue\n4', 'Green\n2'],
    })),
  };
  const [selected, setSelected] = useState(new Set(['one.jpg']));
  return <I18nContext.Provider value={language}><FileResults plan={plan} selected={selected} setSelected={setSelected} reveal={reveal} copyPath={copyPath} /></I18nContext.Provider>;
}

for (const mode of ['tags', 'filter'] as const) {
  it(`${mode}: only checked files show tag changes, with selections shared by the workspace and expanded preview`, async () => {
    const user = userEvent.setup();
    render(<Preview mode={mode} action="tags" reveal={() => {}} />);
    const row = (scope: Pick<typeof screen, 'getByRole'>, name: string) => scope.getByRole('checkbox', { name: `Process ${name}` }).closest<HTMLElement>('.file-row')!;
    const expectCurrentOnly = (element: HTMLElement) => {
      expect(within(element).getAllByRole('img', { name: 'Blue' })).toHaveLength(1);
      expect(within(element).queryByRole('img', { name: 'Green' })).toBeNull();
      expect(element.querySelector('.tag-change-arrow')).toBeNull();
    };
    expect(within(row(screen, 'one.jpg')).getByRole('img', { name: 'Green' })).toBeTruthy();
    expectCurrentOnly(row(screen, 'sub/one.jpg'));
    await user.click(screen.getByRole('checkbox', { name: 'Process sub/one.jpg' }));
    expect(within(row(screen, 'sub/one.jpg')).getByRole('img', { name: 'Green' })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Process one.jpg' }));
    expectCurrentOnly(row(screen, 'one.jpg'));

    await user.click(screen.getByRole('button', { name: 'Expand preview' }));
    const dialog = within(await screen.findByRole('dialog'));
    expectCurrentOnly(row(dialog, 'one.jpg'));
    expect(within(row(dialog, 'sub/one.jpg')).getByRole('img', { name: 'Green' })).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Deselect all' }));
    expectCurrentOnly(row(dialog, 'sub/one.jpg'));
    await user.click(dialog.getByRole('button', { name: 'Back to workspace' }));
    expectCurrentOnly(row(screen, 'sub/one.jpg'));
    await user.click(screen.getByRole('button', { name: mode === 'filter' ? 'Select all results' : 'Select all changes' }));
    for (const name of ['one.jpg', 'sub/one.jpg']) expect(within(row(screen, name)).getByRole('img', { name: 'Green' })).toBeTruthy();
  });
}

for (const mode of ['orphans', 'tags', 'list', 'filter'] as const) {
  for (const expanded of [false, true]) {
    it(`${mode}, ${expanded ? 'dialog' : 'workspace'}: right-click reveals and copies the exact row without changing its selection`, async () => {
      const user = userEvent.setup(), reveal = vi.fn(), copyPath = vi.fn();
      render(<Preview mode={mode} reveal={reveal} copyPath={copyPath} />);
      if (expanded) await user.click(screen.getByRole('button', { name: 'Expand preview' }));
      const scope = expanded ? within(await screen.findByRole('dialog')) : screen;
      const checkbox = scope.getByRole('checkbox', { name: 'Process sub/one.jpg' });
      const row = checkbox.closest<HTMLElement>('.file-row')!;
      // The matching/status/blank areas of a row are context-menu targets too.
      fireEvent.contextMenu(row.querySelector('.matching')!, { clientX: 200, clientY: 300 });
      const menu = await screen.findByRole('menu', { name: 'one.jpg' });
      expect(checkbox.getAttribute('aria-checked')).toBe('false');
      expect(row.classList.contains('is-focused')).toBe(true);
      await user.click(within(menu).getByRole('menuitem', { name: 'Show in Finder' }));
      expect(reveal).toHaveBeenCalledExactlyOnceWith('/photos/sub/one.jpg');
      expect(checkbox.getAttribute('aria-checked')).toBe('false');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      fireEvent.contextMenu(row, { clientX: 200, clientY: 300 });
      await user.click(within(await screen.findByRole('menu', { name: 'one.jpg' })).getByRole('menuitem', { name: 'Copy pathname' }));
      expect(copyPath).toHaveBeenCalledExactlyOnceWith('/photos/sub/one.jpg');
      expect(checkbox.getAttribute('aria-checked')).toBe('false');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      if (mode === 'filter') await user.click(scope.getByRole('checkbox', { name: 'Matches only' }));
      const protectedRow = scope.getByRole('checkbox', { name: 'Process keep.jpg' }).closest<HTMLElement>('.file-row')!;
      fireEvent.contextMenu(protectedRow, { clientX: 200, clientY: 400 });
      await screen.findByRole('menu', { name: 'keep.jpg' });
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(document.activeElement).toBe(protectedRow.querySelector('.file-button'));
      expect(reveal).toHaveBeenCalledTimes(1);
      if (expanded) expect(screen.getByRole('dialog')).toBeTruthy();
    });
  }
}

for (const backwards of [false, true]) {
  it(`a row menu supports keyboard opening and ${backwards ? 'Shift+Tab' : 'Tab'} leaves the menu`, async () => {
    const user = userEvent.setup(), reveal = vi.fn();
    render(<Preview reveal={reveal} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Process sub/one.jpg' });
    const file = checkbox.closest('.file-row')!.querySelector<HTMLButtonElement>('.file-button')!;
    const previous = checkbox.closest('.file-row')!.querySelector<HTMLButtonElement>('.image-thumbnail')!;
    const next = screen.getByRole('button', { name: 'Preview image: keep.jpg' });
    file.focus();
    fireEvent.keyDown(file, { key: 'F10', shiftKey: true });
    const menu = await screen.findByRole('menu');
    const item = within(menu).getByRole('menuitem', { name: 'Show in Finder' });
    const copy = within(menu).getByRole('menuitem', { name: 'Copy pathname' });
    await waitFor(() => expect(document.activeElement).toBe(item));
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(document.activeElement).toBe(copy));
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(item));
    await user.tab({ shift: backwards });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(backwards ? previous : next);
    });
    expect(reveal).not.toHaveBeenCalled();
  });
}

it('compact tag changes omit color text while preserving hover names and uncolored labels', () => {
  const { container } = render(<I18nContext.Provider value={language}><TagChanges before={['Blue\n4']} after={['Blue\n4', 'Green\n2', 'Project Alpha\n0']} /></I18nContext.Provider>);
  expect(container.textContent).toBe('Project Alpha');
  expect(screen.getAllByRole('img', { name: 'Blue' })).toHaveLength(2);
  expect(screen.getByRole('img', { name: 'Green' }).title).toBe('Green');
  expect(container.querySelectorAll('.tag-change-arrow')).toHaveLength(1);
});

it('clearing tags shows an empty result, unchanged tags omit the arrow, and conflict labels remain readable', () => {
  const { container, rerender } = render(<I18nContext.Provider value={language}><TagChanges before={['Red\n6']} after={[]} /></I18nContext.Provider>);
  const empty = screen.getByRole('img', { name: 'No tags' });
  expect(empty.title).toBe('No tags');
  expect(empty.textContent).toBe('');
  expect(container.querySelector('.tag-change-arrow')).toBeTruthy();
  rerender(<I18nContext.Provider value={language}><TagChanges before={['Red\n6']} /></I18nContext.Provider>);
  expect(container.querySelector('.tag-change-arrow')).toBeNull();
  rerender(<I18nContext.Provider value={language}><Tags tags={['Selected\n2', 'Rejected\n2']} /></I18nContext.Provider>);
  expect(container.textContent).toBe('SelectedRejected');
});
