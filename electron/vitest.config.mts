import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./renderer', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['renderer/tests/*.test.tsx'],
    setupFiles: ['renderer/tests/setup.ts'],
    restoreMocks: true,
    // Full user workflows include real focus traversal, debounce and filesystem IO.
    testTimeout: 20000,
  },
});
