import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useI18n } from '@/lib/i18n';
import { TagChanges, ErrorNotice } from './file-results';
import type { Run } from '@/types';

export function Activity({ run, exportRun, refresh, back }: { run: Run; exportRun: () => void; refresh?: () => void; back?: () => void }) {
  const { t, text, locale } = useI18n();
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(run.records.length / 100)), current = Math.min(page, pages);
  const date = new Date(run.finishedAt).toLocaleString(locale);
  return <><header className="heading"><div><h1>{t(run.error ? 'run.stopped' : run.cancelled ? 'run.cancelled' : 'run.complete')}</h1><p>{t(`task.${run.mode}`)} · {date}</p></div><Button variant="outline" size="sm" onClick={exportRun}><Download />{t('action.export')}</Button></header>
    <div className="run-summary">{[['completed',run.completed],['failed',run.failed],['pending',run.unattempted]].map(([key,count]) => <div key={key}><strong>{count}</strong><span>{t(`status.${key}`)}</span></div>)}</div>
    <ErrorNotice error={run.error} />{run.error && run.action === 'tags' && <Alert className="notice"><AlertDescription>{t('run.partialTags')}</AlertDescription></Alert>}
    <section className="results"><div className="results-toolbar"><strong>{t('run.details')}</strong><span className="text-muted-foreground text-xs">{t(run.action === 'trash' ? 'run.recover' : 'run.tagsSaved')}</span></div>
      <div className="selection-bar"><span>{t('preview.page', { count: run.records.length, page: current, pages })}</span><div className="pager"><Button variant="ghost" size="icon-xs" aria-label={t('preview.previous')} disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft /></Button><Button variant="ghost" size="icon-xs" aria-label={t('preview.next')} disabled={current === pages} onClick={() => setPage(current + 1)}><ChevronRight /></Button></div></div>
      <div className="file-scroll">{run.records.slice((current - 1) * 100, current * 100).map(record => <div className="file-row run-row" key={record.file}><div><span className="file-name">{record.name}</span><span className="file-meta">{record.file}</span></div><div className="matching">{record.error ? text(record.error) : record.action === 'tags' ? <TagChanges before={record.beforeTags} after={record.afterTags ?? []} /> : t(record.status === 'completed' ? 'run.trashDone' : 'run.notAttempted')}</div><span className={`status ${record.status}`}>{t(`status.${record.status}`)}</span></div>)}</div>
    </section><footer className="footer"><span className="text-muted-foreground text-xs">{t(run.cancelled ? 'run.cancelNote' : 'run.exportHint')}</span>{back ? <Button variant="outline" onClick={back}>{t('action.back')}</Button> : <Button onClick={refresh}>{t('action.retry')}</Button>}</footer></>;
}
