import { afterEach, expect, it } from 'vitest';
import { defaults, preferences } from '@/lib/config';

afterEach(() => localStorage.clear());

it('restores the fourth workflow and adds its defaults to older saved workspaces', () => {
  localStorage.setItem('finder-workbench', JSON.stringify({ mode: 'list', config: { list: { targets: ['/photos'] } } }));
  expect(preferences().config.filter).toMatchObject({ mode: 'filter', targets: [], nameRegex: '', ignoreCase: true, invertFilter: false });
  const config = defaults();
  config.filter = { ...config.filter, nameRegex: '^IMG_', invertFilter: true, modifiedFrom: '2026-01-01', targets: ['/photos'] };
  localStorage.setItem('finder-workbench', JSON.stringify({ mode: 'filter', config }));
  expect(preferences()).toEqual({ mode: 'filter', config });
});

it('restores comparison and migrates list tagging back to independent cleanup and selection actions', () => {
  expect(preferences().config.compare).toMatchObject({ mode: 'compare', matchBy: 'name', compareSelection: 'common', scope: 'both' });
  const config = defaults();
  config.compare = { ...config.compare, base: '/a', targets: ['/b'], compareSelection: 'onlyA', colors: [] };
  config.list.listAction = 'tags';
  localStorage.setItem('finder-workbench', JSON.stringify({ mode: 'compare', config }));
  expect(preferences()).toEqual({ mode: 'compare', config: { ...config, list: { ...config.list, listAction: 'trash' } } });
});

it('migrates a saved single color without resetting other workflow preferences', () => {
  localStorage.setItem('finder-workbench', JSON.stringify({ mode: 'tags', config: {
    tags: { tagAction: 'color', color: 'purple', base: '/reference', targets: ['/target'], select: 'unmatched' },
  } }));
  expect(preferences()).toMatchObject({ mode: 'tags', config: {
    tags: { tagAction: 'color', colors: ['purple'], base: '/reference', targets: ['/target'], select: 'unmatched' },
  } });
  expect(preferences().config.tags).not.toHaveProperty('color');
});

it('restores multiple tags and preserves an explicitly empty selection instead of the legacy color', () => {
  const config = defaults();
  config.tags.colors = ['red', 'blue'];
  localStorage.setItem('finder-workbench', JSON.stringify({ mode: 'tags', config }));
  expect(preferences().config.tags.colors).toEqual(['red', 'blue']);
  localStorage.setItem('finder-workbench', JSON.stringify({ config: { tags: { colors: [], color: 'red' } } }));
  expect(preferences().config.tags.colors).toEqual([]);
});

it('discards invalid saved colors and duplicates without introducing extra selected tags', () => {
  localStorage.setItem('finder-workbench', JSON.stringify({ config: { tags: { colors: ['red', 'invalid', null, 'red', 'blue'] } } }));
  expect(preferences().config.tags.colors).toEqual(['red', 'blue']);
  localStorage.setItem('finder-workbench', JSON.stringify({ config: { tags: { colors: { red: true } } } }));
  expect(preferences().config.tags.colors).toEqual(['green']);
});
