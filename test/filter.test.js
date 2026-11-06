import assert from 'node:assert/strict';
import test from 'node:test';
import { filterFiles, validateFileFilters } from '../src/filter.js';

const entry = (name, size = 10, modifiedMs = 1000) => ({ file: `/fixtures/${name}`, size, modifiedMs });
const names = rows => rows.map(row => row.file.split('/').at(-1));

test('file filters: blank criteria match all; literal names preserve spaces and normalize Unicode', async () => {
  const files = [entry('IMG_001.JPG'), entry('img_002-final.png'), entry('IMG_003 draft.JPG'), entry('Cafe\u0301.*.txt'), entry('README')];
  assert.deepEqual(await filterFiles(files), files);
  assert.deepEqual(await filterFiles(files, { invert: true }), []);
  assert.deepEqual(names(await filterFiles(files, { nameContains: 'img_', nameExcludes: ' draft' })), ['IMG_001.JPG', 'img_002-final.png']);
  assert.deepEqual(names(await filterFiles(files, { nameContains: 'img_', ignoreCase: false })), ['img_002-final.png']);
  assert.deepEqual(names(await filterFiles(files, { nameContains: 'Café.*' })), ['Cafe\u0301.*.txt']);
  assert.deepEqual(await filterFiles(files, { nameContains: 'IMG_001 ' }), []);
});

test('file filters: AND combines names, regex, extensions, sizes and modification bounds', async () => {
  const files = [entry('IMG_001.JPG', 1024, 1000), entry('IMG_002.png', 2048, 1999), entry('IMG_003.JPG', 2049, 1500),
    entry('IMG_004.JPG', 1024, 2000), entry('other_001.jpg', 1024, 1000), entry('IMG_005.xmp', 1024, 1000), entry('README')];
  const filters = { nameContains: 'img_', nameRegex: '^IMG_\\d+\\.(jpg|png)$', includeExt: ['.JPG', 'png', '.xmp'], excludeExt: ['XMP'],
    sizeMin: 1024, sizeMax: 2048, modifiedFrom: 1000, modifiedBefore: 2000 };
  assert.deepEqual(names(await filterFiles(files, filters)), ['IMG_001.JPG', 'IMG_002.png']);
  assert.deepEqual(names(await filterFiles(files, { ...filters, ignoreCase: false })), []);
  assert.deepEqual(names(await filterFiles(files, { includeExt: ['jpg'], excludeExt: ['.JPG'] })), []);
  assert.deepEqual(names(await filterFiles(files, { nameRegex: '^README$' })), ['README']);
  const matched = await filterFiles(files, filters), inverted = await filterFiles(files, { ...filters, invert: true });
  assert.equal(matched.length + inverted.length, files.length);
  assert.equal(inverted.some(file => matched.includes(file)), false);
});

test('file filters: inverse results partition 600 files across combined predicates and batch boundaries', async () => {
  const files = Array.from({ length: 600 }, (_, i) => entry(`${i % 2 ? 'photo' : 'export'}_${i}.${i % 3 ? 'JPG' : 'png'}`, i, i * 100));
  for (const min of [0, 123, 400]) {
    const options = { nameContains: 'photo', includeExt: ['jpg'], sizeMin: min, modifiedBefore: 45000, nameRegex: '_[0-9]+\\.' };
    const expected = files.filter((file, i) => i % 2 && i % 3 && i >= min && i < 450);
    assert.deepEqual(await filterFiles(files, options), expected);
    assert.deepEqual(await filterFiles(files, { ...options, invert: true }), files.filter(file => !expected.includes(file)));
  }
});

test('file filters: invalid or expensive regex fails without hanging; cancellation interrupts batches', async () => {
  assert.throws(() => validateFileFilters({ nameRegex: '[' }), { code: 'FILTER_REGEX' });
  await assert.rejects(filterFiles([entry(`${'a'.repeat(100)}!`)], { nameRegex: '^(a+)+$' }), { code: 'FILTER_REGEX_TIMEOUT' });
  let checks = 0;
  await assert.rejects(filterFiles(Array.from({ length: 600 }, (_, i) => entry(`${i}.txt`)), {}, { shouldCancel: () => ++checks > 1 }), { code: 'FILTER_CANCELLED' });
  assert.equal(checks, 2);
  assert.deepEqual(names(await filterFiles([entry('after.txt')], { nameRegex: '\\.txt$' })), ['after.txt']);
});

test('file filters: malformed ranges and flags fail closed', () => {
  for (const input of [{ sizeMin: -1 }, { sizeMin: NaN }, { sizeMax: Infinity }, { sizeMin: 20, sizeMax: 10 }, { sizeMin: '20' }]) {
    assert.throws(() => validateFileFilters(input), { code: 'FILTER_SIZE' });
  }
  assert.throws(() => validateFileFilters({ modifiedFrom: 100, modifiedBefore: 100 }), { code: 'FILTER_DATE' });
  assert.throws(() => validateFileFilters({ includeExt: ['../jpg'] }), { code: 'FILTER_EXTENSIONS' });
  assert.throws(() => validateFileFilters({ ignoreCase: 'false' }), { code: 'FILTER_OPTION' });
  assert.throws(() => validateFileFilters({ invert: 1 }), { code: 'FILTER_OPTION' });
  assert.throws(() => validateFileFilters({ nameContains: '\0' }), { code: 'FILTER_TEXT' });
  assert.throws(() => validateFileFilters({ nameRegex: 'a'.repeat(1025) }), { code: 'FILTER_TEXT' });
});
