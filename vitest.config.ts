import { defineConfig } from 'vitest/config';

const COVERAGE_THRESHOLD = 80;

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // The CLI entry only binds the process, the file system and the token to runProgram, which the
      // runner's tests cover; running doctor and once --dry-run against a real board is its check.
      exclude: ['packages/runner/src/cli.ts'],
      reporter: [
        'text',
        'lcov',
      ],
      thresholds: {
        lines: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'tooling',
          include: [
            'eslint-rules/**/*.test.mjs',
            'scripts/**/*.test.mjs',
          ],
        },
      },
    ],
  },
});
