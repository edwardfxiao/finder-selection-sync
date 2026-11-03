import { useState } from 'react';
import { expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileResults } from '@/components/file-results';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { Plan } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });
const plan: Plan = {
  id: 'preview', mode: 'list', createdAt: '', roots: ['/photos'], conflicts: [], warnings: [], total: 205, candidates: 204,
  rows: Array.from({ length: 205 }, (_, index) => {
    const name = `photo-${String(index).padStart(3, '0')}.jpg`;
    return { id: `row-${index}`, name, relative: name, file: `/photos/${name}`, root: '/photos', size: 100, candidate: index !== 10, action: index !== 10 ? 'trash' : 'keep', reason: { key: 'reason.listKeepMiss' }, matches: [] };
  }),
};
function Preview() {
  const [selected, setSelected] = useState(new Set(plan.rows.filter(row => row.candidate).map(row => row.id)));
  return <I18nContext.Provider value={language}><FileResults plan={plan} selected={selected} setSelected={setSelected} reveal={() => {}} copyPath={() => {}} /></I18nContext.Provider>;
}
// Real Radix focus traversal over 205 rows can exceed 5s on shared CI runners.
it('expanded preview preserves search, pagination and selection when returning to the workspace', { timeout: 20000 }, async () => {
  const user = userEvent.setup();
  render(<Preview />);
  const open = screen.getByRole('button', { name: 'Expand preview' });
  await user.click(open);
  const dialog = within(await screen.findByRole('dialog', { name: 'Full preview' }));
  const search = dialog.getByRole('searchbox', { name: 'Find a file' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  await user.type(search, 'photo-204');
  const checkbox = dialog.getByRole('checkbox', { name: 'Process photo-204.jpg' });
  await user.click(checkbox);
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  await user.click(dialog.getByRole('button', { name: 'Back to workspace' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('photo-204');
  expect(screen.getByRole('checkbox', { name: 'Process photo-204.jpg' }).getAttribute('aria-checked')).toBe('false');
  await waitFor(() => expect(document.activeElement).toBe(open));
  await user.click(open);
  const reopened = within(await screen.findByRole('dialog'));
  await user.clear(reopened.getByRole('searchbox'));
  await user.click(reopened.getByRole('button', { name: 'Next' }));
  expect(reopened.getByRole('checkbox', { name: 'Process photo-100.jpg' })).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('checkbox', { name: 'Process photo-100.jpg' })).toBeTruthy();
});
it('the changes-only filter remains shared and protected files cannot be checked in the dialog', { timeout: 20000 }, async () => {
  const user = userEvent.setup();
  render(<Preview />);
  await user.click(screen.getByRole('button', { name: 'Expand preview' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect((dialog.getByRole('checkbox', { name: 'Process photo-010.jpg' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(dialog.getByRole('checkbox', { name: 'Changes only' }));
  expect(dialog.queryByRole('checkbox', { name: 'Process photo-010.jpg' })).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('checkbox', { name: 'Changes only' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByRole('checkbox', { name: 'Process photo-010.jpg' })).toBeNull();
});
