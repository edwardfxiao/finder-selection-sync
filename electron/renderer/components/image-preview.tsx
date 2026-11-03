import { useEffect, useRef, useState } from 'react';
import { FileImage, FolderOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { basename } from '@/lib/config';
import type { ImagePreview } from '@/types';

export function ImageThumbnail({ file, open }: { file: string; open: (button: HTMLButtonElement) => void }) {
  const { t } = useI18n();
  const button = useRef<HTMLButtonElement>(null);
  const [image, setImage] = useState<string | null>(null), [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true, requested = false;
    setImage(null); setLoading(true);
    let observer: IntersectionObserver | undefined;
    const load = () => {
      if (requested) return;
      requested = true; observer?.disconnect();
      if (!window.finder?.image) { setLoading(false); return; }
      window.finder.image(file, 'thumbnail').then(value => { if (alive) setImage(value.dataURL); })
        .catch(() => { /* Unsupported images keep their file icon. */ })
        .finally(() => { if (alive) setLoading(false); });
    };
    if (typeof IntersectionObserver === 'undefined') load();
    else if (button.current) {
      observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load(); }, {
        root: button.current.closest('.file-scroll'), rootMargin: '160px',
      });
      observer.observe(button.current);
    }
    return () => { alive = false; observer?.disconnect(); };
  }, [file]);
  return <button ref={button} type="button" className="image-thumbnail" aria-label={t('image.open', { name: basename(file) })} title={t('image.open', { name: basename(file) })} onClick={event => open(event.currentTarget)}>
    {image ? <img src={image} alt="" decoding="async" draggable={false} onError={() => setImage(null)} /> : loading ? <Skeleton className="size-full" /> : <FileImage size={18} strokeWidth={1.5} />}
  </button>;
}

export function ImagePreviewDialog({ file, opener, close, reveal }: {
  file: string | null; opener?: HTMLButtonElement; close: () => void; reveal: (file: string) => void;
}) {
  const { t } = useI18n();
  const lastFile = useRef(''), lastOpener = useRef<HTMLButtonElement | undefined>(undefined), closeButton = useRef<HTMLButtonElement>(null);
  if (file) lastFile.current = file;
  if (opener) lastOpener.current = opener;
  const current = file ?? lastFile.current;
  const [result, setResult] = useState<{ file: string; image: ImagePreview | null; failed: boolean }>({ file: '', image: null, failed: false });
  useEffect(() => {
    if (!file) return;
    let alive = true;
    setResult({ file, image: null, failed: false });
    if (!window.finder?.image) { setResult({ file, image: null, failed: true }); return; }
    window.finder.image(file, 'preview').then(image => { if (alive) setResult({ file, image, failed: false }); })
      .catch(() => { if (alive) setResult({ file, image: null, failed: true }); });
    return () => { alive = false; };
  }, [file]);
  const image = result.file === current ? result.image : null, failed = result.file === current && result.failed;
  return <Dialog open={!!file} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="preview-dialog image-dialog" showCloseButton={false}
      onOpenAutoFocus={event => { event.preventDefault(); closeButton.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); queueMicrotask(() => { if (lastOpener.current?.isConnected) lastOpener.current.focus({ preventScroll: true }); }); }}>
      <header className="preview-dialog-header"><div><DialogTitle>{basename(current)}</DialogTitle><DialogDescription>{t('image.title')}</DialogDescription></div><DialogClose asChild><Button ref={closeButton} variant="ghost" size="icon-sm" aria-label={t('action.close')}><X /></Button></DialogClose></header>
      <div className="image-viewer-stage" aria-busy={!image && !failed}>
        {image ? <img src={image.dataURL} alt={basename(current)} draggable={false} onError={() => setResult({ file: current, image: null, failed: true })} />
          : failed ? <div className="empty"><FileImage /><strong>{t('image.unavailable')}</strong><p>{t('image.finderHint')}</p></div>
            : <><span className="sr-only" role="status">{t('image.loading')}</span><Skeleton className="image-viewer-placeholder" /></>}
      </div>
      <footer className="preview-dialog-footer"><span className="image-viewer-path" title={current}>{current}</span><Button variant="outline" size="sm" onClick={() => reveal(current)}><FolderOpen />{t('action.reveal')}</Button></footer>
    </DialogContent>
  </Dialog>;
}
