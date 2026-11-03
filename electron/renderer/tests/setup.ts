import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);
beforeEach(() => {
  // jsdom has no layout engine. Model visibility for tabbable's layout checks;
  // the actual React/Radix event handlers, focus scopes and portals are exercised.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    for (let node: HTMLElement | null = this; node; node = node.parentElement) {
      if (node.hidden || getComputedStyle(node).display === 'none') return [] as unknown as DOMRectList;
    }
    return [new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList;
  });
});
HTMLElement.prototype.scrollIntoView = () => {};
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => {};
HTMLElement.prototype.releasePointerCapture = () => {};
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
