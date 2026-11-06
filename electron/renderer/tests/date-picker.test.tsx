import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '@/components/date-picker';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import en from '../../locales/en-US.json';
import zh from '../../locales/zh-CN.json';
import ja from '../../locales/ja-JP.json';

function Picker({ locale = 'en-US', initial = '2026-03-08', disabled = false, change = () => {} }: {
  locale?: string; initial?: string; disabled?: boolean; change?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const i18n = makeTranslator({ current: locale, warnings: [], bundles: Object.entries({ 'en-US': en, 'zh-CN': zh, 'ja-JP': ja }).map(([code, messages]) => ({
    code, label: messages._meta.label, direction: 'ltr', messages: Object.fromEntries(Object.entries(messages).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  })) });
  return <I18nContext.Provider value={i18n}><button>Before</button>
    <DatePicker label={i18n.t('filter.modifiedFrom')} value={value} disabled={disabled} onChange={next => { setValue(next); change(next); }} />
    <button>After</button><output aria-label="Selected date">{value}</output>
  </I18nContext.Provider>;
}

it('selects a local date using the keyboard, returns focus, and clears an individual bound', async () => {
  const user = userEvent.setup(), change = vi.fn();
  render(<Picker change={change} />);
  const trigger = screen.getByRole('button', { name: 'Modified from' });
  await user.click(trigger);
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toContain('March 8th, 2026'));
  await user.keyboard('{ArrowRight}{Enter}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status', { name: 'Selected date' }).textContent).toBe('2026-03-09');
  expect(change).toHaveBeenLastCalledWith('2026-03-09');
  expect(document.activeElement).toBe(trigger);
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: 'Clear date' }));
  expect(change).toHaveBeenLastCalledWith('');
  expect(trigger.textContent).toBe('Any date');
  await user.click(trigger);
  expect((screen.getByRole('button', { name: 'Clear date' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Today' }));
  const now = new Date();
  expect(change).toHaveBeenLastCalledWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
});

it('uses the month/year selectors to reach a leap day without changing the filter until selection', async () => {
  const user = userEvent.setup(), change = vi.fn();
  render(<Picker change={change} />);
  await user.click(screen.getByRole('button', { name: 'Modified from' }));
  await user.click(screen.getByRole('combobox', { name: 'Choose the Year' }));
  await user.click(await screen.findByRole('option', { name: '2024' }));
  await user.click(screen.getByRole('combobox', { name: 'Choose the Month' }));
  await user.click(await screen.findByRole('option', { name: 'Feb' }));
  expect(change).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /Thursday, February 29th, 2024/ }));
  expect(change).toHaveBeenLastCalledWith('2024-02-29');
});

it('lets Tab leave the calendar and Escape return to the trigger without changing the date', async () => {
  const user = userEvent.setup(), change = vi.fn();
  render(<Picker change={change} />);
  const trigger = screen.getByRole('button', { name: 'Modified from' });
  await user.click(trigger);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await user.click(trigger);
  screen.getByRole('button', { name: 'Clear date' }).focus();
  await user.tab();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' })));
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(trigger);
  screen.getByRole('button', { name: 'Go to the Previous Month' }).focus();
  await user.tab({ shift: true });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Before' })));
  expect(change).not.toHaveBeenCalled();
});

for (const [locale, label, clear, month] of [
  ['zh-CN', '修改日期起始', '清空日期', '选择月份'],
  ['ja-JP', '更新日の開始', '日付をクリア', '月を選択'],
]) {
  it(`localizes the calendar and actions in ${locale}`, async () => {
    const user = userEvent.setup();
    render(<Picker locale={locale} />);
    await user.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('combobox', { name: month })).toBeTruthy();
    expect(screen.getByRole('button', { name: clear })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Go to the Next Month' })).toBeNull();
  });
}

it('cannot open while the workflow is locked', async () => {
  const user = userEvent.setup();
  render(<Picker disabled />);
  await user.click(screen.getByRole('button', { name: 'Modified from' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
