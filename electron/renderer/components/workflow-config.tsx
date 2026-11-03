import { useId, useRef, useState, type Ref } from 'react';
import { ArrowRight, FileText, Folder, FolderOpen, ListChecks, Plus, RefreshCw, RotateCcw, X, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { useI18n } from '@/lib/i18n';
import { basename } from '@/lib/config';
import { usePopupKeyboard } from '@/lib/popup-keyboard';
import type { Config, PathKind } from '@/types';

type ChoosePath = (kind: PathKind, replace?: string) => void | Promise<void>;

export function Choice({ label, value, choices, disabled, onChange }: {
  label: string; value: string; choices: [string, string][]; disabled?: boolean; onChange: (value: string) => void;
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
function ClearButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return <Button className="folder-remove" variant="ghost" size="icon-xs" disabled={disabled} aria-label={label} title={label} onClick={onClick}><X /></Button>;
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
  const source = config.mode === 'list' ? config.listSource === 'text' ? t('rule.listText') : basename(config.list) : basename(config.base);
  const targets = config.mixed && config.mode === 'orphans' ? '' : config.targets.map(basename).join(', ');
  const action = t(collapsed ? 'preview.showSettings' : 'folder.collapse');
  const hasSelection = Boolean(config.base || config.targets.length || config.list || config.listText);
  return <header className="workflow-heading"><h1>
    <button ref={ref} type="button" className="workflow-toggle" disabled={disabled} aria-label={`${t(`task.${config.mode}`)}: ${action}`} title={action} aria-expanded={!collapsed} aria-controls={controls} onClick={toggle}>
      <span className="workflow-name">{t(`task.${config.mode}`)}</span><span className="workflow-summary-paths" aria-hidden="true"><span>{source}</span>{targets && <><ArrowRight size={13} /><span>{targets}</span></>}</span>{collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
    </button>
  </h1><Button className="workflow-reset" variant="ghost" size="sm" disabled={disabled || !hasSelection} title={t('action.resetAllHint')} onClick={reset}><RotateCcw />{t('action.resetAll')}</Button></header>;
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

export function WorkflowConfig({ config: c, disabled, update, choose, dropped, refresh, reveal }: {
  config: Config; disabled: boolean; update: (patch: Partial<Config>, delay?: number) => void;
  choose: ChoosePath; dropped: (files: File[], kind: PathKind) => void; refresh: () => void;
  reveal: (file: string, kind: PathKind) => void;
}) {
  const { t } = useI18n();
  const [advanced, setAdvanced] = useState(false);
  const listEditor = useRef<HTMLTextAreaElement>(null);
  const mode = c.mode;
  const select = (key: keyof Config, label: string, pairs: [string, string][]) => <Choice label={t(label)} value={String(c[key])} choices={pairs.map(([value, key]) => [value, t(key)])} disabled={disabled} onChange={value => update({ [key]: value })} />;
  const check = (key: keyof Config, label: string) => <Check label={t(label)} checked={Boolean(c[key])} disabled={disabled} onChange={value => update({ [key]: value })} />;
  const field = (key: keyof Config, label: string, placeholder = '', wide = false) => <label className="field">{t(label)}<Input className={`${wide ? 'w-36' : 'w-20'} h-8 text-xs`} value={String(c[key])} placeholder={placeholder} disabled={disabled} onChange={event => update({ [key]: event.target.value }, 400)} /></label>;
  const source = mode === 'list' && c.listSource === 'text'
    ? <Card className="folder-card"><button type="button" className="folder-hit-area" disabled={disabled} aria-label={t('rule.editList')} onClick={() => listEditor.current?.focus()} /><CardContent className="folder-content"><div className="folder-header">{t('rule.listText')}</div><div className="folder-item"><span className="folder-symbol"><ListChecks size={18} /></span><div className="folder-info"><div className="folder-name">{t('rule.onePerLine')}</div><div className="folder-path">{t('rule.pasteHint')}</div></div>{c.listText && <ClearButton disabled={disabled} label={t('rule.clearList')} onClick={() => { update({ listText: '' }); listEditor.current?.focus(); }} />}</div></CardContent></Card>
    : <FolderCard kind={mode === 'list' ? 'list' : 'base'} title={t(mode === 'list' ? 'folder.list' : c.mixed && mode === 'orphans' ? 'folder.mixed' : 'folder.reference')}
      placeholder={t(mode === 'list' ? 'folder.chooseList' : c.mixed && mode === 'orphans' ? 'folder.chooseMixed' : 'folder.chooseReference')}
      paths={mode === 'list' ? c.list ? [c.list] : [] : c.base ? [c.base] : []} disabled={disabled} choose={choose} dropped={dropped} remove={() => update(mode === 'list' ? { list: '' } : { base: '' })} reveal={reveal} />;
  return <section className="configuration" aria-label={t('preview.auto')}>
    {mode === 'orphans' && <div className="folder-layout"><span>{t('folder.layout')}</span><Tabs value={c.mixed ? 'mixed' : 'separate'} onValueChange={value => update({ mixed: value === 'mixed' })}><TabsList className="h-8" aria-label={t('folder.layout')}><TabsTrigger className="text-xs" value="separate" disabled={disabled}>{t('folder.separate')}</TabsTrigger><TabsTrigger className="text-xs" value="mixed" disabled={disabled}>{t('folder.same')}</TabsTrigger></TabsList></Tabs></div>}
    {mode === 'list' && <div className="folder-layout"><span>{t('rule.listSource')}</span><Tabs value={c.listSource} onValueChange={value => update({ listSource: value })}><TabsList className="h-8" aria-label={t('rule.listSource')}><TabsTrigger className="text-xs" value="file" disabled={disabled}>{t('rule.listFile')}</TabsTrigger><TabsTrigger className="text-xs" value="text" disabled={disabled}>{t('rule.listText')}</TabsTrigger></TabsList></Tabs></div>}
    <div className={`folder-grid ${mode === 'orphans' && c.mixed ? 'mixed' : ''}`}>{source}{!(mode === 'orphans' && c.mixed) && <><ArrowRight className="folder-arrow" size={18} /><FolderCard kind="targets" title={t('folder.targets')} placeholder={t('folder.chooseTargets')} paths={c.targets} disabled={disabled} choose={choose} dropped={dropped} remove={index => update({ targets: c.targets.filter((_, i) => i !== index) })} reveal={reveal} /></>}</div>
    <div className="rules">
      {mode === 'orphans' && <>{field('referenceExt', 'rule.referenceExt')}{select('matchBy', 'rule.matchBy', [['relative','rule.relativeStem'],['name','rule.nameStem']])}</>}
      {mode === 'tags' && <>{select('tagAction','rule.operation',[['sync','rule.sync'],['color','rule.color'],['clear','rule.clear']])}
        {c.tagAction === 'sync' ? check('mergeTags','rule.merge') : <>{c.tagAction === 'color' && select('color','rule.colorLabel',['green','red','blue','orange','yellow','purple','gray'].map(color => [color,`color.${color}`]))}{select('select','rule.selection',[['matched','rule.matched'],['unmatched','rule.unmatched'],['all','rule.all']])}</>}</>}
      {mode === 'list' && <>{select('listMode','rule.listMode',[['keep','rule.keepList'],['delete','rule.deleteList']])}{select('matchBy','rule.matchBy',[['name','rule.fullName'],['relative','rule.relative'],['stem','rule.stem']])}{check('ignoreCase','rule.ignoreCase')}</>}
    </div>
    {mode === 'list' && c.listSource === 'text' && <Textarea ref={listEditor} aria-label={t('rule.onePerLine')} placeholder={t('rule.listPlaceholder')} className="list-editor" value={c.listText} maxLength={2000000} disabled={disabled} onChange={event => update({ listText: event.target.value }, 400)} />}
    <p className={`rule-note ${mode === 'tags' && c.tagAction !== 'sync' ? 'text-destructive' : ''}`}>{t(mode === 'orphans' ? 'rule.orphanNote' : mode === 'list' ? c.listMode === 'keep' ? 'rule.keepNote' : 'rule.deleteNote' : c.tagAction === 'sync' ? 'rule.syncNote' : c.tagAction === 'color' ? 'rule.colorNote' : 'rule.clearNote')}</p>
    <div className="config-toolbar"><span className="auto-preview"><span className="connection-dot" />{t('preview.auto')}</span>
      <div className="config-actions"><Button variant="ghost" size="sm" disabled={disabled} onClick={refresh} title={t('action.preview')}><RefreshCw />{t('action.refresh')}</Button><Button variant="ghost" size="sm" disabled={disabled} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><SlidersHorizontal />{t(advanced ? 'rule.less' : 'rule.more')}{advanced ? <ChevronUp /> : <ChevronDown />}</Button></div></div>
    {advanced && <div className="advanced">{check('recursive','rule.recursive')}{c.recursive && field('depth','rule.depth',t('rule.unlimited'))}
      {mode === 'tags' && (c.tagAction === 'sync' ? check('includeClear','rule.includeClear') : <>{select('scope','rule.scope',[['targets','rule.scopeTargets'],['base','rule.scopeBase'],['both','rule.scopeBoth']])}{c.scope !== 'targets' && select('match','rule.baseMatch',[['any','rule.any'],['all','rule.every']])}</>)}
      {mode === 'list' && <>{field('includeExt','rule.includeExt',t('rule.allExtensions'),true)}{field('excludeExt','rule.excludeExt','nef,xmp',true)}</>}
    </div>}
  </section>;
}
