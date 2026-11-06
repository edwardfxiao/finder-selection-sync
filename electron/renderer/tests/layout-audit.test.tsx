import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/app';
import { FileResults } from '@/components/file-results';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import { defaults } from '@/lib/config';
import type { Catalog, FinderAPI, Plan } from '@/types';
import en from '../../locales/en-US.json';

const catalog: Catalog = { current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr',
  messages: Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }] };
const language = makeTranslator(catalog);

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

// These audit cases exercise React state and real Radix keyboard behavior only.
// Actual dimensions and clipping require the separate native Electron harness.
it('More options remains expanded when returning to its workflow', async () => {
  localStorage.setItem('finder-workbench', JSON.stringify({ mode: 'list', config: defaults() }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  window.finder = {
    version: vi.fn().mockResolvedValue('test'), locales: vi.fn().mockResolvedValue(catalog), history: vi.fn().mockResolvedValue([]),
    setTheme: vi.fn().mockResolvedValue(undefined), onProgress: vi.fn(() => () => {}),
    discard: vi.fn().mockResolvedValue(undefined), discardAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as FinderAPI;
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Filter files' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'More options' }));
  expect(screen.getByRole('textbox', { name: 'Only clean these file types' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Filter files' }));
  await user.click(screen.getByRole('button', { name: 'Organize by list' }));
  expect(screen.getByRole('button', { name: 'Fewer options' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Only clean these file types' })).toBeTruthy();
});

function results() {
  const plan: Plan = {
    id: 'audit', mode: 'filter', action: 'trash', createdAt: '', roots: ['/photos'], conflicts: [], warnings: [], total: 105, candidates: 105, matched: 105,
    rows: Array.from({ length: 105 }, (_, index) => ({ id: `row-${index}`, file: `/photos/file-${index}.txt`, name: `file-${index}.txt`, relative: `file-${index}.txt`, root: '/photos', size: 1, candidate: true, matched: true, action: 'trash', reason: { key: 'filter.reasonAll' }, matches: [] })),
  };
  render(<I18nContext.Provider value={language}><FileResults plan={plan} selected={new Set()} setSelected={() => {}} reveal={() => {}} copyPath={() => {}} /></I18nContext.Provider>);
}

for (const expanded of [false, true]) {
  for (const key of ['Tab', 'Shift+Tab', 'Escape']) {
    it(`${expanded ? 'expanded' : 'inline'} selection shortcuts: ${key} closes help and restores the correct focus`, async () => {
      const user = userEvent.setup();
      results();
      if (expanded) {
        await user.click(screen.getByRole('button', { name: 'Expand preview' }));
        await screen.findByRole('dialog', { name: 'Full preview' });
      }
      const opener = screen.getByRole('button', { name: 'Selection shortcuts' });
      await user.click(opener);
      await screen.findByRole('dialog', { name: 'Selection shortcuts' });
      if (key === 'Escape') await user.keyboard('{Escape}');
      else await user.tab({ shift: key === 'Shift+Tab' });
      const target = key === 'Escape' ? opener : screen.getByRole('button', { name: key === 'Tab' ? 'Next' : 'Invert selection' });
      await waitFor(() => expect(document.activeElement).toBe(target));
      expect(screen.queryByRole('dialog', { name: 'Selection shortcuts' })).toBeNull();
      if (expanded) expect(screen.getByRole('dialog', { name: 'Full preview' })).toBeTruthy();
    });
  }
}
