import { useId } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { enUS, ja, zhCN } from 'react-day-picker/locale';
import { tabbable } from 'tabbable';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/lib/i18n';
import { usePopupKeyboard } from '@/lib/popup-keyboard';

// Keep local calendar dates. UTC conversion can shift the user's chosen day.
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && dateValue(date) === value ? date : undefined;
}
function dateValue(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function DatePicker({ label, value, disabled, onChange }: {
  label: string; value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const popup = usePopupKeyboard({});
  const selected = parseDate(value);
  const today = new Date();
  const calendarLocale = locale.startsWith('zh') ? zhCN : locale.startsWith('ja') ? ja : enUS;
  const display = selected ? selected.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }) : t('date.any');
  const choose = (date?: Date) => {
    onChange(date ? dateValue(date) : '');
    popup.setOpen(false);
  };

  return <div className="filter-field">
    <label id={`${id}-label`} htmlFor={id}>{label}</label>
    <Popover open={popup.open} onOpenChange={popup.setOpen}>
      <PopoverTrigger asChild>
        <Button ref={popup.triggerRef} id={id} type="button" variant="outline" size="sm" className="date-picker-trigger"
          disabled={disabled} data-empty={!selected} aria-labelledby={`${id}-label`} aria-describedby={`${id}-value`} title={display}>
          <CalendarDays aria-hidden="true" /><span id={`${id}-value`}>{display}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="date-picker-popover" aria-labelledby={`${id}-label`}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={popup.onCloseAutoFocus}
        onKeyDown={event => {
          // Tab through the calendar, then continue beside the trigger instead of
          // getting stranded at the portal's position at the end of the document.
          if (event.key !== 'Tab' || !event.currentTarget.contains(event.target as Node)) return;
          const items = tabbable(event.currentTarget);
          if (document.activeElement === (event.shiftKey ? items[0] : items.at(-1))) popup.onKeyDownCapture(event);
        }}>
        <Calendar mode="single" selected={selected} onSelect={choose} defaultMonth={selected} locale={calendarLocale}
          captionLayout="dropdown" fixedWeeks autoFocus
          startMonth={new Date(Math.min(1900, selected?.getFullYear() ?? 1900), 0)}
          endMonth={new Date(Math.max(today.getFullYear() + 100, selected?.getFullYear() ?? 0), 11)} />
        <div className="date-picker-footer">
          <Button type="button" variant="ghost" size="sm" onClick={() => choose(today)}>{t('date.today')}</Button>
          <Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => choose()}><X />{t('date.clear')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
