import fs from 'node:fs/promises';
import path from 'node:path';
import { translate } from './messages.js';

export async function loadLocales(bundledDirectory, userDirectory) {
  const bundles = new Map();
  const warnings = [];
  for (const [directory, custom] of [[bundledDirectory, false], [userDirectory, true]]) {
    if (!directory) continue;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT' && custom) continue; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*\.json$/.test(entry.name)) continue;
      try {
        const file = path.join(directory, entry.name);
        if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error('Language pack exceeds 2 MB');
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data._meta?.label !== 'string') throw new Error('Missing _meta.label');
        const code = entry.name.slice(0, -5);
        const messages = Object.fromEntries(Object.entries(data).filter(([key, value]) => key !== '_meta' && typeof value === 'string'));
        if (!Object.keys(messages).length) throw new Error('No translated messages');
        bundles.set(code, { code, label: data._meta.label.slice(0, 80), direction: data._meta.direction === 'rtl' ? 'rtl' : 'ltr',
          messages: { ...bundles.get(code)?.messages, ...messages }, custom });
      } catch (error) { warnings.push({ file: entry.name, detail: error.message }); }
    }
  }
  if (!bundles.has('en-US')) throw new Error('Bundled en-US.json is required');
  return { bundles: [...bundles.values()], warnings };
}
export function translator(catalog, locale) {
  const fallback = catalog.bundles.find(b => b.code === 'en-US').messages;
  const selected = catalog.bundles.find(b => b.code === locale)?.messages ?? fallback;
  return (key, params) => translate(selected, fallback, key, params);
}

export function resolveLocale(catalog, systemLocale, savedLocale) {
  const normalize = code => typeof code === 'string' ? code.replaceAll('_', '-').toLowerCase() : '';
  const exact = code => catalog.bundles.find(bundle => normalize(bundle.code) === normalize(code))?.code;
  const language = normalize(systemLocale).split('-')[0];
  return exact(savedLocale) ?? exact(systemLocale)
    ?? catalog.bundles.find(bundle => normalize(bundle.code).split('-')[0] === language)?.code
    ?? 'en-US';
}
