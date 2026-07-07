import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Pure, deterministic logic lives in src/lib and is held to 100%.
      // The three.js rendering layer (src/render, src/main.js) is verified by
      // headless screenshot smoke tests instead of line coverage.
      include: ['src/lib/**/*.js'],
      exclude: ['**/*.test.js'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
