import { useRef } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';

export function ResetAllDialog({ open, onOpenChange, disabled, reset }: {
  open: boolean; onOpenChange: (open: boolean) => void; disabled: boolean; reset: () => void;
}) {
  const { t } = useI18n();
  const cancel = useRef<HTMLButtonElement>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogTrigger asChild><Button className="nav-button app-reset" variant="ghost" disabled={disabled} title={t('action.resetAllHint')}>
      <RotateCcw strokeWidth={1.65} /><span>{t('action.resetAll')}</span>
    </Button></DialogTrigger>
    <DialogContent className="reset-all-dialog" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}>
      <DialogTitle>{t('reset.title')}</DialogTitle>
      <DialogDescription>{t('reset.description')}</DialogDescription>
      <p className="reset-kept">{t('reset.kept')}</p>
      <DialogClose asChild><Button className="reset-close" variant="ghost" size="icon-sm" aria-label={t('action.close')}><X /></Button></DialogClose>
      <div className="reset-actions">
        <DialogClose asChild><Button ref={cancel} variant="outline">{t('selection.cancel')}</Button></DialogClose>
        <Button disabled={disabled} onClick={() => { reset(); onOpenChange(false); }}>{t('action.resetAll')}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
