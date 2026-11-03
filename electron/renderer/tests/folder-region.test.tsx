import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkflowConfig } from '@/components/workflow-config';
import { defaults } from '@/lib/config';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import en from '../../locales/en-US.json';

const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });

async function revealPath(user: ReturnType<typeof userEvent.setup>, file: string) {
  const row = screen.getByRole('button', { name: file }).closest('.folder-item')!;
  fireEvent.contextMenu(row, { clientX: 200, clientY: 300 });
  const menu = await screen.findByRole('menu', { name: file });
  await user.click(within(menu).getByRole('menuitem', { name: 'Show in Finder' }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

for (const mode of ['orphans', 'tags', 'list'] as const) {
  it(`${mode}: regions choose paths, while reveal and clear controls operate independently`, async () => {
    const user = userEvent.setup(), choose = vi.fn(), update = vi.fn(), reveal = vi.fn();
    const config = { ...defaults()[mode], base: '/reference', targets: ['/target'], list: '/names.txt' };
    const content = (disabled: boolean) => <I18nContext.Provider value={language}><WorkflowConfig config={config} disabled={disabled} choose={choose} update={update} dropped={() => {}} refresh={() => {}} reveal={reveal} /></I18nContext.Provider>;
    const { container, rerender } = render(content(false));
    const cards = container.querySelectorAll<HTMLElement>('.folder-card');
    const source = within(cards[0]).getByRole('button', { name: /Change:/ });
    await user.click(source);
    expect(choose).toHaveBeenLastCalledWith(mode === 'list' ? 'list' : 'base');
    await user.keyboard('{Enter}');
    expect(choose).toHaveBeenCalledTimes(2);
    await user.keyboard(' ');
    expect(choose).toHaveBeenCalledTimes(3);
    const target = within(cards[1]).getByRole('button', { name: '/target' });
    await user.click(target);
    expect(choose).toHaveBeenLastCalledWith('targets', '/target');
    const addTarget = within(cards[1]).getByRole('button', { name: 'Add target folder' });
    await user.click(addTarget);
    expect(choose).toHaveBeenLastCalledWith('targets');
    expect(screen.queryByRole('button', { name: /Show in Finder/ })).toBeNull();
    await revealPath(user, mode === 'list' ? '/names.txt' : '/reference');
    expect(reveal).toHaveBeenLastCalledWith(mode === 'list' ? '/names.txt' : '/reference', mode === 'list' ? 'list' : 'base');
    await revealPath(user, '/target');
    expect(reveal).toHaveBeenLastCalledWith('/target', 'targets');
    await user.click(within(cards[0]).getByRole('button', { name: /Remove/ }));
    expect(update).toHaveBeenLastCalledWith(mode === 'list' ? { list: '' } : { base: '' });
    await user.click(within(cards[1]).getByRole('button', { name: /Remove/ }));
    expect(update).toHaveBeenLastCalledWith({ targets: [] });
    expect(choose).toHaveBeenCalledTimes(5);
    rerender(content(true));
    await user.click(source);
    await user.click(target);
    await user.click(addTarget);
    for (const button of screen.getAllByRole('button', { name: /^\/|Remove/ })) await user.click(button);
    for (const row of container.querySelectorAll('.folder-item')) fireEvent.contextMenu(row);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(choose).toHaveBeenCalledTimes(5);
    expect(reveal).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it(`${mode}: menus follow the exact target when folders are added or removed`, async () => {
    const user = userEvent.setup(), choose = vi.fn(), update = vi.fn(), reveal = vi.fn();
    const first = '/one/photos', second = '/two/photos';
    const content = (targets: string[]) => <I18nContext.Provider value={language}><WorkflowConfig config={{ ...defaults()[mode], base: '/reference', list: '/names.txt', targets }} disabled={false} choose={choose} update={update} dropped={() => {}} refresh={() => {}} reveal={reveal} /></I18nContext.Provider>;
    const { rerender } = render(content([first]));
    await revealPath(user, first);
    expect(reveal).toHaveBeenLastCalledWith(first, 'targets');
    await user.click(screen.getByRole('button', { name: 'Add target folder' }));
    expect(choose).toHaveBeenCalledExactlyOnceWith('targets');
    rerender(content([first, second]));
    await revealPath(user, second);
    expect(reveal).toHaveBeenLastCalledWith(second, 'targets');
    await user.click(screen.getByRole('button', { name: `Remove ${first}` }));
    expect(update).toHaveBeenCalledExactlyOnceWith({ targets: [second] });
    rerender(content([second]));
    await revealPath(user, second);
    expect(reveal).toHaveBeenLastCalledWith(second, 'targets');
    expect(reveal).toHaveBeenCalledTimes(3);
    expect(choose).toHaveBeenCalledTimes(1);
  });
}

it('the pasted-list region focuses its editor and its clear button only clears the pasted text', async () => {
  const user = userEvent.setup(), choose = vi.fn(), update = vi.fn();
  render(<I18nContext.Provider value={language}><WorkflowConfig config={{ ...defaults().list, listSource: 'text', listText: 'photo.jpg', list: '/saved.txt', targets: ['/target'] }} disabled={false} choose={choose} update={update} dropped={() => {}} refresh={() => {}} reveal={() => {}} /></I18nContext.Provider>);
  await user.click(screen.getByRole('button', { name: 'Edit pasted filename list' }));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'One filename per line' }));
  await user.click(screen.getByRole('button', { name: 'Clear pasted filename list' }));
  expect(update).toHaveBeenCalledExactlyOnceWith({ listText: '' });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'One filename per line' }));
  expect(choose).not.toHaveBeenCalled();
});

it('same-folder mode can reveal and clear its folder without changing the separate targets', async () => {
  const user = userEvent.setup(), choose = vi.fn(), update = vi.fn(), reveal = vi.fn();
  render(<I18nContext.Provider value={language}><WorkflowConfig config={{ ...defaults().orphans, mixed: true, base: '/mixed', targets: ['/target'] }} disabled={false} choose={choose} update={update} dropped={() => {}} refresh={() => {}} reveal={reveal} /></I18nContext.Provider>);
  await revealPath(user, '/mixed');
  expect(reveal).toHaveBeenCalledExactlyOnceWith('/mixed', 'base');
  await user.click(screen.getByRole('button', { name: 'Remove /mixed' }));
  expect(update).toHaveBeenCalledExactlyOnceWith({ base: '' });
  expect(choose).not.toHaveBeenCalled();
});

for (const backwards of [false, true]) {
  it(`folder menus open from the keyboard and ${backwards ? 'Shift+Tab' : 'Tab'} moves to the adjacent control`, async () => {
    const user = userEvent.setup(), choose = vi.fn(), reveal = vi.fn();
    render(<I18nContext.Provider value={language}><WorkflowConfig config={{ ...defaults().tags, base: '/reference', targets: ['/target'] }} disabled={false} choose={choose} update={() => {}} dropped={() => {}} refresh={() => {}} reveal={reveal} /></I18nContext.Provider>);
    const folder = screen.getByRole('button', { name: '/target' });
    folder.focus();
    fireEvent.keyDown(folder, { key: 'F10', shiftKey: true });
    const menu = await screen.findByRole('menu', { name: '/target' });
    const item = within(menu).getByRole('menuitem', { name: 'Show in Finder' });
    await waitFor(() => expect(document.activeElement).toBe(item));
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(document.activeElement).toBe(item);
    await user.tab({ shift: backwards });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: backwards ? 'Add target folder' : 'Remove /target' }));
    });
    folder.focus();
    fireEvent.keyDown(folder, { key: 'ContextMenu' });
    await screen.findByRole('menu', { name: '/target' });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(folder);
    });
    expect(choose).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });
}
