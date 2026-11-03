import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/lib/i18n';
import type { Mode } from '@/types';

export function PreviewSkeleton({ mode, stopping, stop }: { mode: Mode; stopping: boolean; stop: () => void }) {
  const { t } = useI18n();
  return <section className="results preview-skeleton" data-preview-inline="" tabIndex={-1} aria-label={t('preview.title')} aria-busy="true">
    <span className="sr-only" role="status">{t('preview.scanning')}</span>
    <div className="results-toolbar"><strong>{t('preview.title')}</strong><Skeleton className="h-3 w-28" aria-hidden="true" /><Skeleton className="h-7 w-20" aria-hidden="true" />
      <Button className="ms-auto" variant="ghost" size="sm" disabled={stopping} onClick={stop}>{t(stopping ? 'action.stopping' : 'action.stop')}</Button>
    </div>
    <div className="selection-bar" aria-hidden="true"><Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-16" /><Skeleton className="h-3 w-16" /><Skeleton className="ms-auto h-3 w-24" /></div>
    <div className="file-scroll preview-skeleton-list" aria-hidden="true">
      <div className="file-row table-heading"><Skeleton className="size-4" /><span>{t('preview.file')}</span><span>{t(mode === 'tags' ? 'preview.tagChanges' : 'preview.match')}</span><span>{t('preview.action')}</span></div>
      {Array.from({ length: 12 }, (_, i) => <div className="file-row" key={i}>
        <Skeleton className="size-4" />
        <div className="preview-skeleton-file"><Skeleton className="h-8 w-10 shrink-0" /><div className="min-w-0 flex-1"><Skeleton className={`h-3 ${i % 2 ? 'w-1/2' : 'w-2/3'}`} /><Skeleton className="mt-2 h-2.5 w-1/3" /></div></div>
        <Skeleton className={`h-3 ${mode === 'tags' ? 'w-16' : 'w-2/3'}`} /><Skeleton className="h-5 w-16" />
      </div>)}
    </div>
  </section>;
}
