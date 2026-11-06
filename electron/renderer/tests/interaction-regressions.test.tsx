import { useState } from 'react';
import { expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileResults } from '@/components/file-results';
import { SelectedTagsDialog } from '@/components/selected-tags-dialog';
import { Activity } from '@/components/activity';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { Mode, Plan, Row, Run } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });
const rows: Row[] = ['one.txt', 'two.txt'].map(name => ({ id: name, name, relative: name, file: `/photos/${name}`, root: '/photos', size: 100, candidate: true, action: 'trash', reason: { key: 'reason.listKeepMiss' }, matches: [] }));

function Results({ mode, resultRows = rows, initiallySelected = [] }: { mode: Mode; resultRows?: Row[]; initiallySelected?: string[] }) {
  const plan: Plan = { id: 'audit', mode, createdAt: '', roots: ['/photos'], conflicts: [], warnings: [], total: resultRows.length, candidates: resultRows.filter(row => row.candidate).length, rows: resultRows };
  const [selected, setSelected] = useState(new Set(initiallySelected));
  return <I18nContext.Provider value={language}><FileResults plan={plan} selected={selected} setSelected={setSelected} reveal={() => {}} copyPath={() => {}} /></I18nContext.Provider>;
}

it('searching keeps earlier selections, reports hidden selections, and never treats pagination as hidden', async () => {
  const user = userEvent.setup();
  const many = Array.from({ length: 205 }, (_, i) => ({ ...rows[0], id: String(i), relative: `file-${i}.txt`, name: `file-${i}.txt`, file: `/photos/file-${i}.txt` }));
  const { container } = render(<Results mode="list" resultRows={many} initiallySelected={['204']} />);
  expect(container.querySelector('.selection-hidden')).toBeNull();
  const search = screen.getByRole('searchbox');
  await user.type(search, 'file-0.txt');
  expect(screen.getByText('1 selected outside these results')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Select all changes' }));
  expect(screen.getByText('2 selected')).toBeTruthy();
  await user.clear(search);
  expect(container.querySelector('.selection-hidden')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('checkbox', { name: 'Process file-204.txt' }).getAttribute('aria-checked')).toBe('true');
});

for (const mode of ['filter', 'compare'] as const) {
  it(`${mode}: matching files with unchanged tags stay selectable, while hard links remain protected`, async () => {
    const user = userEvent.setup();
    const unchanged = { ...rows[0], candidate: false, action: 'keep' as const, matched: true, reason: { key: 'reason.tagsUnchanged' } };
    const protectedFile = { ...rows[1], candidate: false, action: 'keep' as const, matched: true, reason: { key: 'reason.hardLink' } };
    render(<Results mode={mode} resultRows={[unchanged, protectedFile]} />);
    const matching = screen.getByRole('checkbox', { name: 'Process one.txt' }) as HTMLButtonElement;
    const hardLink = screen.getByRole('checkbox', { name: 'Process two.txt' }) as HTMLButtonElement;
    expect(matching.disabled).toBe(false);
    expect(hardLink.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Select all results' }));
    expect(matching.getAttribute('aria-checked')).toBe('true');
    expect(hardLink.getAttribute('aria-checked')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Invert selection' }));
    expect(matching.getAttribute('aria-checked')).toBe('false');
    expect(hardLink.getAttribute('aria-checked')).toBe('false');
  });
}

for (const mode of ['orphans', 'tags', 'list'] as const) {
  it(`${mode}: selecting all changes respects the current filename search`, async () => {
    const user = userEvent.setup();
    render(<Results mode={mode} />);
    const search = screen.getByRole('searchbox');
    await user.type(search, 'one.txt');
    await user.click(screen.getByRole('button', { name: 'Select all changes' }));
    await user.clear(search);
    expect(screen.getByRole('checkbox', { name: 'Process one.txt' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Process two.txt' }).getAttribute('aria-checked')).toBe('false');
  });
}

function ListTags() {
  const [open, setOpen] = useState(false);
  return <I18nContext.Provider value={language}>
    <button onClick={() => setOpen(true)}>Open tags</button>
    {open && <SelectedTagsDialog rows={rows} initialColors={['green']} initialMerge busy={false} close={() => setOpen(false)} apply={async () => {}} />}
    <button>Next control</button>
  </I18nContext.Provider>;
}
for (const method of ['Cancel', 'Close', 'Escape']) {
  it(`${method} in the independent tags dialog restores focus to its opener`, async () => {
    const user = userEvent.setup();
    render(<ListTags />);
    const opener = screen.getByRole('button', { name: 'Open tags' });
    await user.click(opener);
    await screen.findByRole('dialog');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Action' })));
    if (method === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: method }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
}

it('Activity pagination starts at the first record of the new page', async () => {
  const user = userEvent.setup();
  const run: Run = {
    id: 'audit-run', mode: 'list', action: 'trash', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    completed: 205, failed: 0, unattempted: 0, cancelled: false, error: null,
    records: Array.from({ length: 205 }, (_, i) => ({ file: `/photos/photo-${i}.txt`, name: `photo-${i}.txt`, action: 'trash', status: 'completed' })),
  };
  const { container } = render(<I18nContext.Provider value={language}><Activity run={run} exportRun={() => {}} back={() => {}} /></I18nContext.Provider>);
  const list = container.querySelector<HTMLElement>('.file-scroll')!;
  list.scrollTop = 1200;
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('photo-100.txt')).toBeTruthy();
  expect(list.scrollTop).toBe(0);
});
