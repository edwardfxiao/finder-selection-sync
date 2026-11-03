export function canPreview(config) {
  if (!config) return false;
  if (config.mode !== 'list' && !config.base) return false;
  if (!(config.mode === 'orphans' && config.mixed) && !config.targets?.length) return false;
  return config.mode !== 'list' || (config.listSource === 'text' ? Boolean(config.listText?.trim()) : Boolean(config.list));
}

// One scan at a time. A changed configuration invalidates the displayed and native plans
// immediately, and results from older requests are never published.
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
    this.queued = false;
    this.disposed = false;
    this.config = null;
  }
  emit(patch) { if (!this.disposed) this.notify(patch); }
  update(config, delay = 0) {
    this.version++;
    this.clearTimer(this.timer);
    this.timer = null;
    this.config = config ? structuredClone(config) : null;
    this.queued = canPreview(this.config);
    this.emit({ plan: null, error: null, pending: this.queued, busy: this.active });
    this.api.discard().catch(() => {});
    if (this.queued) this.timer = this.setTimer(() => { this.timer = null; this.run(); }, delay);
  }
  async run() {
    if (this.disposed || !this.queued || !canPreview(this.config) || this.active) return;
    const version = this.version;
    this.active = true;
    this.queued = false;
    this.emit({ busy: true, pending: true, error: null });
    try {
      const plan = await this.api.preview(structuredClone(this.config));
      if (version === this.version) this.emit({ plan, error: null, pending: false });
    } catch (error) {
      if (version === this.version) this.emit({ plan: null, error, pending: false });
    } finally {
      this.active = false;
      this.emit({ busy: false });
      if (this.queued && this.timer === null) this.run();
    }
  }
  stop() {
    this.version++;
    this.clearTimer(this.timer);
    this.timer = null;
    this.queued = false;
    this.api.cancel().catch(() => {});
    this.emit({ plan: null, pending: false, error: { key: 'preview.stopped', params: {} } });
  }
  forget() {
    this.version++;
    this.clearTimer(this.timer);
    this.timer = null;
    this.queued = false;
    this.emit({ plan: null, error: null, pending: false });
  }
  dispose() {
    this.stop();
    this.disposed = true;
  }
}
