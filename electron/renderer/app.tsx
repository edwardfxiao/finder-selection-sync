import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderSync, Tags as TagsIcon, ListChecks, History, Languages, RefreshCw, FolderOpen, ScanLine, Check, LoaderCircle, ChevronRight, ArrowUpRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { WorkflowConfig, WorkflowHeader } from '@/components/workflow-config';
import { ErrorNotice, FileResults } from '@/components/file-results';
import { PreviewSkeleton } from '@/components/preview-skeleton';
import { Activity } from '@/components/activity';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import { preferences, sizeText } from '@/lib/config';
import { usePreviewFocus } from '@/lib/use-preview-focus';
import { PreviewController } from '../preview-controller.js';
import en from '../locales/en-US.json';
import zh from '../locales/zh-CN.json';
import type { Catalog, Config, Issue, Mode, PathKind, PreviewState, ProgressInfo, Run } from '@/types';

const modeIcons = { orphans: FolderSync, tags: TagsIcon, list: ListChecks };
const initialCatalog: Catalog = { current: navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US', warnings: [], bundles: [
  { code: 'en-US', label: en._meta.label, direction: 'ltr', messages: Object.fromEntries(Object.entries(en).filter((entry): entry is [string,string] => typeof entry[1] === 'string')) },
  { code: 'zh-CN', label: zh._meta.label, direction: 'ltr', messages: Object.fromEntries(Object.entries(zh).filter((entry): entry is [string,string] => typeof entry[1] === 'string')) },
] };
const issue = (error: unknown): Issue => {
  const value = error as Issue;
  return value?.key ? value : { key: 'error.generic', params: { detail: error instanceof Error ? error.message : String(error) } };
};

export default function App() {
  const api = window.finder;
  const [initial] = useState(preferences);
  const [mode, setMode] = useState<Mode | 'history'>(initial.mode);
  const [config, setConfig] = useState(initial.config);
  const configRef = useRef(config), modeRef = useRef(mode);
  const workspaceRevision = useRef(0);
  configRef.current = config; modeRef.current = mode;
  const [catalog, setCatalog] = useState(initialCatalog), [version, setVersion] = useState('');
  const [loaded, setLoaded] = useState(false), [languageBusy, setLanguageBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>({ plan: null, error: null, busy: false, pending: false });
  const [selected, setSelected] = useState(new Set<string>()), [run, setRun] = useState<Run | null>(null), [history, setHistory] = useState<Run[]>([]);
  const [job, setJob] = useState<'execute' | null>(null), [stopping, setStopping] = useState(false);
  const jobRef = useRef(job); jobRef.current = job;
  const [progress, setProgress] = useState<ProgressInfo>({ phase: 'scan', detail: { key: 'progress.folders' }, completed: 0, total: 0 });
  const lastMode = useRef(initial.mode);
  if (mode !== 'history') lastMode.current = mode;
  const [notice, setNotice] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [controller] = useState(() => new PreviewController(api, (patch: Partial<PreviewState>) => {
    setPreviewState(previous => ({ ...previous, ...patch }));
    if ('plan' in patch) setSelected(new Set(patch.plan?.rows.filter(row => row.candidate).map(row => row.id) ?? []));
  }));
  const i18n = useMemo(() => makeTranslator(catalog), [catalog]);
  const { t, text, locale } = i18n;
  const locked = !!job || !loaded || historyBusy;
  const busy = previewState.busy || !!job;
  const plan = previewState.plan;
  const previewLoading = !job && (previewState.pending || previewState.busy);
  const previewFocus = usePreviewFocus(!job && mode !== 'history' && !run, mode);
  const summary = useMemo(() => (plan?.rows ?? []).reduce((value, row) => selected.has(row.id) ? { count: value.count + 1, size: value.size + row.size } : value, { count: 0, size: 0 }), [plan, selected]);

  useEffect(() => {
    let alive = true;
    const unsubscribe = api?.onProgress(value => setProgress(value));
    if (!api) { setPreviewState(previous => ({ ...previous, error: { key: 'error.desktop' } })); return; }
    Promise.all([api.locales(), api.version(), api.history()]).then(([languages, version, records]) => {
      if (!alive) return;
      setCatalog(languages); setVersion(version); setHistory(records); setLoaded(true);
      controller.update(initial.config[initial.mode], 0);
    }).catch(error => setPreviewState(previous => ({ ...previous, error: issue(error) })));
    const appearance = matchMedia('(prefers-color-scheme: dark)');
    const updateAppearance = () => document.documentElement.classList.toggle('dark', appearance.matches);
    updateAppearance(); appearance.addEventListener('change', updateAppearance);
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent); window.addEventListener('drop', prevent);
    return () => { alive = false; unsubscribe?.(); controller.dispose(); appearance.removeEventListener('change', updateAppearance); window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [api, controller, initial]);
  useEffect(() => {
    const bundle = catalog.bundles.find(bundle => bundle.code === catalog.current);
    document.documentElement.lang = catalog.current;
    document.documentElement.dir = bundle?.direction ?? 'ltr';
  }, [catalog]);
  useEffect(() => {
    try { localStorage.setItem('finder-workbench', JSON.stringify({ mode: lastMode.current, config })); } catch { /* Optional preferences. */ }
  }, [mode, config]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === 'Enter' && !jobRef.current && modeRef.current !== 'history') {
        event.preventDefault(); controller.update(configRef.current[modeRef.current], 0); setRun(null);
      }
      if (event.key === 'Escape' && (controller.active || jobRef.current)) {
        setStopping(true); if (jobRef.current) api.cancel().catch(() => {}); else controller.stop();
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [api, controller]);

  function notify(value: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setNotice(value); toastTimer.current = setTimeout(() => setNotice(null), 4000);
  }
  function report(error: unknown) { setPreviewState(previous => ({ ...previous, error: issue(error) })); }
  function update(patch: Partial<Config>, delay = 0) {
    const currentMode = modeRef.current;
    if (jobRef.current || !loaded || currentMode === 'history') return;
    const next = { ...configRef.current, [currentMode]: { ...configRef.current[currentMode], ...patch } };
    configRef.current = next; setConfig(next); setRun(null); setStopping(false);
    controller.update(next[currentMode], delay);
  }
  function switchMode(nextMode: Mode) {
    if (locked) return;
    workspaceRevision.current++;
    setMode(nextMode); modeRef.current = nextMode; setRun(null); setStopping(false);
    controller.update(configRef.current[nextMode], 0);
  }
  function refresh() {
    if (locked || mode === 'history') return;
    setRun(null); setStopping(false); controller.update(configRef.current[mode], 0);
  }
  function resetSelection() {
    if (jobRef.current || !loaded || modeRef.current === 'history') return;
    workspaceRevision.current++;
    update({ base: '', targets: [], list: '', listText: '' });
    previewFocus.restore();
  }
  async function paths(value: string[], kind: PathKind) {
    if (!value.length || modeRef.current === 'history') return;
    const c = configRef.current[modeRef.current];
    update(kind === 'targets' ? { targets: [...new Set([...c.targets, ...value])] }
      : kind === 'list' ? { list: value[0], listSource: 'file' } : { base: value[0] });
  }
  async function choose(kind: PathKind, replace?: string) {
    const currentMode = modeRef.current;
    const revision = workspaceRevision.current;
    if (locked || currentMode === 'history') return;
    try {
      const chosen = replace === undefined ? await api.choose(kind) : await api.choose(kind, replace);
      if (!chosen.length || workspaceRevision.current !== revision) return;
      if (kind === 'targets' && replace !== undefined) {
        const targets = configRef.current[currentMode].targets;
        const index = targets.indexOf(replace);
        if (index < 0 || chosen[0] === replace) return;
        if (targets.includes(chosen[0])) throw { key: 'error.duplicateTarget' };
        update({ targets: targets.map((file, i) => i === index ? chosen[0] : file) });
      } else await paths(chosen, kind);
    } catch (error) { if (workspaceRevision.current === revision) report(error); }
  }
  async function dropped(files: File[], kind: PathKind) {
    if (locked || modeRef.current === 'history') return;
    const revision = workspaceRevision.current;
    try {
      const chosen = await api.dropped(files, kind);
      if (workspaceRevision.current === revision) await paths(chosen, kind);
    } catch (error) { if (workspaceRevision.current === revision) report(error); }
  }
  async function execute() {
    if (!plan || !selected.size || busy || previewState.pending || plan.conflicts.length) return;
    setJob('execute'); setStopping(false);
    setProgress({ phase: 'confirm', detail: { key: 'progress.confirm' }, completed: 0, total: 0 });
    try {
      const response = await api.execute(plan.id, [...selected]);
      if (!('declined' in response)) { controller.forget(); setRun(response); setHistory(await api.history()); }
    } catch (error) { controller.forget(); report(error); }
    finally { setJob(null); }
  }
  async function changeLanguage(code: string) {
    setLanguageBusy(true);
    try { setCatalog(await api.setLocale(code)); } catch (error) { report(error); }
    finally { setLanguageBusy(false); }
  }
  async function reloadLanguages() {
    try { const languages = await api.reloadLocales(); setCatalog(languages); const nextT = makeTranslator(languages).t; notify(nextT(languages.warnings.length ? 'language.invalid' : 'language.reloaded', { count: languages.warnings.length })); }
    catch (error) { report(error); }
  }
  async function exportRun(value: Run) { try { if (await api.exportResult(value.id)) notify(t('action.exported')); } catch (error) { notify(text(issue(error))); } }
  async function reveal(file: string, kind?: PathKind) { try { await api.reveal(file, kind); } catch (error) { notify(text(issue(error))); } }
  async function copyPath(file: string) { try { await api.copyPath(file); notify(t('action.pathCopied')); } catch (error) { notify(text(issue(error))); } }
  async function showHistory() {
    if (locked || previewState.busy) return;
    workspaceRevision.current++;
    controller.update(null); setRun(null); setMode('history'); modeRef.current = 'history';
    setHistoryBusy(true);
    try { setHistory(await api.history()); } catch (error) { report(error); }
    finally { setHistoryBusy(false); }
  }
  async function clearHistory() {
    if (locked || !history.length) return;
    setHistoryBusy(true);
    try {
      setHistory(await api.clearHistory()); setRun(null);
      setPreviewState(previous => ({ ...previous, error: null }));
      notify(t('history.cleared'));
    } catch (error) { report(error); }
    finally { setHistoryBusy(false); }
  }
  function stop() { setStopping(true); if (job) api.cancel().catch(report); else controller.stop(); }

  const c = mode !== 'history' ? config[mode] : null;
  return <I18nContext.Provider value={i18n}>
    <header className="titlebar">
      <div className="titlebar-sidebar"><span className="app-name">Finder Sync</span></div>
      <div className="titlebar-main">
        <div className="workspace-label"><span>{t('nav.workflows')}</span><ChevronRight size={12} /><strong>{t(mode === 'history' ? 'nav.history' : `task.${mode}`)}</strong></div>
        <div className="titlebar-actions">
          <DropdownMenu><DropdownMenuTrigger asChild><Button className="language-button" variant="ghost" size="sm" disabled={locked || languageBusy} aria-label={t('language.title')}><Languages size={15} /><span>{catalog.bundles.find(b => b.code === locale)?.label ?? locale}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>{t('language.title')}</DropdownMenuLabel>{catalog.bundles.map(bundle => <DropdownMenuItem key={bundle.code} onSelect={() => changeLanguage(bundle.code)}>{bundle.code === locale ? <Check size={14} /> : <span className="size-3.5" />}{bundle.label}</DropdownMenuItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => api.openLocaleFolder().catch(report)}><FolderOpen />{t('language.open')}</DropdownMenuItem><DropdownMenuItem onSelect={reloadLanguages}><RefreshCw />{t('language.reload')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>
      </div>
    </header>
    <div className="app-shell"><aside className="sidebar"><div className="nav-caption">{t('nav.workflows')}</div><nav aria-label={t('nav.workflows')}>{(Object.keys(modeIcons) as Mode[]).map(key => { const Icon = modeIcons[key]; return <Button key={key} variant="ghost" className={`nav-button ${mode === key ? 'active' : ''}`} disabled={locked} aria-current={mode === key ? 'page' : undefined} onClick={() => switchMode(key)}><Icon strokeWidth={1.65} /><span>{t(`task.${key}`)}</span></Button>; })}</nav><div className="nav-divider" /><Button variant="ghost" className={`nav-button ${mode === 'history' ? 'active' : ''}`} disabled={locked || previewState.busy} onClick={showHistory}><History strokeWidth={1.65} /><span>{t('nav.history')}</span>{history.length > 0 && <span className="nav-count">{history.length}</span>}</Button><div className="sidebar-bottom"><div className="sidebar-version"><span className="connection-dot" />{t('nav.version', { version })}</div></div></aside>
      <main className="workspace" aria-label={t('app.title')}>
        {mode === 'history' ? run ? <Activity key={run.id} run={run} exportRun={() => exportRun(run)} back={() => setRun(null)} /> : <><header className="heading"><div><h1>{t('history.title')}</h1><p>{t('history.description')}</p></div><Button variant="outline" size="sm" disabled={locked || !history.length} aria-busy={historyBusy} title={t('history.clearHint')} onClick={clearHistory}><Trash2 />{t('history.clearAll')}</Button></header><ErrorNotice error={previewState.error} />{history.length ? <div className="history-list">{history.map(item => <button key={item.id} className="history-item" onClick={() => setRun(item)}><div><strong>{t(`task.${item.mode}`)}</strong><small>{new Date(item.startedAt).toLocaleString(locale)} · {t('history.count', { count: item.records.length })}</small></div><span className={`status ${item.error ? 'failed' : item.cancelled ? 'pending' : 'completed'}`}>{t('history.summary', { count: item.completed })}</span></button>)}</div> : <div className="empty"><History /><strong>{t('history.empty')}</strong><p>{t('history.emptyHint')}</p></div>}</>
          : run ? <Activity key={run.id} run={run} exportRun={() => exportRun(run)} refresh={refresh} /> : <>
            <WorkflowHeader ref={previewFocus.toggleRef} config={c!} collapsed={previewFocus.focused} disabled={locked} controls={previewFocus.settingsId} toggle={() => previewFocus.focused ? previewFocus.restore() : previewFocus.minimize()} reset={resetSelection} />
            <div className="workspace-settings" id={previewFocus.settingsId} ref={previewFocus.settingsRef} data-collapsed={previewFocus.focused} inert={previewFocus.focused} aria-hidden={previewFocus.focused || undefined}><div className="workspace-settings-content">
            <p className="workflow-description">{t(`task.${mode}.description`)}</p>
            <WorkflowConfig key={mode} config={c!} disabled={locked} update={update} choose={choose} dropped={dropped} refresh={refresh} reveal={reveal} />
            </div></div>
            <div className={`output ${previewFocus.focused ? 'preview-at-top' : ''}`} ref={previewFocus.previewRef}><ErrorNotice error={previewState.error} />
              {job ? <div className="progress-panel" role="status"><LoaderCircle className="animate-spin text-muted-foreground" size={24} /><strong>{t('preview.working')}</strong><Progress value={progress.total ? (progress.completed / progress.total) * 100 : undefined} className={`h-1 w-80 max-w-full ${progress.total ? '' : 'indeterminate'}`} /><p>{text(progress.detail)}</p><small>{progress.total ? `${progress.completed} / ${progress.total}` : t('preview.large')}</small><Button variant="outline" size="sm" disabled={stopping} onClick={stop}>{t(stopping ? 'action.stopping' : 'action.stop')}</Button></div>
                : previewLoading ? <PreviewSkeleton mode={mode} stopping={stopping} stop={stop} /> : plan ? <FileResults key={plan.id} plan={plan} selected={selected} setSelected={setSelected} reveal={reveal} copyPath={copyPath} />
                  : <div className="empty"><span className="empty-icon"><ScanLine strokeWidth={1.4} /></span><strong>{t(previewState.pending ? 'preview.pending' : 'preview.emptyTitle')}</strong><p>{t('preview.emptyHint')}</p></div>}
              <footer className="footer"><div className="footer-summary" role="status">{t(plan ? mode === 'tags' ? 'preview.tagsSummary' : 'preview.trashSummary' : previewState.pending ? 'preview.pending' : 'preview.ready', { count: summary.count })}<small>{t(plan ? mode === 'tags' ? 'preview.tagsHint' : 'preview.size' : 'preview.auto', { size: sizeText(summary.size) })}</small></div><Button className="execute-button" disabled={!plan || !summary.count || busy || previewState.pending || !!plan.conflicts.length} onClick={execute}>{t(mode === 'tags' ? 'action.executeTags' : 'action.executeTrash', { count: summary.count })}<ArrowUpRight size={16} /></Button></footer>
            </div></>}
      </main>
    </div>{notice && <div className="toast" role="status">{notice}</div>}
  </I18nContext.Provider>;
}
