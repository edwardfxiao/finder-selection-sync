import { useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Check, Choice, TagPicker } from './workflow-config';
import { ErrorNotice, TagChanges } from './file-results';
import { useI18n } from '@/lib/i18n';
import { finderColorCodes } from '@/lib/config';
import type { Issue, ProgressInfo, Row, SelectionTags } from '@/types';

export function SelectedTagsDialog({ rows, initialColors, initialMerge, busy, progress, stopping = false, stop, loading = false, loadError = null, close, apply }: {
  rows: Row[]; initialColors: string[]; initialMerge: boolean; busy: boolean;
  progress?: ProgressInfo; stopping?: boolean; stop?: () => void;
  loading?: boolean; loadError?: Issue | null;
  close: () => void; apply: (options: SelectionTags) => Promise<void>;
}) {
  const { t, text } = useI18n();
  const [colors, setColors] = useState(initialColors), [mergeTags, setMergeTags] = useState(initialMerge);
  const [clearTags, setClearTags] = useState(false);
  const [error, setError] = useState<Issue | null>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const body = useRef<HTMLDivElement>(null);
  const restoreActionFocus = useRef(false);
  const canStop = busy && progress?.phase !== 'confirm' && !!stop;
  useLayoutEffect(() => {
    if (!clearTags || !restoreActionFocus.current) return;
    restoreActionFocus.current = false;
    const frame = requestAnimationFrame(() => body.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [clearTags]);
  const desired = colors.map(color => `${color[0].toUpperCase()}${color.slice(1)}\n${finderColorCodes[color]}`);
  const signature = (tags: string[]) => JSON.stringify([...new Set(tags.map(tag => tag.normalize('NFC')))].sort());
  async function submit() {
    setError(null);
    try { await apply({ colors, mergeTags, clearTags }); }
    catch (value) {
      const error = value as Issue;
      setError(error.key ? error : { key: 'error.generic', params: { detail: String(value) } });
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className="selected-tags-dialog" showCloseButton={false} onEscapeKeyDown={event => {
      if (busy) { event.preventDefault(); if (canStop && !stopping) stop?.(); }
    }} onInteractOutside={event => { if (busy) event.preventDefault(); }}
      onOpenAutoFocus={event => {
        event.preventDefault();
        body.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true });
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        queueMicrotask(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); });
      }}>
      <header className="selected-tags-header">
        <DialogTitle>{t(clearTags ? 'selection.clearTagsTitle' : 'selection.tagTitle', { count: rows.length })}</DialogTitle>
        <DialogDescription>{t('selection.tagHint')}</DialogDescription>
        <DialogClose asChild><Button className="selected-tags-close" variant="ghost" size="icon-sm" disabled={busy} aria-label={t('action.close')}><X /></Button></DialogClose>
      </header>
      <div ref={body} className="selected-tags-body">
      <Choice label={t('rule.operation')} value={clearTags ? 'clear' : 'set'} disabled={busy} choices={[["set",t('rule.color')],["clear",t('selection.clearFileTags')]]} onChange={value => setClearTags(value === 'clear')} />
      {!clearTags && <><TagPicker values={colors} disabled={busy} onChange={setColors} onClearFileTags={() => { restoreActionFocus.current = true; setClearTags(true); }} /><Check label={t('filter.keepTags')} checked={mergeTags} disabled={busy} onChange={setMergeTags} /></>}
      {loading && <p className="selected-tags-loading" role="status"><LoaderCircle className="animate-spin" size={15} />{t('progress.readTags')}</p>}
      <div className="selected-tags-heading"><span>{t('preview.file')}</span><span>{t('preview.tagChanges')}</span></div>
      <ul className="selected-tags-files">{rows.map(row => {
        const before = row.currentTags ?? [];
        const after = clearTags ? [] : !desired.length ? before : mergeTags ? [...new Set([...before, ...desired])] : desired;
        const changed = signature(before) !== signature(after);
        return <li key={row.id} title={row.file}><span>{row.relative}</span>{!loading && !loadError && <TagChanges before={before} after={changed ? after : undefined} />}</li>;
      })}</ul>
      <p className="rule-note">{t(clearTags ? 'selection.clearTagsHint' : !colors.length ? 'selection.noColorsHint' : mergeTags ? 'filter.mergeTagsHint' : 'filter.replaceTagsHint')}</p>
      </div>
      {busy && progress && <div className="selected-tags-progress mx-6 mb-4 grid shrink-0 gap-2 rounded-lg border p-3" role="status">
        <p className="flex min-w-0 items-center gap-2 text-xs"><LoaderCircle className="animate-spin shrink-0" size={15} /><span className="min-w-0 truncate" title={text(progress.detail)}>{text(progress.detail)}</span></p>
        <Progress value={progress.total ? (progress.completed / progress.total) * 100 : undefined} className={`h-1 ${progress.total ? '' : 'indeterminate'}`} />
        {progress.total > 0 && <small className="text-muted-foreground">{progress.completed} / {progress.total}</small>}
      </div>}
      {(loadError || error) && <div className="selected-tags-feedback"><ErrorNotice error={loadError || error} /></div>}
      <div className="selected-tags-actions">{busy ? <Button variant="outline" disabled={!canStop || stopping} onClick={stop}>{t(stopping ? 'action.stopping' : 'action.stop')}</Button>
        : <Button variant="outline" onClick={close}>{t('selection.cancel')}</Button>}<Button disabled={busy || loading || !!loadError || !clearTags && !colors.length} onClick={submit}>{t(busy ? 'preview.working' : clearTags ? 'selection.clearFileTags' : 'rule.color')}</Button></div>
    </DialogContent>
  </Dialog>;
}
