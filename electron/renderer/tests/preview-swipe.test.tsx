import { useState } from 'react';
import { expect, it } from 'vitest';
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
function Workspace({ enabled = true, mode = 'list', empty = false }: { enabled?: boolean; mode?: string; empty?: boolean }) {
  const focus = usePreviewFocus(enabled, mode);
  const [selected, setSelected] = useState(new Set(plan.rows.map(row => row.id)));
  return <I18nContext.Provider value={language}><main>
    <WorkflowHeader ref={focus.toggleRef} config={{ ...defaults().list, list: '/names.txt', targets: ['/photos'] }} collapsed={focus.focused} controls={focus.settingsId} toggle={() => focus.focused ? focus.restore() : focus.minimize()} reset={() => {}} />
    <div ref={focus.settingsRef} id={focus.settingsId} data-testid="settings" inert={focus.focused} aria-hidden={focus.focused || undefined}>
      <button className="folder-hit-area">Choose folder</button><input aria-label="Rule" defaultValue="unchanged" />
    </div>
    <div ref={focus.previewRef}>{empty ? <div className="empty">Choose folders to start</div> : <FileResults plan={plan} selected={selected} setSelected={setSelected} reveal={() => {}} copyPath={() => {}} />}</div>
  </main></I18nContext.Provider>;
}
function wheel(target: Element, deltaY: number, options: WheelEventInit = {}) {
  return fireEvent.wheel(target, { deltaY, bubbles: true, cancelable: true, ...options });
}
function list() { return screen.getByRole('region', { name: 'Preview' }).querySelector<HTMLElement>('.file-scroll')!; }

it('slow scrolling and fast swipes preserve settings, search, focus and selected files', async () => {
  const user = userEvent.setup();
  const { container } = render(<Workspace />);
  await user.type(screen.getByRole('searchbox'), '.jpg');
  await user.click(screen.getByRole('checkbox', { name: 'Process two.jpg' }));
  const folder = screen.getByRole('button', { name: 'Choose folder' });
  folder.focus();
  for (const target of [screen.getByTestId('settings'), list()]) {
    for (const delta of [2, 12, 14, 80, 300, -2, -14, -80, -300]) expect(wheel(target, delta)).toBe(true);
  }
  const workspace = container.querySelector('main')!;
  workspace.scrollTop = 900;
  fireEvent.scroll(workspace);
  expect(workspace.scrollTop).toBe(900);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(folder);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('.jpg');
  expect(screen.getByRole('checkbox', { name: 'Process two.jpg' }).getAttribute('aria-checked')).toBe('false');
});

it('only the title toggles settings; scrolling back to the first row does not reopen them', async () => {
  const user = userEvent.setup();
  const { container } = render(<Workspace />);
  const workspace = container.querySelector('main')!;
  workspace.scrollTop = 900;
  await user.click(screen.getByRole('button', { name: /Collapse folder options$/ }));
  expect(workspace.scrollTop).toBe(0);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(true);
  for (const delta of [100, -100, -300, -20]) expect(wheel(list(), delta)).toBe(true);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(true);
  workspace.scrollTop = 400;
  const title = screen.getByRole('button', { name: /Show all folder options$/ });
  await user.click(title);
  expect(workspace.scrollTop).toBe(0);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
  expect((screen.getByRole('textbox', { name: 'Rule' }) as HTMLInputElement).value).toBe('unchanged');
  expect(screen.getAllByRole('checkbox', { name: /^Process /, checked: true })).toHaveLength(3);
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it('empty workflows and zero search results use the same native scrolling behavior', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<Workspace empty />);
  expect(wheel(screen.getByText('Choose folders to start'), 300)).toBe(true);
  expect(wheel(screen.getByTestId('settings'), -300)).toBe(true);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
  rerender(<Workspace />);
  await user.type(screen.getByRole('searchbox'), 'does-not-exist');
  expect(screen.queryByRole('checkbox', { name: /^Process / })).toBeNull();
  expect(wheel(list(), 300)).toBe(true);
  expect(wheel(list(), -300)).toBe(true);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
});

it('horizontal gestures, zoom and form inputs keep native behavior', () => {
  render(<Workspace />);
  expect(wheel(list(), 200, { deltaX: 250 })).toBe(true);
  expect(wheel(list(), 200, { ctrlKey: true })).toBe(true);
  expect(wheel(screen.getByRole('searchbox'), 200)).toBe(true);
  expect(wheel(screen.getByRole('textbox', { name: 'Rule' }), 200)).toBe(true);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
});

it('expanded-preview scrolling leaves the workspace layout unchanged', async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(screen.getByRole('button', { name: 'Expand preview' }));
  const dialog = within(await screen.findByRole('dialog'));
  wheel(dialog.getByRole('region', { name: 'Preview' }), 300);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
});

it('changing workflows or entering execution restores settings and the top of the page', async () => {
  const user = userEvent.setup();
  const { rerender, container } = render(<Workspace />);
  const workspace = container.querySelector('main')!;
  await user.click(screen.getByRole('button', { name: /Collapse folder options$/ }));
  workspace.scrollTop = 400;
  rerender(<Workspace enabled={false} />);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
  expect(workspace.scrollTop).toBe(0);
  rerender(<Workspace />);
  await user.click(screen.getByRole('button', { name: /Collapse folder options$/ }));
  workspace.scrollTop = 600;
  rerender(<Workspace mode="tags" />);
  expect(screen.getByTestId('settings').hasAttribute('inert')).toBe(false);
  expect(workspace.scrollTop).toBe(0);
});
