import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    include: ['tests/worker/**/*.test.ts'],
    testTimeout: 45_000,
    hookTimeout: 30_000,
  },
});
