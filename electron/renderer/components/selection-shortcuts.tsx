import { useId } from 'react';
import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/lib/i18n';
import { usePopupKeyboard } from '@/lib/popup-keyboard';

export function SelectionShortcuts() {
  const { t } = useI18n(), heading = useId();
  const keyboard = usePopupKeyboard({});
  const keys = [
    [t('selection.keys.click'), 'selection.keys.toggle'],
    [t('selection.keys.shiftClick'), 'selection.keys.range'],
    ['↑ / ↓', 'selection.keys.move'],
    ['⇧ ↑ / ↓', 'selection.keys.extend'],
    ['⌥ ↑ / ↓', 'selection.keys.ends'],
    ['⇧ ⌥ ↑ / ↓', 'selection.keys.extendEnds'],
    [t('selection.keys.addRange'), 'selection.keys.add'],
    ['⌘ A', 'selection.keys.all'],
    ['⇧ ⌘ A', 'preview.selectNone'],
  ];
  return <Popover open={keyboard.open} onOpenChange={keyboard.setOpen}><PopoverTrigger asChild><Button ref={keyboard.triggerRef} variant="ghost" size="icon-xs" aria-label={t('selection.shortcuts')} title={t('selection.shortcuts')}><Keyboard /></Button></PopoverTrigger>
    <PopoverContent className="selection-shortcuts" aria-labelledby={heading} onKeyDownCapture={keyboard.onKeyDownCapture} onCloseAutoFocus={keyboard.onCloseAutoFocus}>
      <strong id={heading}>{t('selection.shortcuts')}</strong>
      <dl>{keys.map(([key, description]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{t(description)}</dd></div>)}</dl>
    </PopoverContent>
  </Popover>;
}
