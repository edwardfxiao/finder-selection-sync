import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeMenu } from '@/components/theme-menu';
import { useTheme } from '@/lib/use-theme';
import { I18nContext } from '@/lib/i18n';
import en from '../../locales/en-US.json';

function Harness() {
  const { theme, setTheme } = useTheme();
  return <I18nContext.Provider value={{ t: key => (en as Record<string, unknown>)[key] as string, text: () => '', locale: 'en-US' }}>
    <ThemeMenu theme={theme} onChange={setTheme} />
  </I18nContext.Provider>;
}
function systemTheme(initial: boolean) {
  let dark = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return dark; },
    addEventListener: (_: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_: string, callback: () => void) => listeners.delete(callback),
  })));
  return (next: boolean) => act(() => { dark = next; listeners.forEach(callback => callback()); });
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); document.documentElement.classList.remove('dark'); delete document.documentElement.dataset.theme; });
async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Appearance' }));
  await user.click(screen.getByRole('menuitemradio', { name }));
}

it('follows live system changes, while explicit light/dark choices override the OS', async () => {
  const setSystem = systemTheme(false), user = userEvent.setup();
  render(<Harness />);
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  setSystem(true);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  await choose(user, 'Light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  setSystem(false); setSystem(true);
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  await choose(user, 'Dark');
  setSystem(false);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  await choose(user, 'Follow system');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  setSystem(true);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

it('restores the saved choice and marks it in the menu after remounting', async () => {
  systemTheme(true);
  const user = userEvent.setup(), first = render(<Harness />);
  await choose(user, 'Light');
  expect(localStorage.getItem('finder-appearance')).toBe('light');
  first.unmount(); render(<Harness />);
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Appearance' }));
  expect(screen.getByRole('menuitemradio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
});

it('falls back to the system for an invalid saved preference', () => {
  systemTheme(true); localStorage.setItem('finder-appearance', 'invalid');
  render(<Harness />);
  expect(document.documentElement.dataset.theme).toBe('system');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});
