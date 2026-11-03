import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileResults } from '@/components/file-results';
import { WorkflowHeader } from '@/components/workflow-config';
import { usePreviewFocus } from '@/lib/use-preview-focus';
import { defaults } from '@/lib/config';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { Plan } from '@/types';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });
const plan: Plan = {
  id: 'swipe', mode: 'list', createdAt: '', roots: ['/photos'], conflicts: [], warnings: [], total: 3, candidates: 3,
  rows: ['one.jpg', 'two.jpg', 'three.jpg'].map(name => ({ id: name, name, relative: name, file: `/photos/${name}`, root: '/photos', size: 100, candidate: true, action: 'trash', reason: { key: 'reason.listKeepMiss' }, matches: [] })),
};
function Workspace({ enabled = true, mode = 'list' }: { enabled?: boolean; mode?: string }) {
  const focus = usePreviewFocus(enabled, mode);
  const [selected, setSelected] = useState(new Set(plan.rows.map(row => row.id)));
  return <I18nContext.Provider value={language}><main>
    <WorkflowHeader ref={focus.toggleRef} config={{ ...defaults().list, list: '/names.txt', targets: ['/photos'] }} collapsed={focus.focused} controls={focus.settingsId} toggle={() => focus.focused ? focus.restore() : focus.minimize()} reset={() => {}} />
    <div ref={focus.settingsRef} id={focus.settingsId} data-testid="settings" inert={focus.focused} aria-hidden={focus.focused || undefined}>
      <button className="folder-hit-area">Choose folder</button><input aria-label="Rule" defaultValue="unchanged" />
    </div>
    <div ref={focus.previewRef}><FileResults plan={plan} selected={selected} setSelected={setSelected} reveal={() => {}} copyPath={() => {}} /></div>
  </main></I18nContext.Provider>;
}
let now = 1000;
beforeEach(() => { now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now); });
function wheel(target: Element, deltaY: number, after = 30, options: WheelEventInit = {}) {
  now += after;
  return fireEvent.wheel(target, { deltaY, bubbles: true, cancelable: true, ...options });
}
function list() { return screen.getByRole('region', { name: 'Preview' }).querySelector<HTMLElement>('.file-scroll')!; }
function swipeUp() { wheel(list(), 12); wheel(list(), 14); }

it('ordinary scrolling lifts preview into a compact folder bar while preserving the current row, search, selection and settings', async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  const settings = screen.getByTestId('settings');
  await user.type(screen.getByRole('searchbox'), '.jpg');
  await user.click(screen.getByRole('checkbox', { name: 'Process two.jpg' }));
  const folder = screen.getByRole('button', { name: 'Choose folder' });
  folder.focus();
  const scroller = list();
  scroller.scrollTop = 42;
  wheel(scroller, 12);
  scroller.scrollTop = 100; // Browser scrolling before the gesture is recognized.
  expect(wheel(scroller, 14, 100)).toBe(false);
  expect(settings.hasAttribute('inert')).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Preview' }));
  expect(scroller.scrollTop).toBe(42);
  expect(wheel(scroller, 80)).toBe(false); // Initial momentum is absorbed.
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('.jpg');
  expect(screen.getByRole('checkbox', { name: 'Process two.jpg' }).getAttribute('aria-checked')).toBe('false');
  const title = screen.getByRole('button', { name: /Show all folder options$/ });
  expect(title.textContent).toContain('names.txt');
  expect(title.textContent).toContain('photos');
  await user.click(title);
  expect(settings.hasAttribute('inert')).toBe(false);
  expect((screen.getByRole('textbox', { name: 'Rule' }) as HTMLInputElement).value).toBe('unchanged');
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it('horizontal and zoom gestures and text fields keep their own behavior', () => {
  render(<Workspace />);
  const scroller = list();
  expect(wheel(scroller, 200, 300, { deltaX: 250 })).toBe(true);
  expect(wheel(scroller, 200, 300, { ctrlKey: true })).toBe(true);
  expect(wheel(screen.getByRole('searchbox'), 200)).toBe(true);
  expect(wheel(screen.getByRole('textbox', { name: 'Rule' }), 200)).toBe(true);
  expect(screen.queryByRole('button', { name: /Show all folder options$/ })).toBeNull();
});

it('ordinary scrolling over the folder settings also collapses them', () => {
  render(<Workspace />);
  wheel(screen.getByTestId('settings'), 30);
  expect(screen.getByRole('button', { name: /Show all folder options$/ })).toBeTruthy();
});

it('downward scrolling through the list keeps preview at the top until a fresh downward swipe starts at the first row', () => {
  render(<Workspace />);
  swipeUp();
  const scroller = list();
  scroller.scrollTop = 140;
  expect(wheel(scroller, -70, 500)).toBe(true);
  scroller.scrollTop = 0;
  expect(wheel(scroller, -70)).toBe(true);
  expect(screen.getByRole('button', { name: /Show all folder options$/ })).toBeTruthy();
  expect(wheel(scroller, -130, 300)).toBe(false);
  expect(screen.queryByRole('button', { name: /Show all folder options$/ })).toBeNull();
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
});

it('scrolling in the full-preview dialog does not collapse the workspace behind it', async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(screen.getByRole('button', { name: 'Expand preview' }));
  const dialog = within(await screen.findByRole('dialog'));
  wheel(dialog.getByRole('region', { name: 'Preview' }), 200);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
});

it('invalidating a preview or changing workflows restores the configuration', () => {
  const { rerender } = render(<Workspace />);
  swipeUp();
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(true);
  rerender(<Workspace enabled={false} />);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
  wheel(list(), 200);
  expect(screen.queryByRole('button', { name: /Show all folder options$/ })).toBeNull();
  rerender(<Workspace />);
  swipeUp();
  rerender(<Workspace mode="tags" />);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
});
