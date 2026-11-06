import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FolderSync, Tags as TagsIcon, ListChecks, ListFilter, FolderGit2, History, Languages, RefreshCw, FolderOpen, ScanLine, Check, LoaderCircle, ChevronRight, ArrowUpRight, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { WorkflowConfig, WorkflowHeader } from '@/components/workflow-config';
import { ThemeMenu } from '@/components/theme-menu';
import { ErrorNotice, FileResults } from '@/components/file-results';
import type { FileResultsViewState } from '@/components/file-results';
import { PreviewSkeleton } from '@/components/preview-skeleton';
import { SelectedTagsDialog } from '@/components/selected-tags-dialog';
import { ResetAllDialog } from '@/components/reset-all-dialog';
import { Activity } from '@/components/activity';
import { I18nContext, makeTranslator } from '@/lib/i18n';
import { defaults, preferences, sizeText } from '@/lib/config';
import { usePreviewFocus } from '@/lib/use-preview-focus';
import { useTheme } from '@/lib/use-theme';
import { isRowSelectable } from '@/lib/selection';
import { PreviewController } from '../preview-controller.js';
import en from '../locales/en-US.json';
import zh from '../locales/zh-CN.json';
import type { Catalog, Config, Issue, Mode, PathKind, PreviewState, ProgressInfo, Run, Row, SelectionTags } from '@/types';

const modeIcons = { orphans: FolderSync, tags: TagsIcon, list: ListChecks, filter: ListFilter, compare: FolderGit2 };
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
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useState<Mode | 'history'>(initial.mode);
  const [config, setConfig] = useState(initial.config);
  const configRef = useRef(config), modeRef = useRef(mode);
  const workspaceRevision = useRef(0);
  configRef.current = config; modeRef.current = mode;
  const [catalog, setCatalog] = useState(initialCatalog), [version, setVersion] = useState('');
  const [loaded, setLoaded] = useState(false), [languageBusy, setLanguageBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false), [resetVersion, setResetVersion] = useState(0);
  const [previewState, setPreviewState] = useState<PreviewState>({ plan: null, error: null, busy: false, pending: false });
  const [selected, setSelected] = useState(new Set<string>()), [run, setRun] = useState<Run | null>(null), [history, setHistory] = useState<Run[]>([]);
  const [previewViews, setPreviewViews] = useState<Partial<Record<Mode, FileResultsViewState>>>({});
  const [advancedModes, setAdvancedModes] = useState<Partial<Record<Mode, boolean>>>({});
  const retainedScrollTop = useRef<number | null>(null);
  const retainedTagFocus = useRef(false);
  const [job, setJob] = useState<'execute' | 'tags' | null>(null), [stopping, setStopping] = useState(false);
  const [tagSelection, setTagSelection] = useState<{ id: string; mode: Mode; rows: Row[]; loading: boolean; error: Issue | null } | null>(null);
  const [tagReading, setTagReading] = useState(false);
  const tagReadRevision = useRef(0);
  const tagOpener = useRef<HTMLElement | null>(null), cancelledTagFocus = useRef<HTMLElement | null>(null);
  const jobRef = useRef(job); jobRef.current = job;
  const stoppingRef = useRef(stopping); stoppingRef.current = stopping;
  const [progress, setProgress] = useState<ProgressInfo>({ phase: 'scan', detail: { key: 'progress.folders' }, completed: 0, total: 0 });
  const lastMode = useRef(initial.mode);
  if (mode !== 'history') lastMode.current = mode;
  const [notice, setNotice] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retainedSelection = useRef<Set<string> | null>(null);
  const workflowSelections = useRef<Partial<Record<Mode, Set<string>>>>({});
  const workflowScroll = useRef<Partial<Record<Mode, number>>>({});
  const [controller] = useState(() => new PreviewController(api, (patch: Partial<PreviewState>) => {
    setPreviewState(previous => ({ ...previous, ...patch }));
    if ('plan' in patch) {
      const manualSelection = patch.plan?.mode === 'filter' || patch.plan?.mode === 'compare' || patch.plan?.mode === 'list' && patch.plan.action === 'tags';
      const remembered = retainedSelection.current ?? (patch.plan ? workflowSelections.current[patch.plan.mode] : null);
      const rows = patch.plan?.rows.filter(row => remembered
        ? isRowSelectable(patch.plan!, row) && remembered.has(row.file)
        : row.candidate && !manualSelection) ?? [];
      setSelected(new Set(rows.map(row => row.id)));
      if (patch.plan) {
        workflowSelections.current[patch.plan.mode] = new Set(rows.map(row => row.file));
        retainedSelection.current = null;
      }
    }
  }));
  const i18n = useMemo(() => makeTranslator(catalog), [catalog]);
  const { t, text, locale } = i18n;
  const locked = !!job || !!tagSelection || tagReading || !loaded || historyBusy || !!previewState.restoring;
  const busy = previewState.busy || !!job || !!previewState.restoring;
  const plan = previewState.plan;
  const previewLoading = !job && (previewState.pending || previewState.busy);
  // Confirmation keeps the current preview in place. Independent list tagging
  // shows its progress in the dialog and also keeps the underlying workspace.
  const executing = job === 'execute' && (progress.phase === 'verify' || progress.phase === 'execute');
  const confirming = !!job && !executing;
  const previewFocus = usePreviewFocus(!executing && mode !== 'history' && !run, mode);
  const summary = useMemo(() => (plan?.rows ?? []).reduce((value, row) => row.candidate && selected.has(row.id) ? { count: value.count + 1, size: value.size + row.size } : value, { count: 0, size: 0 }), [plan, selected]);

  useEffect(() => {
    let alive = true;
    const unsubscribe = api?.onProgress(value => setProgress(value));
    if (!api) { setPreviewState(previous => ({ ...previous, error: { key: 'error.desktop' } })); return; }
    Promise.all([api.locales(), api.version(), api.history()]).then(([languages, version, records]) => {
      if (!alive) return;
      setCatalog(languages); setVersion(version); setHistory(records); setLoaded(true);
      controller.update(initial.config[initial.mode], 0);
    }).catch(error => setPreviewState(previous => ({ ...previous, error: issue(error) })));
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent); window.addEventListener('drop', prevent);
    return () => { alive = false; unsubscribe?.(); controller.dispose(); window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [api, controller, initial]);
  useEffect(() => {
    let alive = true;
    api?.setTheme(theme).catch(error => { if (alive) report(error); });
    return () => { alive = false; };
  }, [api, theme]);
  useEffect(() => {
    const bundle = catalog.bundles.find(bundle => bundle.code === catalog.current);
    document.documentElement.lang = catalog.current;
    document.documentElement.dir = bundle?.direction ?? 'ltr';
  }, [catalog]);
  useEffect(() => {
    try { localStorage.setItem('finder-workbench', JSON.stringify({ mode: lastMode.current, config })); } catch { /* Optional preferences. */ }
  }, [mode, config]);
  useLayoutEffect(() => {
    if (!plan || retainedScrollTop.current === null) return;
    const workspace = previewFocus.previewRef.current?.parentElement;
    if (workspace) workspace.scrollTop = retainedScrollTop.current;
    retainedScrollTop.current = null;
    if (retainedTagFocus.current) {
      retainedTagFocus.current = false;
      const frame = requestAnimationFrame(() => {
        const button = document.querySelector<HTMLButtonElement>('.preview-dialog [data-selection-tags]')
          ?? previewFocus.previewRef.current?.querySelector<HTMLButtonElement>('[data-selection-tags]');
        button?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [plan, previewFocus.previewRef]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || tagSelection || resetOpen) return;
      if (event.metaKey && event.key === 'Enter' && !locked && modeRef.current !== 'history') {
        retainedSelection.current = null;
        retainedScrollTop.current = null;
        retainedTagFocus.current = false;
        delete workflowSelections.current[modeRef.current];
        event.preventDefault(); setStopping(false); controller.update(configRef.current[modeRef.current], 0); setRun(null);
      }
      if (event.key === 'Escape' && (controller.active || jobRef.current)) {
        setStopping(true); if (jobRef.current) api.cancel().catch(() => {}); else controller.stop();
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [api, controller, tagSelection, resetOpen, locked]);
  useEffect(() => {
    if (locked || !cancelledTagFocus.current) return;
    const opener = cancelledTagFocus.current;
    cancelledTagFocus.current = null;
    // The footer remains disabled until a cancelled native read drains. Restore
    // its focus afterwards, without taking focus from a new user interaction.
    if (opener.isConnected && document.activeElement === document.body) opener.focus({ preventScroll: true });
  }, [locked]);

  function notify(value: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setNotice(value); toastTimer.current = setTimeout(() => setNotice(null), 4000);
  }
  function report(error: unknown) { setPreviewState(previous => ({ ...previous, error: issue(error) })); }
  function update(patch: Partial<Config>, delay = 0, preserveSelection = false) {
    const currentMode = modeRef.current;
    if (jobRef.current || !loaded || currentMode === 'history') return;
    if (!preserveSelection) {
      retainedSelection.current = null;
      retainedScrollTop.current = null;
      retainedTagFocus.current = false;
      delete workflowSelections.current[currentMode];
    }
    else if (plan) {
      retainedSelection.current = new Set(plan.rows.filter(row => selected.has(row.id)).map(row => row.file));
      retainedScrollTop.current = previewFocus.previewRef.current?.parentElement?.scrollTop ?? null;
    }
    const next = { ...configRef.current, [currentMode]: { ...configRef.current[currentMode], ...patch } };
    configRef.current = next; setConfig(next); setRun(null); setStopping(false);
    controller.update(next[currentMode], delay);
  }
  function switchMode(nextMode: Mode) {
    if (locked || nextMode === modeRef.current) return;
    rememberSelection();
    retainedScrollTop.current = workflowScroll.current[nextMode] ?? 0;
    retainedTagFocus.current = false;
    retainedSelection.current = workflowSelections.current[nextMode] ?? null;
    workspaceRevision.current++;
    setMode(nextMode); modeRef.current = nextMode; setRun(null); setStopping(false);
    controller.navigate(configRef.current[nextMode]);
  }
  function refresh() {
    if (locked || mode === 'history') return;
    retainedSelection.current = null;
    retainedScrollTop.current = null;
    retainedTagFocus.current = false;
    delete workflowSelections.current[mode];
    setRun(null); setStopping(false); controller.update(configRef.current[mode], 0);
  }
  function rememberSelection() {
    const currentMode = modeRef.current;
    if (currentMode === 'history') return;
    workflowScroll.current[currentMode] = previewFocus.previewRef.current?.parentElement?.scrollTop ?? 0;
    if (plan?.mode === currentMode) workflowSelections.current[currentMode] = new Set(plan.rows.filter(row => selected.has(row.id)).map(row => row.file));
    else if (retainedSelection.current) workflowSelections.current[currentMode] = new Set(retainedSelection.current);
  }
  function resetSelection() {
    if (jobRef.current || !loaded || modeRef.current === 'history') return;
    workspaceRevision.current++;
    const currentMode = modeRef.current;
    setPreviewViews(previous => { const next = { ...previous }; delete next[currentMode]; return next; });
    setAdvancedModes(previous => ({ ...previous, [currentMode]: false }));
    update(defaults()[modeRef.current]);
    previewFocus.restore();
  }
  function resetAllWorkflows() {
    if (locked) return;
    workspaceRevision.current++;
    retainedSelection.current = null;
    retainedScrollTop.current = null;
    retainedTagFocus.current = false;
    workflowSelections.current = {};
    workflowScroll.current = {};
    const next = defaults();
    configRef.current = next; setConfig(next);
    setSelected(new Set()); setPreviewViews({}); setAdvancedModes({}); setRun(null); setStopping(false);
    setResetVersion(value => value + 1);
    controller.invalidateAll();
    controller.update(modeRef.current === 'history' ? null : next[modeRef.current], 0);
    previewFocus.resetAll();
    notify(t('reset.done'));
  }
  async function paths(value: string[], kind: PathKind) {
    if (!value.length || modeRef.current === 'history') return;
    const c = configRef.current[modeRef.current];
    if (kind === 'compareA' || kind === 'compareB') {
      if (value.length !== 1) throw { key: 'error.singlePath' };
      update(kind === 'compareA' ? { base: value[0] } : { targets: [value[0]] });
      return;
    }
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
    if (!plan || plan.requiresTags || !selected.size || busy || previewState.pending || plan.conflicts.length) return;
    workspaceRevision.current++;
    setJob('execute'); setStopping(false);
    setProgress({ phase: 'confirm', detail: { key: 'progress.confirm' }, completed: 0, total: 0 });
    try {
      const response = await api.execute(plan.id, plan.rows.filter(row => row.candidate && selected.has(row.id)).map(row => row.id));
      if (!('declined' in response)) { delete workflowSelections.current[plan.mode]; controller.invalidateAll(); controller.forget(); setRun(response); setHistory(await api.history()); }
    } catch (error) { controller.invalidateAll(); controller.forget(); report(error); }
    finally { setJob(null); }
  }
  async function openTagSelection() {
    if (!plan || locked || busy || previewState.pending || !selected.size) return;
    const rows = plan.rows.filter(row => selected.has(row.id) && isRowSelectable(plan, row));
    if (!rows.length) return;
    // A delayed picker/drop belongs to the workspace before this operation.
    // It must not replace the plan the tag dialog is about to review.
    workspaceRevision.current++;
    const revision = ++tagReadRevision.current;
    tagOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelledTagFocus.current = null;
    setTagSelection({ id: plan.id, mode: plan.mode, rows, loading: true, error: null });
    setTagReading(true);
    try {
      const taggedRows = await api.selectedTags(plan.id, rows.map(row => row.id));
      if (revision !== tagReadRevision.current) return;
      setTagSelection({ id: plan.id, mode: plan.mode, rows: taggedRows, loading: false, error: null });
      const tags = new Map(taggedRows.map(row => [row.id, row.currentTags]));
      const updated = { ...plan, rows: plan.rows.map(row => tags.has(row.id) ? { ...row, currentTags: tags.get(row.id) } : row) };
      controller.remember(updated);
      setPreviewState(previous => previous.plan?.id === plan.id ? { ...previous, plan: updated } : previous);
    } catch (error) {
      if (revision === tagReadRevision.current) setTagSelection(previous => previous && { ...previous, loading: false, error: issue(error) });
    } finally { setTagReading(false); }
  }
  function closeTagSelection() {
    if (jobRef.current) return;
    tagReadRevision.current++;
    if (tagReading) { cancelledTagFocus.current = tagOpener.current; api.cancel().catch(() => {}); }
    setTagSelection(null);
  }
  async function tagSelected(options: SelectionTags) {
    if (!tagSelection || tagSelection.loading || tagSelection.error || jobRef.current) return;
    const selection = tagSelection;
    setJob('tags'); setStopping(false);
    setProgress({ phase: 'prepare', detail: { key: 'progress.verify' }, completed: 0, total: selection.rows.length });
    try {
      const response = await api.tagSelected(selection.id, selection.rows.map(row => row.id), options);
      if ('declined' in response) return;
      if ('unchanged' in response) { setTagSelection(null); notify(t('selection.tagsUnchanged')); return; }
      if (response.error || response.cancelled || response.unattempted > 0) { setTagSelection(null); controller.invalidateAll(); controller.forget(); setRun(response); setHistory(await api.history()); return; }
      retainedSelection.current = new Set(selection.rows.map(row => row.file));
      retainedScrollTop.current = previewFocus.previewRef.current?.parentElement?.scrollTop ?? null;
      retainedTagFocus.current = true;
      const next = { ...configRef.current, [selection.mode]: { ...configRef.current[selection.mode], colors: options.colors, mergeTags: options.mergeTags } };
      configRef.current = next; setConfig(next);
      setHistory(await api.history()); setTagSelection(null);
      controller.invalidateAll();
      controller.update(next[selection.mode], 0);
      notify(t('selection.tagsUpdated', { count: response.completed }));
    } catch (error) {
      // Preparation can stop before a run is created. Keep the checked rows
      // available in the dialog; no file operation has started in this branch.
      if (stoppingRef.current && issue(error).key === 'error.cancelled') { notify(t('run.cancelled')); return; }
      throw error;
    } finally { setJob(null); setStopping(false); }
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
    rememberSelection();
    retainedSelection.current = null;
    workspaceRevision.current++;
    controller.suspend(); setRun(null); setMode('history'); modeRef.current = 'history';
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
  function stop() {
    if (stoppingRef.current) return;
    retainedSelection.current = null; stoppingRef.current = true; setStopping(true);
    if (jobRef.current) api.cancel().catch(report); else controller.stop();
  }

  const c = mode !== 'history' ? config[mode] : null;
  const tagOperation = mode === 'tags';
  const needsReferenceExt = mode === 'orphans' && !!c?.base && (c.mixed || c.targets.length > 0) && !c.referenceExt.trim();
  return <I18nContext.Provider value={i18n}>
    <header className="titlebar">
      <div className="titlebar-sidebar"><span className="app-name">Finder Sync</span></div>
      <div className="titlebar-main">
        <div className="workspace-label"><span>{t('nav.workflows')}</span><ChevronRight size={12} /><strong>{t(mode === 'history' ? 'nav.history' : `task.${mode}`)}</strong></div>
        <div className="titlebar-actions">
          <ThemeMenu theme={theme} onChange={setTheme} />
          <DropdownMenu><DropdownMenuTrigger asChild><Button className="language-button" variant="ghost" size="sm" disabled={locked || languageBusy} aria-label={t('language.title')}><Languages size={15} /><span>{catalog.bundles.find(b => b.code === locale)?.label ?? locale}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>{t('language.title')}</DropdownMenuLabel>{catalog.bundles.map(bundle => <DropdownMenuItem key={bundle.code} onSelect={() => changeLanguage(bundle.code)}>{bundle.code === locale ? <Check size={14} /> : <span className="size-3.5" />}{bundle.label}</DropdownMenuItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => api.openLocaleFolder().catch(report)}><FolderOpen />{t('language.open')}</DropdownMenuItem><DropdownMenuItem onSelect={reloadLanguages}><RefreshCw />{t('language.reload')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>
      </div>
    </header>
    <div className="app-shell"><aside className="sidebar"><div className="nav-caption">{t('nav.workflows')}</div><nav aria-label={t('nav.workflows')}>{(Object.keys(modeIcons) as Mode[]).map(key => { const Icon = modeIcons[key]; return <Button key={key} variant="ghost" className={`nav-button ${mode === key ? 'active' : ''}`} disabled={locked} aria-current={mode === key ? 'page' : undefined} onClick={() => switchMode(key)}><Icon strokeWidth={1.65} /><span>{t(`task.${key}`)}</span></Button>; })}</nav><div className="nav-divider" /><Button variant="ghost" className={`nav-button ${mode === 'history' ? 'active' : ''}`} disabled={locked || previewState.busy} onClick={showHistory}><History strokeWidth={1.65} /><span>{t('nav.history')}</span>{history.length > 0 && <span className="nav-count">{history.length}</span>}</Button><div className="sidebar-bottom"><ResetAllDialog open={resetOpen} onOpenChange={setResetOpen} disabled={locked} reset={resetAllWorkflows} /><div className="sidebar-version"><span className="connection-dot" />{t('nav.version', { version })}</div></div></aside>
      <main className="workspace" aria-label={t('app.title')}>
        {mode === 'history' ? run ? <Activity key={run.id} run={run} exportRun={() => exportRun(run)} back={() => setRun(null)} /> : <><header className="heading"><div><h1>{t('history.title')}</h1><p>{t('history.description')}</p></div><Button variant="outline" size="sm" disabled={locked || !history.length} aria-busy={historyBusy} title={t('history.clearHint')} onClick={clearHistory}><Trash2 />{t('history.clearAll')}</Button></header><ErrorNotice error={previewState.error} />{history.length ? <div className="history-list">{history.map(item => <button key={item.id} className="history-item" onClick={() => setRun(item)}><div><strong>{t(`task.${item.mode}`)}</strong><small>{new Date(item.startedAt).toLocaleString(locale)} · {t('history.count', { count: item.records.length })}</small></div><span className={`status ${item.error ? 'failed' : item.cancelled ? 'pending' : 'completed'}`}>{t('history.summary', { count: item.completed })}</span></button>)}</div> : <div className="empty"><History /><strong>{t('history.empty')}</strong><p>{t('history.emptyHint')}</p></div>}</>
          : run ? <Activity key={run.id} run={run} exportRun={() => exportRun(run)} refresh={refresh} /> : <>
            <div className="workspace-scroll">
            <WorkflowHeader ref={previewFocus.toggleRef} config={c!} collapsed={previewFocus.focused} disabled={locked} controls={previewFocus.settingsId} toggle={() => previewFocus.focused ? previewFocus.restore() : previewFocus.minimize()} reset={resetSelection} />
            <div className="workspace-settings" id={previewFocus.settingsId} ref={previewFocus.settingsRef} data-collapsed={previewFocus.focused} inert={previewFocus.focused} aria-hidden={previewFocus.focused || undefined}><div className="workspace-settings-content">
            <p className="workflow-description">{t(`task.${mode}.description`)}</p>
            <WorkflowConfig key={`${mode}-${resetVersion}`} config={c!} disabled={locked} advanced={!!advancedModes[mode]} onAdvancedChange={value => setAdvancedModes(previous => ({ ...previous, [mode]: value }))} update={update} choose={choose} dropped={dropped} refresh={refresh} reveal={reveal} />
            </div></div>
            <div className={`output ${previewFocus.focused ? 'preview-at-top' : ''}`} ref={previewFocus.previewRef} inert={confirming || previewState.restoring} aria-busy={confirming || previewLoading || previewState.restoring}><ErrorNotice error={previewState.error} />
              {mode === 'list' && (c!.includeExt || c!.excludeExt) && !executing && <div className="list-extension-notice" role="status"><div><strong>{t('list.extensionActive')}</strong><span>{[c!.includeExt && t('list.includeSummary', { extensions: c!.includeExt }), c!.excludeExt && t('list.excludeSummary', { extensions: c!.excludeExt })].filter(Boolean).join(' · ')}</span></div><Button variant="outline" size="sm" disabled={locked} onClick={() => update({ includeExt: '', excludeExt: '' })}><X />{t('list.clearExtensions')}</Button></div>}
              {executing ? <div className="progress-panel" role="status"><LoaderCircle className="animate-spin text-muted-foreground" size={24} /><strong>{t('preview.working')}</strong><Progress value={progress.total ? (progress.completed / progress.total) * 100 : undefined} className={`h-1 w-80 max-w-full ${progress.total ? '' : 'indeterminate'}`} /><p>{text(progress.detail)}</p><small>{progress.total ? `${progress.completed} / ${progress.total}` : t('preview.large')}</small><Button variant="outline" size="sm" disabled={stopping} onClick={stop}>{t(stopping ? 'action.stopping' : 'action.stop')}</Button></div>
                : previewLoading ? <PreviewSkeleton mode={mode} stopping={stopping} stop={stop} /> : plan ? <FileResults key={plan.id} plan={plan} ready={!previewState.restoring} selected={selected} setSelected={setSelected} viewState={previewViews[mode]} onViewStateChange={value => setPreviewViews(previous => ({ ...previous, [mode]: value }))} reveal={reveal} copyPath={copyPath} tagSelected={mode === 'list' || mode === 'filter' || mode === 'compare' ? openTagSelection : undefined} />
                  : <div className="empty"><span className="empty-icon"><ScanLine strokeWidth={1.4} /></span><strong>{t(previewState.pending ? 'preview.pending' : mode === 'filter' ? 'filter.emptyTitle' : 'preview.emptyTitle')}</strong><p>{t(needsReferenceExt ? 'rule.referenceRequired' : 'preview.emptyHint')}</p></div>}
            </div></div>
              <footer className="footer">
                <div className="footer-summary" role="status">{t(plan ? mode === 'compare' ? 'preview.selected' : tagOperation ? 'preview.tagsSummary' : mode === 'filter' && !summary.count ? 'filter.reviewHint' : 'preview.trashSummary' : previewState.pending ? 'preview.pending' : 'preview.ready', { count: mode === 'compare' ? selected.size : summary.count })}
                  <small>{t(mode === 'compare' ? 'compare.tagSelectionHint' : plan ? tagOperation ? 'preview.tagsHint' : 'preview.size' : needsReferenceExt ? 'rule.referenceRequired' : 'preview.auto', { size: sizeText(summary.size) })}</small>
                </div>
                <Button className="execute-button" disabled={locked || !plan || plan.requiresTags || !(mode === 'compare' ? selected.size : summary.count) || busy || previewState.pending || !!plan.conflicts.length} onClick={mode === 'compare' ? openTagSelection : execute}>{t(mode === 'compare' ? 'action.openTags' : tagOperation ? 'action.executeTags' : 'action.executeTrash', { count: mode === 'compare' ? selected.size : summary.count })}<ArrowUpRight size={16} /></Button>
              </footer>
            </>}
      </main>
    </div>{tagSelection && <SelectedTagsDialog rows={tagSelection.rows} initialColors={config[tagSelection.mode].colors} initialMerge={config[tagSelection.mode].mergeTags} busy={!!job} progress={progress} stopping={stopping} stop={stop} loading={tagSelection.loading} loadError={tagSelection.error} close={closeTagSelection} apply={tagSelected} />}{notice && <div className="toast" role="status">{notice}</div>}
  </I18nContext.Provider>;
}
