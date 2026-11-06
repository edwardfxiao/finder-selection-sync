import assert from 'node:assert/strict';
import test from 'node:test';
import { compareFolderFiles } from '../src/index.js';

const options = { rootA: '/a', rootB: '/b' };
test('comparison defaults to full filename, ignores subfolders and preserves every duplicate', () => {
  const rows = compareFolderFiles(['/a/one/A.jpg', '/a/two/A.jpg', '/a/only.txt', '/a/one/A.jpg'], ['/b/A.jpg', '/b/three/A.jpg', '/b/A.png'], options);
  assert.equal(rows.length, 6);
  const shared = rows.filter(row => row.group === 'common');
  assert.equal(shared.length, 4);
  assert.deepEqual(shared[0].matches, ['/b/A.jpg', '/b/three/A.jpg']);
  assert.deepEqual(rows.filter(row => row.group === 'onlyA').map(row => row.file), ['/a/only.txt']);
  assert.deepEqual(rows.filter(row => row.group === 'onlyB').map(row => row.file), ['/b/A.png']);
});
test('relative paths distinguish same names in different subfolders', () => {
  const rows = compareFolderFiles(['/a/one/A.jpg', '/a/two/A.jpg'], ['/b/one/A.jpg'], { ...options, matchBy: 'relative' });
  assert.equal(rows.filter(row => row.group === 'common').length, 2);
  assert.equal(rows.find(row => row.file === '/a/two/A.jpg').group, 'onlyA');
});
test('stem comparison ignores extensions but preserves processing suffixes', () => {
  const rows = compareFolderFiles(['/a/A.NEF', '/a/A-[web].jpg', '/a/README'], ['/b/A.jpg', '/b/README'], { ...options, matchBy: 'stem' });
  assert.equal(rows.filter(row => row.group === 'common').length, 4);
  assert.equal(rows.find(row => row.file === '/a/A-[web].jpg').group, 'onlyA');
});
test('comparison normalizes Unicode and respects case sensitivity', () => {
  const files = [['/a/Café.JPG'], ['/b/Cafe\u0301.JPG']];
  assert.equal(compareFolderFiles(...files, options).every(row => row.group === 'common'), true);
  assert.equal(compareFolderFiles(['/a/A.JPG'], ['/b/a.jpg'], options).filter(row => row.group === 'common').length, 0);
  assert.equal(compareFolderFiles(['/a/A.JPG'], ['/b/a.jpg'], { ...options, ignoreCase: true }).every(row => row.group === 'common'), true);
});
test('an empty comparison side still returns the other side as unique', () => {
  assert.deepEqual(compareFolderFiles([], [], options), []);
  assert.equal(compareFolderFiles([], ['/b/A.jpg'], options)[0].group, 'onlyB');
  assert.equal(compareFolderFiles(['/a/A.jpg'], [], options)[0].group, 'onlyA');
});
test('comparison rejects invalid matching options and out-of-root files', () => {
  for (const patch of [{ matchBy: 'content' }, { ignoreCase: 'yes' }, { rootA: 'relative' }]) {
    assert.throws(() => compareFolderFiles([], [], { ...options, ...patch }));
  }
  for (const file of ['/outside/A.jpg', '/a/../outside/A.jpg', '/a', '/a/A\0.jpg']) {
    assert.throws(() => compareFolderFiles([file], [], options));
  }
});
