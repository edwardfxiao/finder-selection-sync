export function canPreview(config) {
  if (!config) return false;
  if (config.mode !== 'list' && config.mode !== 'filter' && !config.base) return false;
  if (!(config.mode === 'orphans' && config.mixed) && !config.targets?.length) return false;
  if (config.mode === 'orphans' && !config.referenceExt?.trim()) return false;
  if (config.mode === 'tags' && config.tagAction === 'color' && Array.isArray(config.colors) && !config.colors.length) return false;
  return config.mode !== 'list' || (config.listSource === 'text' ? Boolean(config.listText?.trim()) : Boolean(config.list));
}

function configKey(config) {
  // Object insertion order must not turn the same settings into a new scan.
  return JSON.stringify(config, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

// One native request at a time. Navigation restores one cached preview per
// workflow; changing settings or refreshing replaces that workflow's preview.
export class PreviewController {
  constructor(api, notify, {
    // Calling browser timers as controller methods otherwise changes their receiver.
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = id => globalThis.clearTimeout(id),
  } = {}) {
    Object.assign(this, { api, notify, setTimer, clearTimer });
    this.version = 0;
    this.timer = null;
    this.active = false;
    this.queued = null;
    this.disposed = false;
    this.config = null;
    this.cache = new Map();
    this.resetting = null;
  }
  emit(patch) { if (!this.disposed) this.notify(patch); }
  clearQueue() {
    this.version++;
    this.clearTimer(this.timer);
    this.timer = null;
    this.queued = null;
  }
  discardNative(all = false, mode) {
    let operation;
    try {
      operation = all && this.api?.discardAll ? this.api.discardAll()
        : mode ? this.api?.discard?.(mode) : this.api?.discard?.();
    }
    catch { /* A disconnected renderer cannot leave usable cached results. */ }
    const pending = Promise.resolve(operation).catch(() => {});
    if (!all && !mode) return;
    // Clearing a plan can remove a temporary list file. Wait for that cleanup
    // before a new scan, including consecutive resets while cleanup is pending.
    const resetting = this.resetting ? Promise.allSettled([this.resetting, pending]) : pending;
    this.resetting = resetting;
    resetting.then(() => {
      if (this.resetting !== resetting) return;
      this.resetting = null;
      if (this.queued && this.timer === null) this.run();
    });
  }
  cachePlan(config, plan) {
    if (!plan?.id) return;
    this.cache.delete(config.mode);
    this.cache.set(config.mode, { key: configKey(config), plan });
    while (this.cache.size > 5) this.cache.delete(this.cache.keys().next().value);
  }
  remember(plan) {
    if (this.disposed || !this.config || !plan) return;
    const cached = this.cache.get(this.config.mode);
    if (cached?.key !== configKey(this.config) || cached.plan.id !== plan.id) return;
    // Scoped tag reads may refresh display metadata without changing the plan.
    this.cachePlan(this.config, plan);
  }
  update(config, delay = 0) {
    if (this.disposed) return;
    this.clearQueue();
    this.config = config ? structuredClone(config) : null;
    if (this.config) this.cache.delete(this.config.mode);
    this.queued = canPreview(this.config) ? { kind: 'scan' } : null;
    this.emit({ plan: null, error: null, pending: !!this.queued, busy: this.active, restoring: false });
    this.discardNative(false, this.config?.mode);
    if (this.queued) this.timer = this.setTimer(() => { this.timer = null; this.run(); }, delay);
  }
  navigate(config) {
    if (this.disposed) return;
    this.clearQueue();
    this.config = config ? structuredClone(config) : null;
    const cached = this.config && this.cache.get(this.config.mode);
    const reusable = canPreview(this.config) && cached?.key === configKey(this.config) && typeof this.api?.activate === 'function';
    if (cached && !reusable) this.cache.delete(this.config.mode);
    this.queued = reusable ? { kind: 'activate', cached } : canPreview(this.config) ? { kind: 'scan' } : null;
    // Keep the preview visible while the main process restores its authority.
    // Actions stay disabled through `restoring` until activation succeeds.
    this.emit({ plan: reusable ? cached.plan : null, error: null, pending: !!this.queued && !reusable, busy: !reusable && this.active, restoring: reusable });
    this.discardNative();
    if (this.queued) this.timer = this.setTimer(() => { this.timer = null; this.run(); }, 0);
  }
  async run() {
    if (this.disposed || !this.queued || !canPreview(this.config) || this.active || this.resetting) return;
    const version = this.version;
    const config = structuredClone(this.config);
    const request = this.queued;
    this.active = true;
    this.queued = null;
    try {
      if (request.kind === 'activate') {
        let restored;
        try { restored = await this.api.activate(request.cached.plan.id); }
        catch { /* An expired or unavailable native cache requires a fresh scan. */ }
        if (version !== this.version || this.disposed) return;
        if (restored?.id === request.cached.plan.id) {
          // Native activation does not reread files. Retain metadata refreshed by
          // remember(), which may be newer than the native public-plan rows.
          const cached = this.cache.get(config.mode);
          const plan = cached?.plan.id === restored.id ? cached.plan : request.cached.plan;
          this.cachePlan(config, plan);
          this.emit({ plan, error: null, pending: false, busy: false, restoring: false });
          return;
        }
        this.cache.delete(config.mode);
      }
      this.emit({ plan: null, busy: true, pending: true, error: null, restoring: false });
      const plan = await this.api.preview(config);
      if (version === this.version && !this.disposed) {
        this.cachePlan(config, plan);
        this.emit({ plan, error: null, pending: false, busy: false, restoring: false });
      }
    } catch (error) {
      if (version === this.version) this.emit({ plan: null, error, pending: false, restoring: false });
    } finally {
      this.active = false;
      this.emit({ busy: false });
      if (this.queued && this.timer === null) this.run();
    }
  }
  stop() {
    if (this.disposed) return;
    this.clearQueue();
    if (this.config) this.cache.delete(this.config.mode);
    this.api?.cancel?.().catch(() => {});
    this.emit({ plan: null, pending: false, restoring: false, error: { key: 'preview.stopped', params: {} } });
  }
  forget() {
    if (this.disposed) return;
    this.clearQueue();
    if (this.config) this.cache.delete(this.config.mode);
    this.emit({ plan: null, error: null, pending: false, restoring: false });
  }
  suspend() {
    if (this.disposed) return;
    this.clearQueue();
    this.config = null;
    this.discardNative();
    this.emit({ plan: null, error: null, pending: false, busy: false, restoring: false });
  }
  invalidateAll() {
    if (this.disposed) return;
    this.clearQueue();
    this.cache.clear();
    this.discardNative(true);
    this.emit({ plan: null, error: null, pending: false, busy: false, restoring: false });
  }
  dispose() {
    if (this.disposed) return;
    this.invalidateAll();
    this.disposed = true;
  }
}
