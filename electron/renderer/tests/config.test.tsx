import { afterEach, expect, it } from 'vitest';
import { defaults, preferences } from '@/lib/config';

afterEach(() => localStorage.clear());

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
