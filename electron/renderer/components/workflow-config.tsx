import { lazy, Suspense, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { ArrowRight, ArrowLeftRight, Eraser, FileText, Folder, FolderOpen, ListChecks, Plus, RefreshCw, RotateCcw, X, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { useI18n } from '@/lib/i18n';
import { basename, defaults, finderColors, finderColorCodes } from '@/lib/config';
import { usePopupKeyboard } from '@/lib/popup-keyboard';
import type { Config, PathKind } from '@/types';

type ChoosePath = (kind: PathKind, replace?: string) => void | Promise<void>;
const DatePicker = lazy(() => import('@/components/date-picker').then(module => ({ default: module.DatePicker })));

export function Choice({ label, value, choices, disabled, onChange }: {
  label: string; value: string; choices: [string, ReactNode][]; disabled?: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label><Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger id={id} size="sm" className="text-xs"><SelectValue /></SelectTrigger>
    <SelectContent>{choices.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent>
  </Select></div>;
}
export function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <div className="check-field"><Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={value => onChange(value === true)} /><label htmlFor={id}>{label}</label></div>;
}
export function TagPicker({ values, disabled, onChange, onClearFileTags }: {
  values: string[]; disabled: boolean; onChange: (values: string[]) => void; onClearFileTags?: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const names = values.map(color => t(`color.${color}`)).join(', ');
  return <div className="field"><label id={`${id}-label`} htmlFor={id}>{t('rule.colorLabel')}</label>
    <DropdownMenu><DropdownMenuTrigger asChild>
      <Button id={id} variant="outline" size="sm" className="tag-picker" disabled={disabled} aria-labelledby={`${id}-label`} aria-describedby={`${id}-selection`} title={names || t('rule.chooseTags')}>
        <span className="tag-picker-value">{values.length > 0 && <span className="tags" aria-hidden="true">{values.map(color => <span key={color} className={`tag-dot color-${finderColorCodes[color]}`} />)}</span>}
          <span>{values.length === 0 ? t('rule.chooseTags') : values.length === 1 ? names : t('rule.tagsSelected', { count: values.length })}</span>
        </span><ChevronDown aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger><DropdownMenuContent align="start" aria-labelledby={`${id}-label`} className="tag-picker-menu">
      <DropdownMenuItem disabled={!values.length} onSelect={event => { event.preventDefault(); onChange([]); }}>
        <X />{t('rule.clearTagSelection')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {finderColors.map(color => <DropdownMenuCheckboxItem key={color} checked={values.includes(color)} onSelect={event => event.preventDefault()}
        onCheckedChange={checked => onChange(finderColors.filter(value => value === color ? checked === true : values.includes(value)))}>
        <span className="tag"><span className={`tag-dot color-${finderColorCodes[color]}`} aria-hidden="true" />{t(`color.${color}`)}</span>
      </DropdownMenuCheckboxItem>)}
      {onClearFileTags && <><DropdownMenuSeparator /><DropdownMenuItem disabled={disabled} onSelect={onClearFileTags}>
        <Eraser />{t('selection.clearFileTags')}
      </DropdownMenuItem></>}
    </DropdownMenuContent></DropdownMenu>
    <span id={`${id}-selection`} className="sr-only">{names || t('rule.chooseTags')}</span>
  </div>;
}
function ClearButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return <Button className="folder-remove" variant="ghost" size="icon-xs" disabled={disabled} aria-label={label} title={label} onClick={onClick}><X /></Button>;
}

function FileFilters({ config: c, disabled, update }: {
  config: Config; disabled: boolean; update: (patch: Partial<Config>, delay?: number) => void;
}) {
  const { t } = useI18n();
  const hint = useId();
  const fields = ['nameContains', 'nameExcludes', 'nameRegex', 'includeExt', 'excludeExt', 'sizeMin', 'sizeMax', 'modifiedFrom', 'modifiedTo'] as const;
  const hasFilters = c.invertFilter || fields.some(key => c[key]);
  const input = (key: typeof fields[number], type = 'text', placeholder = '') => <label className="filter-field">
    <span>{t(`filter.${key}`)}</span><Input type={type} value={c[key]} placeholder={placeholder}
      min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined}
      maxLength={type === 'text' ? 1024 : undefined} aria-describedby={key === 'nameRegex' ? `${hint}-regex` : undefined}
      disabled={disabled} onChange={event => update({ [key]: event.target.value }, 400)} />
  </label>;
  return <div className="file-filters">
    <div className="filter-heading"><strong>{t('filter.title')}</strong><div className="filter-heading-actions">
      <Check label={t('filter.invert')} checked={c.invertFilter} disabled={disabled} onChange={invertFilter => update({ invertFilter })} />
      <Button variant="ghost" size="xs" disabled={disabled || !hasFilters}
        onClick={() => update({ ...Object.fromEntries(fields.map(key => [key, ''])), invertFilter: false })}><X />{t('filter.clear')}</Button>
    </div></div>
    <div className="filter-grid">
      {input('nameContains', 'text', t('filter.textPlaceholder'))}{input('nameExcludes', 'text', t('filter.textPlaceholder'))}
      {input('includeExt', 'text', '.jpg, .png')}{input('excludeExt', 'text', '.xmp, .nef')}
      <div className="filter-regex">{input('nameRegex', 'text', '^DSC_\\d+\\.(jpg|png)$')}<p id={`${hint}-regex`} className="rule-note">{t('filter.regexHint')}</p></div>
      <div className="filter-range">{input('sizeMin', 'number')}{input('sizeMax', 'number')}
        <Choice label={t('filter.sizeUnit')} value={c.sizeUnit} choices={['B', 'KB', 'MB', 'GB'].map(unit => [unit, unit])} disabled={disabled} onChange={sizeUnit => update({ sizeUnit })} /></div>
      <div className="filter-range">
        <Suspense fallback={<>{['filter.modifiedFrom', 'filter.modifiedTo'].map(key => <div key={key} className="filter-field" aria-busy="true"><span>{t(key)}</span><Skeleton className="h-8 w-full rounded-md" /></div>)}</>}>
          <DatePicker label={t('filter.modifiedFrom')} value={c.modifiedFrom} disabled={disabled} onChange={modifiedFrom => update({ modifiedFrom })} />
          <DatePicker label={t('filter.modifiedTo')} value={c.modifiedTo} disabled={disabled} onChange={modifiedTo => update({ modifiedTo })} />
        </Suspense>
      </div>
    </div>
    <div className="filter-flags"><Check label={t('rule.ignoreCase')} checked={c.ignoreCase} disabled={disabled} onChange={ignoreCase => update({ ignoreCase })} /></div>
    <p className="rule-note">{t(c.invertFilter ? 'filter.invertedHint' : 'filter.hint')}</p>
    <p className="rule-note">{t('filter.rangeHint')}</p>
  </div>;
}
function FolderItem({ file, kind, disabled, picking, choose, remove, reveal }: {
  file: string; kind: PathKind; disabled: boolean; picking: boolean; choose: () => void;
  remove?: () => void; reveal: (file: string, kind: PathKind) => void;
}) {
  const { t } = useI18n();
  const keyboard = usePopupKeyboard({});
  return <ContextMenu open={keyboard.open} onOpenChange={keyboard.setOpen}>
    <ContextMenuTrigger asChild disabled={disabled}><div className={`folder-item ${picking ? 'is-picking' : ''}`} onClick={event => { if (!disabled && event.target === event.currentTarget) choose(); }}>
      <button ref={keyboard.triggerRef} type="button" className="folder-pick" disabled={disabled} aria-label={file} title={file} onClick={choose}>
        <span className="folder-symbol">{kind === 'list' ? <FileText size={18} strokeWidth={1.6} /> : <Folder size={18} strokeWidth={1.6} />}</span>
        <span className="folder-info"><span className="folder-name">{basename(file)}</span><span className="folder-path">{file}</span></span>
      </button>
      {remove && <ClearButton disabled={disabled} label={t('folder.remove', { name: file })} onClick={remove} />}
    </div></ContextMenuTrigger>
    <ContextMenuContent aria-label={file} onKeyDownCapture={keyboard.onKeyDownCapture} onCloseAutoFocus={event => {
      keyboard.onCloseAutoFocus(event);
      if (!event.defaultPrevented) { event.preventDefault(); keyboard.triggerRef.current?.focus({ preventScroll: true }); }
    }}>
      <ContextMenuItem disabled={disabled} onSelect={() => reveal(file, kind)}><FolderOpen />{t('action.reveal')}</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}
export function WorkflowHeader({ config, collapsed, disabled, controls, toggle, reset, ref }: {
  config: Config; collapsed: boolean; disabled?: boolean; controls: string; toggle: () => void; reset: () => void; ref?: Ref<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  const source = config.mode === 'filter' ? '' : config.mode === 'list' ? config.listSource === 'text' ? t('rule.listText') : basename(config.list) : basename(config.base);
  const targets = config.mixed && config.mode === 'orphans' ? '' : config.targets.map(basename).join(', ');
  const action = t(collapsed ? 'preview.showSettings' : 'folder.collapse');
  const hasChanges = Object.entries(defaults()[config.mode]).some(([key, value]) => JSON.stringify(config[key as keyof Config]) !== JSON.stringify(value));
  return <header className="workflow-heading"><h1>
    <button ref={ref} type="button" className="workflow-toggle" disabled={disabled} aria-label={`${t(`task.${config.mode}`)}: ${action}`} title={action} aria-expanded={!collapsed} aria-controls={controls} onClick={toggle}>
      <span className="workflow-name">{t(`task.${config.mode}`)}</span><span className="workflow-summary-paths" aria-hidden="true"><span>{source}</span>{targets && <>{source && <ArrowRight size={13} />}<span>{targets}</span></>}</span>{collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
    </button>
  </h1><Button className="workflow-reset" variant="ghost" size="sm" disabled={disabled || !hasChanges} title={t('action.resetWorkflowHint')} onClick={reset}><RotateCcw />{t('action.resetWorkflow')}</Button></header>;
}
function FolderCard({ kind, title, placeholder, paths, disabled, choose, dropped, remove, reveal }: {
  kind: PathKind; title: string; placeholder: string; paths: string[]; disabled: boolean;
  choose: ChoosePath; dropped: (files: File[], kind: PathKind) => void; remove?: (index: number) => void;
  reveal: (file: string, kind: PathKind) => void;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  const action = t(paths.length ? 'folder.change' : 'folder.choose');
  const pick = async (index: number | null) => {
    setPickingIndex(index);
    try {
      if (kind === 'targets' && index !== null) await choose(kind, paths[index]);
      else await choose(kind);
    } finally { setPickingIndex(null); }
  };
  return <Card className={`folder-card ${dragging ? 'is-dragging' : ''}`}
    onDragOver={event => { event.preventDefault(); if (!disabled) { setDragging(true); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) dropped([...event.dataTransfer.files], kind); }}>
    {(kind !== 'targets' || !paths.length) && <button type="button" className="folder-hit-area" disabled={disabled} aria-label={`${action}: ${title}`} title={paths.join('\n') || placeholder} onClick={() => pick(paths.length ? 0 : null)} />}
    <CardContent className="folder-content"><div className="folder-header"><span>{title}</span>{kind === 'targets' && <Button className="folder-add" variant="ghost" size="xs" disabled={disabled} aria-label={t('folder.addTarget')} title={t('folder.addTarget')} onClick={() => pick(null)}><Plus />{t('folder.add')}</Button>}</div>
      {paths.length ? paths.map((file, index) => <FolderItem key={file} file={file} kind={kind} disabled={disabled} picking={pickingIndex === index} choose={() => pick(index)} remove={remove ? () => remove(index) : undefined} reveal={reveal} />)
        : <div className="folder-empty"><span className="folder-symbol"><Plus size={18} strokeWidth={1.6} /></span><span className="folder-info"><strong>{placeholder}</strong><small>{t('folder.drop')}</small></span></div>}
    </CardContent></Card>;
}

export function WorkflowConfig({ config: c, disabled, update, choose, dropped, refresh, reveal, advanced: controlledAdvanced, onAdvancedChange }: {
  config: Config; disabled: boolean; update: (patch: Partial<Config>, delay?: number) => void;
  choose: ChoosePath; dropped: (files: File[], kind: PathKind) => void; refresh: () => void;
  reveal: (file: string, kind: PathKind) => void;
  advanced?: boolean; onAdvancedChange?: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const [localAdvanced, setLocalAdvanced] = useState(false);
  const advanced = controlledAdvanced ?? localAdvanced;
  function setAdvanced(value: boolean) { setLocalAdvanced(value); onAdvancedChange?.(value); }
  const listEditor = useRef<HTMLTextAreaElement>(null);
  const extensionHelpId = useId();
  const mode = c.mode;
  const select = (key: keyof Config, label: string, pairs: [string, string][]) => <Choice label={t(label)} value={String(c[key])} choices={pairs.map(([value, message]) => [value, t(message)])} disabled={disabled} onChange={value => update({ [key]: value })} />;
  const check = (key: keyof Config, label: string) => <Check label={t(label)} checked={Boolean(c[key])} disabled={disabled} onChange={value => update({ [key]: value })} />;
  const field = (key: keyof Config, label: string, placeholder = '', wide = false, description?: string) => <label className="field">{t(label)}<Input className={`${wide ? 'w-36' : 'w-20'} h-8 text-xs`} value={String(c[key])} placeholder={placeholder} aria-describedby={description} disabled={disabled} onChange={event => update({ [key]: event.target.value }, 400)} /></label>;
  const source = mode === 'list' && c.listSource === 'text'
    ? <Card className="folder-card"><button type="button" className="folder-hit-area" disabled={disabled} aria-label={t('rule.editList')} onClick={() => listEditor.current?.focus()} /><CardContent className="folder-content"><div className="folder-header">{t('rule.listText')}</div><div className="folder-item"><span className="folder-symbol"><ListChecks size={18} /></span><div className="folder-info"><div className="folder-name">{t('rule.onePerLine')}</div><div className="folder-path">{t('rule.pasteHint')}</div></div>{c.listText && <ClearButton disabled={disabled} label={t('rule.clearList')} onClick={() => { update({ listText: '' }); listEditor.current?.focus(); }} />}</div></CardContent></Card>
    : <FolderCard kind={mode === 'list' ? 'list' : mode === 'compare' ? 'compareA' : 'base'} title={t(mode === 'list' ? 'folder.list' : mode === 'compare' ? 'compare.folderA' : c.mixed && mode === 'orphans' ? 'folder.mixed' : 'folder.reference')}
      placeholder={t(mode === 'list' ? 'folder.chooseList' : mode === 'compare' ? 'compare.chooseA' : c.mixed && mode === 'orphans' ? 'folder.chooseMixed' : 'folder.chooseReference')}
      paths={mode === 'list' ? c.list ? [c.list] : [] : c.base ? [c.base] : []} disabled={disabled} choose={choose} dropped={dropped} remove={() => update(mode === 'list' ? { list: '' } : { base: '' })} reveal={reveal} />;
  return <section className="configuration" aria-label={t('preview.auto')}>
    {mode === 'orphans' && <div className="folder-layout"><span>{t('folder.layout')}</span><Tabs value={c.mixed ? 'mixed' : 'separate'} onValueChange={value => update({ mixed: value === 'mixed' })}><TabsList className="h-8" aria-label={t('folder.layout')}><TabsTrigger className="text-xs" value="separate" disabled={disabled}>{t('folder.separate')}</TabsTrigger><TabsTrigger className="text-xs" value="mixed" disabled={disabled}>{t('folder.same')}</TabsTrigger></TabsList></Tabs></div>}
    {mode === 'list' && <div className="folder-layout"><span>{t('rule.listSource')}</span><Tabs value={c.listSource} onValueChange={value => update({ listSource: value })}><TabsList className="h-8" aria-label={t('rule.listSource')}><TabsTrigger className="text-xs" value="file" disabled={disabled}>{t('rule.listFile')}</TabsTrigger><TabsTrigger className="text-xs" value="text" disabled={disabled}>{t('rule.listText')}</TabsTrigger></TabsList></Tabs></div>}
    <div className={`folder-grid ${mode === 'filter' || mode === 'orphans' && c.mixed ? 'mixed' : ''}`}>{mode !== 'filter' && source}{!(mode === 'orphans' && c.mixed) && <>{mode === 'compare' ? <ArrowLeftRight className="folder-arrow" size={18} /> : mode !== 'filter' && <ArrowRight className="folder-arrow" size={18} />}<FolderCard kind={mode === 'compare' ? 'compareB' : 'targets'} title={t(mode === 'filter' ? 'filter.folders' : mode === 'compare' ? 'compare.folderB' : 'folder.targets')} placeholder={t(mode === 'compare' ? 'compare.chooseB' : 'folder.chooseTargets')} paths={c.targets} disabled={disabled} choose={choose} dropped={dropped} remove={index => update({ targets: c.targets.filter((_, i) => i !== index) })} reveal={reveal} /></>}</div>
    <div className="rules">
      {mode === 'orphans' && <>{field('referenceExt', 'rule.referenceExt', 'CR3, NEF, etc...', true)}{select('matchBy', 'rule.matchBy', [['relative','rule.relativeStem'],['name','rule.nameStem']])}</>}
      {mode === 'tags' && <>{select('tagAction','rule.operation',[['sync','rule.sync'],['color','rule.color'],['clear','rule.clear']])}
        {c.tagAction === 'sync' ? check('mergeTags','rule.merge') : <>{c.tagAction === 'color' && <TagPicker values={c.colors} disabled={disabled} onChange={colors => update({ colors })} />}{select('select','rule.selection',[['matched','rule.matched'],['unmatched','rule.unmatched'],['all','rule.all']])}</>}</>}
      {mode === 'list' && <>{select('listMode','rule.listMode',[['keep','rule.keepList'],['delete','rule.deleteList']])}{select('matchBy','rule.matchBy',[['name','rule.fullName'],['relative','rule.relative'],['stem','rule.stem']])}{check('ignoreCase','rule.ignoreCase')}</>}
      {mode === 'compare' && <>{select('compareSelection','compare.selection',[['common','compare.common'],['unique','compare.unique'],['onlyA','compare.onlyA'],['onlyB','compare.onlyB']])}{['common', 'unique'].includes(c.compareSelection) && select('scope','rule.scope',[['both','rule.scopeBoth'],['base','compare.folderA'],['targets','compare.folderB']])}{select('matchBy','rule.matchBy',[['name','rule.fullName'],['relative','rule.relative'],['stem','rule.stem']])}{check('ignoreCase','rule.ignoreCase')}</>}
      {mode === 'filter' && <>{check('recursive','rule.recursive')}<label className="field">{t('rule.depth')}<Input className="h-8 w-24 text-xs" type="number" min="0" step="1" value={c.depth} placeholder={t('rule.unlimited')} disabled={disabled || !c.recursive} onChange={event => update({ depth: event.target.value }, 400)} /></label><span className="filter-depth-hint">{t('filter.depthHint')}</span></>}
    </div>
    {mode === 'filter' && <FileFilters config={c} disabled={disabled} update={update} />}
    {mode === 'list' && c.listSource === 'text' && <Textarea ref={listEditor} aria-label={t('rule.onePerLine')} placeholder={t('rule.listPlaceholder')} className="list-editor" value={c.listText} maxLength={2000000} disabled={disabled} onChange={event => update({ listText: event.target.value }, 400)} />}
    {mode !== 'filter' && <p className={`rule-note ${mode === 'tags' && c.tagAction !== 'sync' ? 'text-destructive' : ''}`}>{t(mode === 'orphans' ? 'rule.orphanNote' : mode === 'compare' ? `compare.note.${c.matchBy}` : mode === 'list' ? c.listMode === 'keep' ? 'rule.keepNote' : 'rule.deleteNote' : c.tagAction === 'sync' ? 'rule.syncNote' : c.tagAction === 'color' ? c.colors.length ? 'rule.colorNote' : 'error.tagsRequired' : 'rule.clearNote')}</p>}
    <div className="config-toolbar"><span className="auto-preview"><span className="connection-dot" />{t('preview.auto')}</span>
      <div className="config-actions"><Button variant="ghost" size="sm" disabled={disabled} onClick={refresh} title={t('action.preview')}><RefreshCw />{t('action.refresh')}</Button>{mode !== 'filter' && <Button variant="ghost" size="sm" disabled={disabled} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><SlidersHorizontal />{t(advanced ? 'rule.less' : 'rule.more')}{advanced ? <ChevronUp /> : <ChevronDown />}</Button>}</div></div>
    {advanced && <div className="advanced">{check('recursive','rule.recursive')}{c.recursive && field('depth','rule.depth',t('rule.unlimited'))}
      {mode === 'tags' && (c.tagAction === 'sync' ? check('includeClear','rule.includeClear') : <>{select('scope','rule.scope',[['targets','rule.scopeTargets'],['base','rule.scopeBase'],['both','rule.scopeBoth']])}{c.scope !== 'targets' && select('match','rule.baseMatch',[['any','rule.any'],['all','rule.every']])}</>)}
      {mode === 'list' && <>{field('includeExt','rule.includeExt',t('rule.allExtensions'),true,extensionHelpId)}{field('excludeExt','rule.excludeExt',t('rule.noExtensions'),true,extensionHelpId)}
        <p id={extensionHelpId} className="rule-note w-full">{t('rule.extensionFiltersHint')}</p>
      </>}
    </div>}
  </section>;
}
