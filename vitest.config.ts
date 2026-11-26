import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/worker/**'],
    coverage: {
      provider: 'v8',
      include: ['src/room/**/*.ts', 'src/mahjong/{rules,protocol}/**/*.ts', 'src/mahjong/{engine,room-adapter}.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
