import { createContext, useCallback, useContext, useRef, useState, type KeyboardEvent } from 'react';
import { tabbable } from 'tabbable';

type PopupOptions = { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void };

function focusAdjacent(trigger: HTMLElement, backwards: boolean) {
  if (!trigger.isConnected) return;
  const scope = trigger.closest<HTMLElement>('[role="dialog"], dialog[open]') ?? trigger.ownerDocument.body;
  const candidates = tabbable(scope).filter(node => !node.hasAttribute('data-radix-focus-guard'));
  const index = candidates.indexOf(trigger);
  if (index < 0 || candidates.length < 2) { trigger.focus(); return; }
  candidates[(index + (backwards ? -1 : 1) + candidates.length) % candidates.length].focus();
}

export function usePopupKeyboard({ open, defaultOpen = false, onOpenChange }: PopupOptions) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tabDirection = useRef<boolean | null>(null);
  const setOpen = useCallback((next: boolean) => {
    if (next) tabDirection.current = null;
    setInternalOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  const onKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    tabDirection.current = event.shiftKey;
    setOpen(false);
  };
  const onCloseAutoFocus = (event: Event) => {
    const backwards = tabDirection.current;
    tabDirection.current = null;
    if (backwards === null || event.defaultPrevented) return;
    event.preventDefault();
    // Wait for Radix to release its focus scope before moving outside the popup.
    queueMicrotask(() => { if (triggerRef.current) focusAdjacent(triggerRef.current, backwards); });
  };
  return { open: open ?? internalOpen, setOpen, triggerRef, onKeyDownCapture, onCloseAutoFocus };
}

export const PopupKeyboardContext = createContext<ReturnType<typeof usePopupKeyboard> | null>(null);
export const usePopupKeyboardContext = () => useContext(PopupKeyboardContext);

export function loopSelectOptions(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')]
    .filter(option => !option.hasAttribute('data-disabled') && option.getAttribute('aria-disabled') !== 'true');
  if (!options.length) return;
  const focused = event.currentTarget.ownerDocument.activeElement;
  const index = options.findIndex(option => option === focused || option.contains(focused));
  const next = index < 0 ? event.key === 'ArrowUp' ? options.length - 1 : 0
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  event.preventDefault();
  event.stopPropagation();
  options[next].focus();
  options[next].scrollIntoView({ block: 'nearest' });
}
