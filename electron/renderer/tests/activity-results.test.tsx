import { expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Activity } from '@/components/activity';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { Run } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });

it('a cancelled tag run only shows applied changes for completed files', () => {
  const run: Run = {
    id: 'cancelled-tags', mode: 'filter', action: 'tags', startedAt: '2026-11-01T00:00:00Z', finishedAt: '2026-11-01T00:00:01Z',
    completed: 1, failed: 0, unattempted: 1, cancelled: true, error: null,
    records: ['completed', 'pending'].map((status, index) => ({ file: `/fixtures/${index}.txt`, name: `${index}.txt`, action: 'tags',
      status: status as 'completed' | 'pending', beforeTags: ['Green\n2'], afterTags: ['Red\n6'] })),
  };
  render(<I18nContext.Provider value={language}><Activity run={run} exportRun={() => {}} refresh={() => {}} /></I18nContext.Provider>);
  const completed = within(screen.getByText('0.txt').closest<HTMLElement>('.run-row')!);
  const pending = within(screen.getByText('1.txt').closest<HTMLElement>('.run-row')!);
  expect(completed.getByRole('img', { name: 'Green' })).toBeTruthy();
  expect(completed.getByRole('img', { name: 'Red' })).toBeTruthy();
  expect(pending.getByRole('img', { name: 'Green' })).toBeTruthy();
  expect(pending.queryByRole('img', { name: 'Red' })).toBeNull();
  expect(pending.getByText(messages['run.notAttempted'])).toBeTruthy();
});
