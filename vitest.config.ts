import { defineConfig } from 'vitest/config';

const COVERAGE_THRESHOLD = 80;

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // The entries only bind the process, the file system and the token to the modules the runner's
      // tests cover (runProgram; actionCommand and installPackages). Their check is a real run:
      // doctor and once --dry-run against a board, and the Action's smoke job in CI.
      exclude: [
        'packages/runner/src/cli.ts',
        'packages/runner/src/action.ts',
      ],
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
