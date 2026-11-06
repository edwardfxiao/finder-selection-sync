import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

// Only the title button changes the layout. Wheel and touchpad gestures stay
// native, so scrolling never changes the height of the content under the cursor.
export function usePreviewFocus(enabled: boolean, resetKey: string) {
  const [collapsedModes, setCollapsedModes] = useState<Record<string, boolean>>({});
  const collapsed = !!collapsedModes[resetKey];
  const settingsRef = useRef<HTMLDivElement>(null), previewRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const settingsId = useId();

  const scrollToTop = useCallback(() => {
    if (previewRef.current?.parentElement) previewRef.current.parentElement.scrollTop = 0;
  }, []);

  const minimize = useCallback(() => {
    if (!enabled) return;
    setCollapsedModes(previous => ({ ...previous, [resetKey]: true }));
    requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true }));
  }, [enabled, resetKey]);

  const restore = useCallback(() => {
    setCollapsedModes(previous => ({ ...previous, [resetKey]: false }));
    scrollToTop();
  }, [scrollToTop, resetKey]);

  const resetAll = useCallback(() => {
    setCollapsedModes({});
    scrollToTop();
  }, [scrollToTop]);

  useLayoutEffect(() => {
    if (!enabled) setCollapsedModes(previous => previous[resetKey] ? { ...previous, [resetKey]: false } : previous);
    scrollToTop();
  }, [enabled, resetKey, scrollToTop]);

  useLayoutEffect(scrollToTop, [collapsed, scrollToTop]);

  return { focused: enabled && collapsed, settingsRef, previewRef, toggleRef, settingsId, minimize, restore, resetAll };
}
