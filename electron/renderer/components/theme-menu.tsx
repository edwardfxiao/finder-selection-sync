import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n';
import type { Theme } from '@/types';

const icons = { light: Sun, dark: Moon, system: Monitor };

export function ThemeMenu({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const { t } = useI18n();
  const Icon = icons[theme];
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button className="language-button" variant="ghost" size="sm" aria-label={t('theme.title')} title={t('theme.title')}>
      <Icon size={15} /><span>{t(`theme.${theme}`)}</span>
    </Button>
  </DropdownMenuTrigger><DropdownMenuContent align="end">
    <DropdownMenuLabel>{t('theme.title')}</DropdownMenuLabel>
    <DropdownMenuRadioGroup value={theme} onValueChange={value => onChange(value as Theme)}>
      {(Object.keys(icons) as Theme[]).map(value => { const ItemIcon = icons[value]; return <DropdownMenuRadioItem key={value} value={value}><ItemIcon />{t(`theme.${value}`)}</DropdownMenuRadioItem>; })}
    </DropdownMenuRadioGroup>
  </DropdownMenuContent></DropdownMenu>;
}
