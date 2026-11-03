import { useMemo, useRef, useState } from 'react';
import { Search, FolderOpen, ChevronLeft, ChevronRight, File, AlertCircle, Maximize2, X, ArrowRight, Copy } from 'lucide-react';
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
    return <span className="tag" key={tag} title={name} role={dotOnly ? 'img' : undefined} aria-label={dotOnly ? name : undefined}><span className={`tag-dot color-${color?.[1] ?? 0}`} aria-hidden="true" />{!dotOnly && name}</span>;
  })}</span> : <span className="tag tag-empty" role="img" title={t('tags.none')} aria-label={t('tags.none')}><span className="tag-dot is-empty" aria-hidden="true" /></span>;
}

export function TagChanges({ before, after }: { before?: string[]; after?: string[] }) {
  return <span className="tag-changes"><Tags tags={before} compact />{after !== undefined && <><ArrowRight className="tag-change-arrow" aria-hidden="true" /><Tags tags={after} compact /></>}</span>;
}

function FileResultRow({ row, focused, checked, tagMode, onFocus, onToggle, reveal, copyPath, openImage }: {
  row: Row; focused: boolean; checked: boolean; tagMode: boolean;
  onFocus: () => void; onToggle: (checked: boolean) => void; reveal: (file: string) => void;
  copyPath: (file: string) => void;
  openImage: (file: string, opener: HTMLButtonElement) => void;
}) {
  const { t, text } = useI18n();
  const keyboard = usePopupKeyboard({ onOpenChange: open => { if (open) onFocus(); } });
  return <ContextMenu open={keyboard.open} onOpenChange={keyboard.setOpen}>
    <ContextMenuTrigger asChild><div className={`file-row ${focused ? 'is-focused' : ''}`}>
      <Checkbox aria-label={t('preview.selectFile', { name: row.relative })} checked={checked} disabled={!row.candidate} onCheckedChange={value => onToggle(value === true)} />
      <div className="file-entry">{isImageFile(row.name) ? <ImageThumbnail file={row.file} open={opener => { onFocus(); openImage(row.file, opener); }} /> : <span className="file-symbol"><File size={18} strokeWidth={1.5} /></span>}
        <button ref={keyboard.triggerRef} className="file-button" title={`${row.file}\n${text(row.reason)}`} onClick={onFocus}><span className="file-info"><span className="file-name">{row.name}</span><span className="file-meta">{row.relative.includes('/') ? row.relative.slice(0, row.relative.lastIndexOf('/')) : basename(row.root)} · {sizeText(row.size)}</span></span></button>
      </div>
      <div className="matching">{tagMode ? <TagChanges before={row.currentTags} after={row.action === 'tags' ? row.nextTags ?? [] : undefined} /> : row.matches.length ? row.matches.map(basename).slice(0, 2).join(', ') : text(row.reason)}</div>
      <span className={`status ${row.candidate ? checked ? row.action : 'skip' : 'keep'}`}>{t(row.candidate ? checked ? `status.${row.action}` : 'status.skip' : tagMode ? 'status.unchanged' : 'status.keep')}</span>
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

export function FileResults({ plan, selected, setSelected, reveal, copyPath }: {
  plan: Plan; selected: Set<string>; setSelected: (value: Set<string>) => void; reveal: (file: string) => void; copyPath: (file: string) => void;
}) {
  const { t, text } = useI18n();
  const [query, setQuery] = useState(''), [onlyChanges, setOnlyChanges] = useState(false), [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [image, setImage] = useState<{ file: string; opener: HTMLButtonElement } | null>(null);
  const dialogSearch = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(plan.rows.find(row => row.candidate)?.id ?? plan.rows[0]?.id);
  const rows = useMemo(() => plan.rows.filter(row => (!onlyChanges || row.candidate) && row.file.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [plan, onlyChanges, query]);
  const pages = Math.max(1, Math.ceil(rows.length / 100)), current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * 100, current * 100), eligible = visible.filter(row => row.candidate);
  const selectedVisible = eligible.filter(row => selected.has(row.id)).length;
  const tagMode = plan.mode === 'tags';
  function toggle(id: string, checked: boolean) { const next = new Set(selected); if (checked) next.add(id); else next.delete(id); setSelected(next); }
  function togglePage(checked: boolean) { const next = new Set(selected); for (const row of eligible) { if (checked) next.add(row.id); else next.delete(row.id); } setSelected(next); }
  const notices = <>
    {plan.conflicts.length > 0 && <Alert variant="destructive" className="notice"><AlertTitle>{t('preview.conflict')}</AlertTitle><AlertDescription>{plan.conflicts.map(conflict => <div key={conflict.key}><strong>{conflict.key}</strong>{conflict.tagSets.map((set, i) => <div key={i}>{set.files.join(', ')}: <Tags tags={set.tags} /></div>)}</div>)}</AlertDescription></Alert>}
    {plan.warnings.length > 0 && <Alert className="notice"><AlertDescription>{plan.warnings.map((warning, i) => <div key={i}>{text(warning)}</div>)}</AlertDescription></Alert>}
  </>;
  const renderResults = (inDialog: boolean) => <section className="results" data-preview-inline={inDialog ? undefined : ''} tabIndex={-1} aria-label={t('preview.title')}>
      <div className="results-toolbar">{!inDialog && <strong title={t('preview.swipeHint')}>{t('preview.title')}</strong>}<span className="text-muted-foreground text-xs">{t('preview.count', { total: plan.total, candidates: plan.candidates })}</span>
        {!inDialog && <DialogTrigger asChild><Button variant="outline" size="sm" className="preview-expand"><Maximize2 />{t('preview.expand')}</Button></DialogTrigger>}
        <div className="ms-auto"><Check label={t('preview.onlyChanges')} checked={onlyChanges} onChange={value => { setOnlyChanges(value); setPage(1); }} /></div><label className="search"><Search size={14} /><Input ref={inDialog ? dialogSearch : undefined} type="search" aria-label={t('preview.search')} placeholder={t('preview.search')} className="h-7 w-36 text-xs" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      </div>
      <div className="selection-bar"><Button variant="ghost" size="xs" onClick={() => setSelected(new Set(plan.rows.filter(row => row.candidate).map(row => row.id)))}>{t('preview.selectAll')}</Button><Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>{t('preview.selectNone')}</Button><span aria-live="polite">{t('preview.selected', { count: selected.size })}</span><div className="pager"><span>{t('preview.page', { count: rows.length, page: current, pages })}</span><Button variant="ghost" size="icon-xs" aria-label={t('preview.previous')} disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft /></Button><Button variant="ghost" size="icon-xs" aria-label={t('preview.next')} disabled={current === pages} onClick={() => setPage(current + 1)}><ChevronRight /></Button></div></div>
      <div className="file-scroll"><div className="file-row table-heading"><Checkbox aria-label={t('preview.selectPage')} disabled={!eligible.length} checked={selectedVisible && selectedVisible < eligible.length ? 'indeterminate' : !!eligible.length && selectedVisible === eligible.length} onCheckedChange={value => togglePage(value === true)} /><span>{t('preview.file')}</span><span>{t(tagMode ? 'preview.tagChanges' : 'preview.match')}</span><span>{t('preview.action')}</span></div>
        {visible.map(row => <FileResultRow key={row.id} row={row} focused={row.id === focused} checked={selected.has(row.id)} tagMode={tagMode} onFocus={() => setFocused(row.id)} onToggle={checked => toggle(row.id, checked)} reveal={reveal} copyPath={copyPath} openImage={(file, opener) => setImage({ file, opener })} />)}
        {!visible.length && <div className="empty"><strong>{t('preview.noResults')}</strong><p>{t('preview.noResultsHint')}</p></div>}
      </div>
    </section>;
  return <Dialog open={expanded} onOpenChange={setExpanded}>
    {notices}
    {renderResults(false)}
    <DialogContent className="preview-dialog" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); dialogSearch.current?.focus(); }}>
      <header className="preview-dialog-header"><div><DialogTitle>{t('preview.expandedTitle')}</DialogTitle><DialogDescription>{t('preview.expandedHint')}</DialogDescription></div><DialogClose asChild><Button variant="ghost" size="icon-sm" aria-label={t('action.close')}><X /></Button></DialogClose></header>
      {notices}
      {renderResults(true)}
      <footer className="preview-dialog-footer"><span aria-live="polite">{t('preview.selected', { count: selected.size })}</span><DialogClose asChild><Button variant="outline" size="sm">{t('preview.return')}</Button></DialogClose></footer>
    </DialogContent>
    <ImagePreviewDialog file={image?.file ?? null} opener={image?.opener} close={() => setImage(null)} reveal={reveal} />
  </Dialog>;
}
