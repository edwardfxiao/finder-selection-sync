import { useRef } from 'react';
import type { Row } from '@/types';

export type SelectionModifiers = { shiftKey: boolean; metaKey: boolean; altKey?: boolean };

// Range anchors follow result order, including other pages, never hidden rows.
export function useFileSelection(rows: Row[], selected: Set<string>, setSelected: (value: Set<string>) => void, selectable: (row: Row) => boolean) {
  const anchor = useRef<string | null>(null);
  const range = useRef<{ base: Set<string>; last: Set<string>; additive: boolean } | null>(null);
  const previousRows = useRef(rows);
  if (previousRows.current !== rows) {
    const changed = previousRows.current.length !== rows.length || rows.some((row, index) => row.id !== previousRows.current[index].id);
    previousRows.current = rows;
    if (changed) { anchor.current = null; range.current = null; }
  }
  function replace(next: Set<string>) { range.current = null; anchor.current = null; setSelected(next); }
  function selectRange(id: string, fallback: string, additive: boolean) {
    if (!rows.some(row => row.id === anchor.current)) {
      // Search or Changes only can hide the focused row as well as the anchor.
      // Start with the clicked result when neither remains in the result set.
      anchor.current = rows.some(row => row.id === fallback) ? fallback : id;
    }
    const first = rows.findIndex(row => row.id === anchor.current), last = rows.findIndex(row => row.id === id);
    if (first < 0 || last < 0) return;
    if (!range.current || range.current.last !== selected || range.current.additive !== additive) {
      const resultIds = new Set(rows.map(row => row.id));
      // A normal range replaces the visible selection. Hidden selections remain
      // explicit in the existing selection count; Command adds a separate range.
      const base = new Set([...selected].filter(value => additive || !resultIds.has(value)));
      range.current = { base, last: selected, additive };
    }
    const next = new Set(range.current.base);
    for (const row of rows.slice(Math.min(first, last), Math.max(first, last) + 1)) if (selectable(row)) next.add(row.id);
    range.current.last = next;
    setSelected(next);
  }
  function click(id: string, modifiers: SelectionModifiers, focused?: string) {
    const row = rows.find(row => row.id === id);
    if (!row || !selectable(row)) return;
    if (modifiers.shiftKey) { selectRange(id, focused ?? id, modifiers.metaKey); return; }
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    anchor.current = id;
    range.current = null;
    setSelected(next);
  }
  function move(source: string | undefined, key: 'ArrowUp' | 'ArrowDown' | 'Home' | 'End', modifiers: SelectionModifiers) {
    const forward = key === 'ArrowDown' || key === 'End';
    const edge = modifiers.altKey || key === 'Home' || key === 'End';
    const index = rows.findIndex(row => row.id === source), direction = forward ? 1 : -1;
    let cursor = edge ? forward ? rows.length - 1 : 0 : index < 0 ? forward ? 0 : rows.length - 1 : index + direction;
    let target: Row | undefined;
    const step = edge ? -direction : direction;
    for (; cursor >= 0 && cursor < rows.length; cursor += step) {
      if (selectable(rows[cursor])) { target = rows[cursor]; break; }
    }
    const row = target ?? rows.find(row => row.id === source && selectable(row));
    if (!row) return;
    if (modifiers.shiftKey) selectRange(row.id, source ?? row.id, modifiers.metaKey);
    else {
      anchor.current = row.id;
      range.current = null;
      setSelected(new Set([row.id]));
    }
    return row.id;
  }
  function all() {
    replace(new Set([...selected, ...rows.filter(selectable).map(row => row.id)]));
  }
  return { click, move, all, replace, clear: () => replace(new Set()) };
}
