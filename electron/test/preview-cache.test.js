import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewController } from '../preview-controller.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const filter = { mode: 'filter', targets: ['/photos'], recursive: true, includeExt: 'jpg' };
const list = { mode: 'list', targets: ['/exports'], listSource: 'text', listText: 'A.JPG' };
const tags = { mode: 'tags', base: '/originals', targets: ['/exports'], tagAction: 'sync' };

function plan(config, id) {
  return { id, mode: config.mode, rows: [{ id: 'row-0', file: `${config.targets[0]}/A.JPG`, currentTags: [] }] };
}

function harness() {
  const scans = [], activations = [], updates = [], timers = new Map(), clears = [], discards = [];
  let nextTimer = 0, active = 0, peakActive = 0;
  let state = { plan: null, pending: false, busy: false, restoring: false, error: null };
  const request = (requests, value) => {
    const pending = deferred();
    active++;
    peakActive = Math.max(peakActive, active);
    requests.push({ value, ...pending });
    return pending.promise.then(result => { active--; return result; }, error => { active--; throw error; });
  };
  const api = {
    preview: config => request(scans, config),
    activate: id => request(activations, id),
    discard: async (...args) => { discards.push(args); },
    cancel: async () => {},
    discardAll: async () => { clears.push(true); },
  };
  const controller = new PreviewController(api, patch => {
    updates.push(patch);
    state = { ...state, ...patch };
  }, {
    setTimer: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimer: id => timers.delete(id),
  });
  const flush = async () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    await tick();
  };
  const scan = async (config, id) => {
    controller.update(config);
    await flush();
    const result = plan(config, id);
    scans.at(-1).resolve(result);
    await tick();
    return result;
  };
  return { api, controller, scans, activations, updates, timers, clears, discards, flush, scan,
    get state() { return state; }, get peakActive() { return peakActive; } };
}

test('preview cache: all five workflows survive navigation and Activity without rescanning', async () => {
  const h = harness();
  const configs = [filter, list, tags,
    { mode: 'compare', base: '/left', targets: ['/right'] },
    { mode: 'orphans', base: '/originals', targets: ['/exports'], referenceExt: 'NEF' }];
  const plans = [];
  for (const [index, config] of configs.entries()) plans.push(await h.scan(config, `plan-${index}`));
  for (const [index, config] of configs.entries()) {
    h.controller.suspend();
    h.controller.navigate(config);
    assert.strictEqual(h.state.plan, plans[index], 'cached rows are visible before native activation');
    assert.equal(h.state.restoring, true);
    assert.equal(h.state.busy, false);
    assert.equal(h.state.pending, false);
    await h.flush();
    assert.equal(h.activations.at(-1).value, plans[index].id);
    h.activations.at(-1).resolve(plans[index]);
    await tick();
    assert.strictEqual(h.state.plan, plans[index]);
    assert.equal(h.state.restoring, false);
  }
  assert.equal(h.scans.length, 5);
  assert.equal(h.peakActive, 1);
});

test('preview cache: equivalent settings reuse a plan regardless of property insertion order', async () => {
  const h = harness(), original = await h.scan(filter, 'filter');
  h.controller.navigate({ includeExt: 'jpg', recursive: true, targets: ['/photos'], mode: 'filter' });
  await h.flush();
  h.activations[0].resolve(original);
  await tick();
  assert.equal(h.scans.length, 1);
  assert.strictEqual(h.state.plan, original);
  h.controller.navigate({ ...filter, targets: ['/other'] });
  await h.flush();
  assert.equal(h.activations.length, 1);
  assert.equal(h.scans.length, 2);
  assert.equal(h.state.plan, null);
  h.scans[1].resolve(plan({ ...filter, targets: ['/other'] }, 'other'));
  await tick();
});

test('preview cache: setting changes release only their native workflow while navigation keeps it', async () => {
  const h = harness(), original = await h.scan(list, 'list');
  assert.deepEqual(h.discards.at(-1), ['list']);
  h.controller.suspend();
  assert.deepEqual(h.discards.at(-1), []);
  h.controller.navigate(list);
  assert.deepEqual(h.discards.at(-1), []);
  await h.flush();
  h.activations[0].resolve(original);
  await tick();
  h.controller.update({ ...list, listText: '' });
  assert.deepEqual(h.discards.at(-1), ['list'], 'clearing required input still releases its temporary list');
  await h.flush();
  assert.equal(h.scans.length, 1);
});

test('preview cache: Refresh waits for the previous workflow temporary file to be released', async () => {
  const h = harness(), cleanup = deferred();
  await h.scan(list, 'old-list');
  h.api.discard = mode => {
    assert.equal(mode, 'list');
    return cleanup.promise;
  };
  h.controller.update(list);
  await h.flush();
  assert.equal(h.scans.length, 1);
  cleanup.resolve();
  await tick();
  assert.equal(h.scans.length, 2);
  h.scans[1].resolve(plan(list, 'fresh-list'));
  await tick();
  assert.equal(h.state.plan.id, 'fresh-list');
});

test('preview cache: Refresh or a setting edit invalidates only its own workflow', async () => {
  const h = harness(), other = await h.scan(list, 'list');
  await h.scan(filter, 'old-filter');
  h.controller.update(filter);
  await h.flush();
  assert.equal(h.scans.length, 3, 'refresh always rescans even unchanged settings');
  const refreshed = plan(filter, 'fresh-filter');
  h.scans[2].resolve(refreshed);
  await tick();
  h.controller.update({ ...filter, targets: [] });
  await h.flush();
  assert.equal(h.scans.length, 3, 'missing required folders cannot scan');
  h.controller.navigate(list);
  await h.flush();
  h.activations[0].resolve(other);
  await tick();
  assert.strictEqual(h.state.plan, other, 'editing another workflow retains this preview');
  h.controller.navigate(filter);
  await h.flush();
  assert.equal(h.scans.length, 4, 'undoing settings does not revive a preview invalidated by an edit');
  h.scans[3].resolve(plan(filter, 'new-filter'));
  await tick();
});

test('preview cache: scoped tag metadata is remembered without resetting selection or emitting', async () => {
  const h = harness(), original = await h.scan(list, 'list');
  const updated = { ...original, rows: [{ ...original.rows[0], currentTags: ['Green\n2'] }] };
  const before = h.updates.length;
  h.controller.remember({ ...updated, id: 'obsolete' });
  h.controller.remember(updated);
  assert.equal(h.updates.length, before);
  h.controller.suspend();
  h.controller.navigate(list);
  assert.strictEqual(h.state.plan, updated);
  await h.flush();
  h.activations[0].resolve(original);
  await tick();
  assert.strictEqual(h.state.plan, updated, 'native authorization does not overwrite fresher displayed tags');
});

for (const unavailable of ['missing', 'mismatched', 'rejected']) {
  test(`preview cache: ${unavailable} native plan falls back to a new scan`, async () => {
    const h = harness(), original = await h.scan(filter, 'filter');
    h.controller.navigate(filter);
    assert.strictEqual(h.state.plan, original);
    await h.flush();
    if (unavailable === 'rejected') h.activations[0].reject(new Error('cache unavailable'));
    else h.activations[0].resolve(unavailable === 'missing' ? null : { ...original, id: 'other' });
    await tick();
    assert.equal(h.state.plan, null);
    assert.equal(h.state.restoring, false);
    assert.equal(h.state.pending, true);
    assert.equal(h.state.busy, true);
    assert.equal(h.scans.length, 2);
    const current = plan(filter, 'new-filter');
    h.scans[1].resolve(current);
    await tick();
    assert.strictEqual(h.state.plan, current);
    assert.equal(h.state.pending, false);
    assert.equal(h.state.busy, false);
  });
}

test('preview cache: an obsolete activation cannot replace a newer workflow or start a fallback scan', async () => {
  const h = harness(), first = await h.scan(filter, 'filter'), second = await h.scan(list, 'list');
  h.controller.navigate(filter);
  await h.flush();
  h.controller.navigate(list);
  await h.flush();
  assert.equal(h.activations.length, 1, 'native requests remain serialized');
  assert.strictEqual(h.state.plan, second);
  h.activations[0].resolve(null);
  await tick();
  assert.equal(h.scans.length, 2, 'expired results for a workflow left behind do not rescan it');
  assert.equal(h.activations.length, 2);
  assert.equal(h.activations[1].value, second.id);
  assert.strictEqual(h.state.plan, second);
  assert.equal(h.state.restoring, true);
  h.activations[1].resolve(second);
  await tick();
  assert.strictEqual(h.state.plan, second);
  assert.equal(h.state.restoring, false);
  assert.equal(h.peakActive, 1);
  assert.equal(h.updates.filter(patch => patch.plan === first && !patch.restoring).length, 1);
});

test('preview cache: returning while another scan finishes preserves cached rows and never publishes the obsolete scan', async () => {
  const h = harness(), original = await h.scan(filter, 'filter');
  h.controller.navigate(list);
  await h.flush();
  h.controller.navigate(filter);
  await h.flush();
  assert.equal(h.activations.length, 0);
  assert.strictEqual(h.state.plan, original);
  assert.equal(h.state.pending, false);
  assert.equal(h.state.busy, false);
  const obsolete = plan(list, 'obsolete-list');
  h.scans[1].resolve(obsolete);
  await tick();
  assert.equal(h.activations.length, 1);
  assert.equal(h.updates.some(patch => patch.plan === obsolete), false);
  h.activations[0].resolve(original);
  await tick();
  assert.strictEqual(h.state.plan, original);
  assert.equal(h.peakActive, 1);
  h.controller.navigate(list);
  await h.flush();
  assert.equal(h.scans.length, 3, 'obsolete scans do not populate the renderer cache');
  h.scans[2].resolve(plan(list, 'list'));
  await tick();
});

for (const method of ['stop', 'suspend', 'invalidateAll', 'dispose']) {
  test(`preview cache: ${method} suppresses an in-flight activation result`, async () => {
    const h = harness(), original = await h.scan(filter, 'filter');
    h.controller.navigate(filter);
    await h.flush();
    h.controller[method]();
    const publicationCount = h.updates.filter(patch => patch.plan).length;
    h.activations[0].resolve(original);
    await tick();
    assert.equal(h.state.plan, null);
    assert.equal(h.state.restoring, false);
    assert.equal(h.updates.filter(patch => patch.plan).length, publicationCount);
    assert.equal(h.scans.length, 1);
  });
}

test('preview cache: writes and Reset all invalidate every workflow, including pending scans', async () => {
  const h = harness();
  await h.scan(filter, 'filter');
  h.controller.navigate(list);
  await h.flush();
  h.controller.invalidateAll();
  h.scans[1].resolve(plan(list, 'obsolete-list'));
  await tick();
  assert.equal(h.clears.length, 1);
  for (const [index, config] of [filter, list].entries()) {
    h.controller.navigate(config);
    await h.flush();
    h.scans.at(-1).resolve(plan(config, `refreshed-${index}`));
    await tick();
  }
  assert.equal(h.activations.length, 0);
  assert.equal(h.scans.length, 4);
});

test('preview cache: immediate rescanning waits for all pending native cache cleanup', async () => {
  const h = harness(), first = deferred(), second = deferred();
  let count = 0;
  h.api.discardAll = () => (++count === 1 ? first : second).promise;
  h.controller.invalidateAll();
  h.controller.invalidateAll();
  h.controller.update(list);
  await h.flush();
  assert.equal(h.scans.length, 0);
  second.resolve();
  await tick();
  assert.equal(h.scans.length, 0, 'a later fast reset cannot overtake earlier cleanup');
  first.resolve();
  await tick();
  assert.equal(h.scans.length, 1);
  h.scans[0].resolve(plan(list, 'ready'));
  await tick();
  assert.equal(h.state.plan.id, 'ready');
});
