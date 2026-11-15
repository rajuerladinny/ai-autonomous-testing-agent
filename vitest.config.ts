import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['apps/api/test/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
