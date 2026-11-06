import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileResults } from '@/components/file-results';
import { ImageThumbnail } from '@/components/image-preview';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import type { FinderAPI, Plan } from '@/types';
import en from '../../locales/en-US.json';

const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';
const image = { dataURL, width: 120, height: 90 };
const messages = Object.fromEntries(Object.entries(en).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const language = makeTranslator({ current: 'en-US', warnings: [], bundles: [{ code: 'en-US', label: 'English', direction: 'ltr', messages }] });
const plan: Plan = {
  id: 'images', mode: 'tags', createdAt: '', roots: ['/photos'], conflicts: [], warnings: [], total: 2, candidates: 1,
  rows: ['photo.jpg', 'photo.xmp'].map((name, i) => ({ id: name, name, relative: name, file: `/photos/${name}`, root: '/photos', size: 100,
    candidate: !i, action: i ? 'keep' : 'tags', reason: { key: 'reason.listKeepMiss' }, matches: [], currentTags: [], nextTags: ['Green\n2'] })),
};
let savedFinder: FinderAPI;
beforeEach(() => { savedFinder = window.finder; });
afterEach(() => { window.finder = savedFinder; vi.unstubAllGlobals(); });

for (const expanded of [false, true]) {
  it(`a thumbnail in the ${expanded ? 'expanded preview' : 'workspace'} opens a large image and returns focus without changing selection`, async () => {
    const request = vi.fn<FinderAPI['image']>().mockResolvedValue(image), reveal = vi.fn(), selected = vi.fn();
    window.finder = { image: request } as unknown as FinderAPI;
    const user = userEvent.setup();
    render(<I18nContext.Provider value={language}><FileResults plan={plan} selected={new Set(['photo.jpg'])} setSelected={selected} reveal={reveal} copyPath={() => {}} /></I18nContext.Provider>);
    if (expanded) await user.click(screen.getByRole('button', { name: 'Expand preview' }));
    const scope = expanded ? within(await screen.findByRole('dialog', { name: 'Full preview' })) : screen;
    const thumbnail = scope.getByRole('button', { name: 'Preview image: photo.jpg' });
    await waitFor(() => expect(thumbnail.querySelector('img')?.getAttribute('src')).toBe(dataURL));
    expect(request.mock.calls.every(([file]) => file === '/photos/photo.jpg')).toBe(true);
    await user.click(thumbnail);
    const viewer = within(await screen.findByRole('dialog', { name: 'photo.jpg' }));
    expect(await viewer.findByRole('img', { name: 'photo.jpg' })).toBeTruthy();
    expect(request).toHaveBeenCalledWith('/photos/photo.jpg', 'preview');
    await user.click(viewer.getByRole('button', { name: 'Show in Finder' }));
    expect(reveal).toHaveBeenCalledExactlyOnceWith('/photos/photo.jpg');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'photo.jpg' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(thumbnail));
    expect(selected).not.toHaveBeenCalled();
    expect(scope.getByRole('checkbox', { name: 'Process photo.jpg' }).getAttribute('aria-checked')).toBe('true');
    if (expanded) expect(screen.getByRole('dialog', { name: 'Full preview' })).toBeTruthy();
  });
}

it.each(['workspace', 'expanded preview'] as const)('thumbnails in the %s load only as rows approach its scroll viewport', async surface => {
  const request = vi.fn<FinderAPI['image']>().mockResolvedValue(image);
  window.finder = { image: request } as unknown as FinderAPI;
  let observed!: IntersectionObserverCallback;
  let options: IntersectionObserverInit | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, settings?: IntersectionObserverInit) { observed = callback; options = settings; }
    observe() {}
    disconnect = disconnect;
  });
  const { container } = render(<I18nContext.Provider value={language}>
    <div className={surface === 'workspace' ? 'workspace-scroll' : 'preview-dialog'}><div className="file-scroll">
      <ImageThumbnail file="/photos/photo.jpg" open={() => {}} />
    </div></div>
  </I18nContext.Provider>);
  expect(options?.root).toBe(container.querySelector(surface === 'workspace' ? '.workspace-scroll' : '.file-scroll'));
  expect(request).not.toHaveBeenCalled();
  act(() => observed([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(request).not.toHaveBeenCalled();
  act(() => observed([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith('/photos/photo.jpg', 'thumbnail'));
  expect(disconnect).toHaveBeenCalled();
});

it('unavailable images keep a file icon and offer a Finder action in the large viewer', async () => {
  const request = vi.fn<FinderAPI['image']>().mockRejectedValue(new Error('Unsupported image')), reveal = vi.fn();
  window.finder = { image: request } as unknown as FinderAPI;
  const user = userEvent.setup();
  render(<I18nContext.Provider value={language}><FileResults plan={plan} selected={new Set()} setSelected={() => {}} reveal={reveal} copyPath={() => {}} /></I18nContext.Provider>);
  const thumbnail = screen.getByRole('button', { name: 'Preview image: photo.jpg' });
  await waitFor(() => expect(thumbnail.querySelector('[data-slot="skeleton"]')).toBeNull());
  expect(thumbnail.querySelector('img')).toBeNull();
  fireEvent.contextMenu(thumbnail, { clientX: 100, clientY: 100 });
  await screen.findByRole('menu');
  expect(screen.queryByRole('dialog', { name: 'photo.jpg' })).toBeNull();
  await user.keyboard('{Escape}');
  await user.click(thumbnail);
  const viewer = within(await screen.findByRole('dialog', { name: 'photo.jpg' }));
  expect(await viewer.findByText('This image could not be previewed')).toBeTruthy();
  await user.click(viewer.getByRole('button', { name: 'Show in Finder' }));
  expect(reveal).toHaveBeenCalledExactlyOnceWith('/photos/photo.jpg');
});
