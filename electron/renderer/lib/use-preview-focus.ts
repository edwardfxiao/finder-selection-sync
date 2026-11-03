import { useCallback, useEffect, useId, useRef, useState } from 'react';

type Swipe = {
  direction: number; last: number; distance: number;
  scrollTop: number; canRestore: boolean; consumed: boolean;
};
const SCROLL_IDLE = 250;
const SCROLL_DISTANCE = 24;
const TRANSITION_GUARD = 250;

// Scrolling first makes room for the preview, then scrolls its file list.
// A small distance threshold ignores trackpad jitter without requiring a flick.
export function usePreviewFocus(enabled: boolean, resetKey: string) {
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const settingsRef = useRef<HTMLDivElement>(null), previewRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const swipe = useRef<Swipe | null>(null), lockedUntil = useRef(0);
  const settingsId = useId();

  const minimize = useCallback(() => {
    if (!enabled) return;
    collapsedRef.current = true;
    setCollapsed(true);
    swipe.current = null;
    lockedUntil.current = performance.now() + TRANSITION_GUARD;
    requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true }));
  }, [enabled]);

  const restore = useCallback(() => {
    collapsedRef.current = false;
    setCollapsed(false);
    swipe.current = null;
    lockedUntil.current = performance.now() + TRANSITION_GUARD;
  }, []);

  useEffect(() => {
    collapsedRef.current = false;
    setCollapsed(false);
    swipe.current = null;
    lockedUntil.current = 0;
    const root = previewRef.current, workspace = root?.parentElement;
    if (!enabled || !root || !workspace) return;

    const onWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const inline = root.querySelector<HTMLElement>('[data-preview-inline]');
      // Native listeners on the workspace exclude portal dialogs and dropdowns.
      if (!target || !workspace.contains(target) || !inline || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || target.closest('input, textarea, [contenteditable="true"], [role="combobox"], .notice, .footer')
        || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
        swipe.current = null;
        return;
      }
      // A long settings panel keeps its own scrolling until it reaches the edge.
      if (settingsRef.current?.contains(target)) {
        for (let node: Element | null = target; node && node !== settingsRef.current; node = node.parentElement) {
          const remaining = node.scrollHeight - node.clientHeight;
          if (remaining > 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)
            && (event.deltaY > 0 ? node.scrollTop < remaining - 1 : node.scrollTop > 1)) {
            swipe.current = null;
            return;
          }
        }
      }
      const list = inline.querySelector<HTMLElement>('.file-scroll');
      if (!list) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientHeight : 1;
      const delta = event.deltaY * scale;
      if (!Number.isFinite(delta) || !delta) return;
      const now = performance.now(), direction = Math.sign(delta);
      let gesture = swipe.current;
      if (!gesture || gesture.direction !== direction || now - gesture.last > SCROLL_IDLE) {
        gesture = swipe.current = {
          direction, last: now, distance: 0,
          scrollTop: list.scrollTop, canRestore: list.scrollTop <= 1, consumed: false,
        };
      }
      gesture.last = now;
      if (now < lockedUntil.current) {
        // Absorb the initial momentum so lifting the preview preserves its row.
        if (gesture.consumed && event.cancelable) event.preventDefault();
        return;
      }
      if (gesture.consumed) return;
      gesture.distance += Math.abs(delta);
      if (gesture.distance < SCROLL_DISTANCE) return;
      if (collapsedRef.current ? direction > 0 || !gesture.canRestore || list.scrollTop > 1 : direction < 0) return;

      if (event.cancelable) event.preventDefault();
      gesture.consumed = true;
      lockedUntil.current = now + TRANSITION_GUARD;
      const next = !collapsedRef.current;
      if (next) {
        list.scrollTop = gesture.scrollTop;
        const active = document.activeElement;
        if (active instanceof HTMLElement && settingsRef.current?.contains(active)) {
          inline.focus({ preventScroll: true });
        }
      }
      collapsedRef.current = next;
      setCollapsed(next);
    };
    workspace.addEventListener('wheel', onWheel, { passive: false });
    return () => workspace.removeEventListener('wheel', onWheel);
  }, [enabled, resetKey]);

  return { focused: enabled && collapsed, settingsRef, previewRef, toggleRef, settingsId, minimize, restore };
}
