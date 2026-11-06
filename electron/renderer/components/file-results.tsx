import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Search, FolderOpen, ChevronLeft, ChevronRight, File, AlertCircle, Maximize2, X, ArrowRight, Copy, Tags as TagsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { Check } from './workflow-config';
import { ImageThumbnail, ImagePreviewDialog } from './image-preview';
import { useI18n } from '@/lib/i18n';
import { basename, sizeText } from '@/lib/config';
import { usePopupKeyboard } from '@/lib/popup-keyboard';
import { isRowSelectable } from '@/lib/selection';
import { useFileSelection } from '@/lib/use-file-selection';
import { SelectionShortcuts } from './selection-shortcuts';
import { isImageFile } from '../../image-formats.js';
import type { Plan, Issue, Row } from '@/types';

export function ErrorNotice({ error }: { error: Issue | null }) {
  const { t, text } = useI18n();
  if (!error) return null;
  const raw = error.raw ?? error.message;
  return <Alert variant="destructive" className="notice"><AlertCircle size={16} /><AlertDescription>{error.key ? text(error) : raw}{raw && raw !== error.key && raw !== text(error) && <details><summary>{t('error.details')}</summary><pre>{raw}</pre></details>}</AlertDescription></Alert>;
}
export function Tags({ tags = [], compact = false }: { tags?: string[]; compact?: boolean }) {
  const { t } = useI18n();
  return tags.length ? <span className="tags">{tags.map(tag => {
    const color = tag.match(/\n([0-7])$/);
    const name = color ? tag.slice(0, -2) : tag;
    const dotOnly = compact && !!color && color[1] !== '0';
    return <span className="tag" key={tag} title={name} role={dotOnly ? 'img' : undefined} aria-label={dotOnly ? name : undefined}><span className={`tag-dot color-${color?.[1] ?? 0}`} aria-hidden="true" />{!dotOnly && <span className="tag-name">{name}</span>}</span>;
  })}</span> : <span className="tag tag-empty" role="img" title={t('tags.none')} aria-label={t('tags.none')}><span className="tag-dot is-empty" aria-hidden="true" /></span>;
}

export function TagChanges({ before, after }: { before?: string[]; after?: string[] }) {
  return <span className="tag-changes"><Tags tags={before} compact />{after !== undefined && <><ArrowRight className="tag-change-arrow" aria-hidden="true" /><Tags tags={after} compact /></>}</span>;
}

function FileResultRow({ row, focused, checked, selectable, ready, tagMode, filterMode, reviewMode, requiresTags, onFocus, onSelect, reveal, copyPath, openImage }: {
  row: Row; focused: boolean; checked: boolean; tagMode: boolean; filterMode: boolean;
  selectable: boolean; ready: boolean;
  reviewMode: boolean;
  requiresTags?: boolean;
  onFocus: () => void; onSelect: (event: MouseEvent<HTMLElement>) => void; reveal: (file: string) => void;
  copyPath: (file: string) => void;
  openImage: (file: string, opener: HTMLButtonElement) => void;
}) {
  const { t, text, locale } = useI18n();
  const keyboard = usePopupKeyboard({ onOpenChange: open => { if (open) onFocus(); } });
  return <ContextMenu open={keyboard.open} onOpenChange={keyboard.setOpen}>
    <ContextMenuTrigger asChild><div data-file-row={row.id} data-selectable={selectable} className={`file-row ${focused ? 'is-focused' : ''} ${checked ? 'is-selected' : ''}`} onFocus={onFocus}
      onMouseDown={event => { if (event.shiftKey && event.button === 0) event.preventDefault(); }}
      onClick={event => {
        // Portalled menus and thumbnail buttons retain their own actions.
        const target = event.target as HTMLElement;
        if (!event.currentTarget.contains(target) || event.ctrlKey || event.button !== 0 || target.closest('.image-thumbnail, a, input, textarea')) return;
        onSelect(event);
        if (!target.closest('button') || event.shiftKey) keyboard.triggerRef.current?.focus({ preventScroll: true });
      }}>
      <Checkbox title={selectable ? undefined : text(row.reason)} aria-label={t('preview.selectFile', { name: row.side ? `${t(row.side === 'a' ? 'compare.folderA' : 'compare.folderB')} / ${row.relative}` : row.relative })} checked={checked} disabled={!selectable} />
      <div className="file-entry">{isImageFile(row.name) ? <ImageThumbnail file={row.file} enabled={ready} open={opener => { onFocus(); openImage(row.file, opener); }} /> : <span className="file-symbol"><File size={18} strokeWidth={1.5} /></span>}
        <button ref={keyboard.triggerRef} className="file-button" aria-pressed={checked} aria-disabled={!selectable} title={`${row.file}\n${text(row.reason)}`}><span className="file-info"><span className="file-name-line"><span className="file-name">{row.name}</span>{!tagMode && row.currentTags !== undefined && <Tags tags={row.currentTags} compact />}</span><span className="file-meta">{row.side && `${t(row.side === 'a' ? 'compare.folderA' : 'compare.folderB')} · `}{row.relative.includes('/') ? row.relative.slice(0, row.relative.lastIndexOf('/')) : basename(row.root)} · {sizeText(row.size)}</span></span></button>
      </div>
      <div className="matching">{tagMode ? <TagChanges before={row.currentTags} after={checked && row.candidate && row.action === 'tags' ? row.nextTags ?? [] : undefined} /> : row.matches.length ? row.matches.map(basename).slice(0, 2).join(', ') : text(row.reason)}
        {row.side && (tagMode || row.matches.length > 0) && <span className="file-meta">{text(row.reason)}</span>}
        {filterMode && row.modifiedMs !== undefined && <span className="file-meta">{t('filter.modified', { date: new Date(row.modifiedMs).toLocaleString(locale) })}</span>}</div>
      <span className={`status ${row.candidate ? checked ? row.action : 'skip' : 'keep'}`}>{t(reviewMode ? row.matched ? checked ? 'compare.selected' : 'filter.notSelected' : 'filter.notMatched' : row.candidate ? checked ? requiresTags ? 'rule.chooseTags' : `status.${row.action}` : filterMode ? 'filter.notSelected' : 'status.skip' : filterMode && !row.matched ? 'filter.notMatched' : tagMode ? 'status.unchanged' : 'status.keep')}</span>
    </div></ContextMenuTrigger>
    <ContextMenuContent aria-label={row.name} onKeyDownCapture={keyboard.onKeyDownCapture} onCloseAutoFocus={event => {
      keyboard.onCloseAutoFocus(event);
      if (!event.defaultPrevented) { event.preventDefault(); keyboard.triggerRef.current?.focus({ preventScroll: true }); }
    }}>
      <ContextMenuItem onSelect={() => reveal(row.file)}><FolderOpen />{t('action.reveal')}</ContextMenuItem>
      <ContextMenuItem onSelect={() => copyPath(row.file)}><Copy />{t('action.copyPath')}</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}

export type FileResultsViewState = { query: string; onlyChanges: boolean; page: number; expanded: boolean };

export function FileResults({ plan, ready = true, selected, setSelected, reveal, copyPath, tagSelected, viewState, onViewStateChange }: {
  plan: Plan; selected: Set<string>; setSelected: (value: Set<string>) => void; reveal: (file: string) => void; copyPath: (file: string) => void;
  ready?: boolean;
  tagSelected?: () => void;
  viewState?: FileResultsViewState;
  onViewStateChange?: (value: FileResultsViewState) => void;
}) {
  const { t, text } = useI18n();
  const filterMode = plan.mode === 'filter' || plan.mode === 'compare' || plan.mode === 'list' && plan.action === 'tags';
  const selectable = (row: Row) => isRowSelectable(plan, row);
  const [localViewState, setLocalViewState] = useState<FileResultsViewState>({ query: '', onlyChanges: filterMode, page: 1, expanded: false });
  const view = viewState ?? localViewState;
  const { query, onlyChanges, page, expanded } = view;
  function updateView(patch: Partial<FileResultsViewState>) {
    const next = { ...view, ...patch };
    setLocalViewState(next);
    onViewStateChange?.(next);
  }
  const [image, setImage] = useState<{ file: string; opener: HTMLButtonElement } | null>(null);
  const dialogSearch = useRef<HTMLInputElement>(null);
  const dialogClose = useRef<HTMLButtonElement>(null), awaitingActivationFocus = useRef(false);
  const inlineResults = useRef<HTMLElement>(null), dialogResults = useRef<HTMLElement>(null);
  const [focused, setFocused] = useState(plan.rows.find(row => row.candidate)?.id ?? plan.rows[0]?.id);
  const rows = useMemo(() => plan.rows.filter(row => (!onlyChanges || (filterMode ? row.matched ?? row.candidate : row.candidate)) && row.file.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [plan, onlyChanges, query, filterMode]);
  const selection = useFileSelection(rows, selected, setSelected, selectable);
  const pendingFocus = useRef<{ id: string; inDialog: boolean } | null>(null);
  const pages = Math.max(1, Math.ceil(rows.length / 100)), current = Math.min(page, pages);
  const previousPage = useRef(current);
  useLayoutEffect(() => {
    if (!ready || !expanded || !awaitingActivationFocus.current) return;
    awaitingActivationFocus.current = false;
    if (document.activeElement === dialogClose.current) dialogSearch.current?.focus({ preventScroll: true });
  }, [ready, expanded]);
  useLayoutEffect(() => {
    if (current === previousPage.current) return;
    previousPage.current = current;
    const preview = inlineResults.current, workspace = preview?.closest<HTMLElement>('.workspace-scroll');
    if (preview && workspace) {
      const headingHeight = workspace.querySelector('.workflow-heading')?.getBoundingClientRect().height ?? 0;
      workspace.scrollTop += preview.getBoundingClientRect().top - workspace.getBoundingClientRect().top - headingHeight;
    }
    const dialogList = dialogResults.current?.querySelector<HTMLElement>('.file-scroll');
    if (dialogList) dialogList.scrollTop = 0;
  }, [current]);
  useLayoutEffect(() => {
    const next = pendingFocus.current;
    if (!next) return;
    const region = next.inDialog ? dialogResults.current : inlineResults.current;
    const row = [...region?.querySelectorAll<HTMLElement>('[data-file-row]') ?? []].find(element => element.dataset.fileRow === next.id);
    if (!row) return;
    pendingFocus.current = null;
    row.querySelector<HTMLButtonElement>('.file-button')?.focus({ preventScroll: true });
    const scroll = next.inDialog ? region?.querySelector<HTMLElement>('.file-scroll') : region?.closest<HTMLElement>('.workspace-scroll');
    if (!scroll) return;
    const bounds = scroll.getBoundingClientRect(), item = row.getBoundingClientRect();
    const top = next.inDialog ? bounds.top : Math.max(bounds.top, region?.querySelector('.results-controls')?.getBoundingClientRect().bottom ?? bounds.top);
    if (item.top < top) scroll.scrollTop -= top - item.top;
    else if (item.bottom > bounds.bottom) scroll.scrollTop += item.bottom - bounds.bottom;
  }, [current, focused, rows, selected]);
  function onSelectionKey(event: KeyboardEvent<HTMLElement>, inDialog: boolean) {
    const target = event.target as HTMLElement;
    if (!ready || event.defaultPrevented || !event.currentTarget.contains(target) || target.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="menu"]')) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation();
      if (event.shiftKey) selection.clear(); else selection.all();
      return;
    }
    const source = target.closest<HTMLElement>('[data-file-row]');
    if (!source && target !== event.currentTarget) return;
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || event.ctrlKey || event.metaKey && !event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    const next = selection.move(source?.dataset.fileRow ?? focused, event.key as 'ArrowUp' | 'ArrowDown' | 'Home' | 'End', event);
    if (!next) return;
    pendingFocus.current = { id: next, inDialog };
    setFocused(next);
    const nextPage = Math.floor(rows.findIndex(row => row.id === next) / 100) + 1;
    if (nextPage !== current) updateView({ page: nextPage });
  }
  const visible = rows.slice((current - 1) * 100, current * 100), eligible = visible.filter(selectable);
  const selectedVisible = eligible.filter(row => selected.has(row.id)).length;
  const resultIds = new Set(rows.map(row => row.id));
  const hiddenSelected = plan.rows.filter(row => selected.has(row.id) && !resultIds.has(row.id)).length;
  const tagMode = plan.mode === 'tags' || plan.action === 'tags';
  function togglePage(checked: boolean) { const next = new Set(selected); for (const row of eligible) { if (checked) next.add(row.id); else next.delete(row.id); } selection.replace(next); }
  function selectAllResults() {
    const next = new Set(selected);
    for (const row of rows) if (filterMode ? selectable(row) : row.candidate) next.add(row.id);
    selection.replace(next);
  }
  function invertSelection() {
    const next = new Set(selected);
    for (const row of rows.filter(selectable)) { if (next.has(row.id)) next.delete(row.id); else next.add(row.id); }
    selection.replace(next);
  }
  const notices = <>
    {plan.conflicts.length > 0 && <Alert variant="destructive" className="notice"><AlertTitle>{t('preview.conflict')}</AlertTitle><AlertDescription>{plan.conflicts.map(conflict => <div key={conflict.key}><strong>{conflict.key}</strong>{conflict.tagSets.map((set, i) => <div key={i}>{set.files.join(', ')}: <Tags tags={set.tags} /></div>)}</div>)}</AlertDescription></Alert>}
    {plan.warnings.length > 0 && <Alert className="notice"><AlertDescription>{plan.warnings.map((warning, i) => <div key={i}>{text(warning)}</div>)}</AlertDescription></Alert>}
  </>;
  const renderResults = (inDialog: boolean) => <section ref={inDialog ? dialogResults : inlineResults} className="results" data-preview-inline={inDialog ? undefined : ''} inert={!ready ? true : undefined} aria-busy={!ready} tabIndex={-1} aria-label={t('preview.title')} onKeyDown={event => onSelectionKey(event, inDialog)}>
      <div className="results-controls"><div className="results-toolbar">{!inDialog && <strong title={t('preview.swipeHint')}>{t('preview.title')}</strong>}<span className="text-muted-foreground text-xs">{t(filterMode ? 'filter.count' : 'preview.count', { total: plan.total, candidates: filterMode ? plan.matched ?? plan.candidates : plan.candidates })}</span>
        {!inDialog && <DialogTrigger asChild><Button variant="outline" size="sm" className="preview-expand"><Maximize2 />{t('preview.expand')}</Button></DialogTrigger>}
        <div className="ms-auto"><Check label={t(filterMode ? 'filter.onlyMatches' : 'preview.onlyChanges')} checked={onlyChanges} onChange={value => updateView({ onlyChanges: value, page: 1 })} /></div><label className="search"><Search size={14} /><Input ref={inDialog ? dialogSearch : undefined} type="search" aria-label={t('preview.search')} placeholder={t('preview.search')} className="h-7 w-36 text-xs" value={query} onChange={event => updateView({ query: event.target.value, page: 1 })} /></label>
      </div>
      <div className="selection-bar"><Button variant="ghost" size="xs" onClick={selectAllResults}>{t(filterMode ? 'filter.selectAll' : 'preview.selectAll')}</Button><Button variant="ghost" size="xs" onClick={selection.clear}>{t('preview.selectNone')}</Button>{filterMode && <Button variant="ghost" size="xs" title={t('filter.invertSelectionHint')} onClick={invertSelection}>{t('filter.invertSelection')}</Button>}<span aria-live="polite">{t('preview.selected', { count: selected.size })}</span>{hiddenSelected > 0 && <span className="selection-hidden" aria-live="polite">{t('preview.hiddenSelected', { count: hiddenSelected })}</span>}{tagSelected && <Button data-selection-tags variant="outline" size="xs" disabled={!selected.size} onClick={tagSelected}><TagsIcon />{t('rule.color')}</Button>}<SelectionShortcuts /><div className="pager"><span>{t('preview.page', { count: rows.length, page: current, pages })}</span><Button variant="ghost" size="icon-xs" aria-label={t('preview.previous')} disabled={current === 1} onClick={() => updateView({ page: current - 1 })}><ChevronLeft /></Button><Button variant="ghost" size="icon-xs" aria-label={t('preview.next')} disabled={current === pages} onClick={() => updateView({ page: current + 1 })}><ChevronRight /></Button></div></div>
      <div className="results-heading"><div className="file-row table-heading"><Checkbox aria-label={t(filterMode ? 'filter.selectPage' : 'preview.selectPage')} disabled={!eligible.length} checked={selectedVisible && selectedVisible < eligible.length ? 'indeterminate' : !!eligible.length && selectedVisible === eligible.length} onCheckedChange={value => togglePage(value === true)} /><span>{t('preview.file')}</span><span>{t(tagMode ? 'preview.tagChanges' : 'preview.match')}</span><span>{t('preview.action')}</span></div></div></div>
      <div className="file-scroll">
        {visible.map(row => <FileResultRow key={row.id} row={row} focused={row.id === focused} checked={selected.has(row.id)} selectable={selectable(row)} ready={ready} tagMode={tagMode} filterMode={filterMode} reviewMode={plan.action === 'review'} requiresTags={plan.requiresTags} onFocus={() => setFocused(row.id)} onSelect={event => { if (!ready) return; selection.click(row.id, event, focused); setFocused(row.id); }} reveal={reveal} copyPath={copyPath} openImage={(file, opener) => setImage({ file, opener })} />)}
        {!visible.length && <div className="empty"><strong>{t('preview.noResults')}</strong><p>{t(filterMode ? 'filter.noResultsHint' : 'preview.noResultsHint')}</p></div>}
      </div>
    </section>;
  return <Dialog open={expanded} onOpenChange={value => updateView({ expanded: value })}>
    {notices}
    {renderResults(false)}
    <DialogContent className="preview-dialog" showCloseButton={false} onOpenAutoFocus={event => {
      event.preventDefault(); awaitingActivationFocus.current = !ready;
      (ready ? dialogSearch.current : dialogClose.current)?.focus({ preventScroll: true });
    }}>
      <header className="preview-dialog-header"><div><DialogTitle>{t('preview.expandedTitle')}</DialogTitle><DialogDescription>{t('preview.expandedHint')}</DialogDescription></div><DialogClose asChild><Button ref={dialogClose} variant="ghost" size="icon-sm" aria-label={t('action.close')}><X /></Button></DialogClose></header>
      {notices}
      {renderResults(true)}
      <footer className="preview-dialog-footer"><span aria-live="polite">{t('preview.selected', { count: selected.size })}</span><DialogClose asChild><Button variant="outline" size="sm">{t('preview.return')}</Button></DialogClose></footer>
    </DialogContent>
    <ImagePreviewDialog file={image?.file ?? null} opener={image?.opener} close={() => setImage(null)} reveal={reveal} />
  </Dialog>;
}
