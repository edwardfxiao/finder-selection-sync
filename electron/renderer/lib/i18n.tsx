import { createContext, useContext } from 'react';
import { translate } from '../../messages.js';
import type { Catalog, Message } from '../types';
export type Translate = (key: string, params?: Record<string, string | number>) => string;
export const I18nContext = createContext<{ t: Translate; text: (message?: Message | null) => string; locale: string }>({
  t: key => key, text: message => message?.key ?? '', locale: 'en-US',
});
export const useI18n = () => useContext(I18nContext);
export function makeTranslator(catalog: Catalog) {
  const fallback = catalog.bundles.find(b => b.code === 'en-US')?.messages ?? {};
  const messages = catalog.bundles.find(b => b.code === catalog.current)?.messages ?? fallback;
  const t: Translate = (key, params = {}) => translate(messages, fallback, key, params);
  return { t, text: (message?: Message | null) => message ? t(message.key, message.params) : '', locale: catalog.current };
}
