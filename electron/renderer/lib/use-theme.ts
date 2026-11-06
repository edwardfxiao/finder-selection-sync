import { useLayoutEffect, useState } from 'react';
import type { Theme } from '@/types';

const preferenceKey = 'finder-appearance';
function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(preferenceKey);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* Optional preferences. */ }
  return 'system';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark' || theme === 'system' && media.matches);
    };
    apply();
    media.addEventListener('change', apply);
    try { localStorage.setItem(preferenceKey, theme); } catch { /* Optional preferences. */ }
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return { theme, setTheme };
}
