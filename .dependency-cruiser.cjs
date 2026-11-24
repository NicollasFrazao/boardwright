// Layer rules, checked by `npm run check:architecture`. The reasoning is in
// .context/docs/architecture.md, "Layer rules". The package rules apply as each
// package lands (core in #3, github in #4, agent-claude in #5, runner and action in #8);
// the check runs over every directory that exists.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle makes load order matter and the layers meaningless.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-imports-only-node-builtins',
      severity: 'error',
      comment: 'The domain is pure: no application code, no adapter, no npm package. Node built-ins are allowed.',
      from: { path: '^packages/core/src/domain/' },
      to: {
        pathNot: '^packages/core/src/domain/',
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'application-imports-only-domain',
      severity: 'error',
      comment: 'Use cases talk to the outside through ports declared in the core; zod validates the config at the boundary.',
      from: { path: '^packages/core/src/application/' },
      to: {
        pathNot: [
          '^packages/core/src/(domain|application)/',
          '^zod$',
        ],
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'core-imports-no-other-package',
      severity: 'error',
      comment: 'The core is what every runtime shares; it never depends on an adapter or an entry point.',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(?!core/)' },
    },
    {
      name: 'adapters-import-only-the-core',
      severity: 'error',
      comment: 'An adapter (GitHub, an agent provider) implements a core port; adapters never import each other.',
      from: { path: '^packages/(github|agent-[^/]+)/' },
      to: { path: '^packages/(?!core/)(?!$1/)' },
    },
    {
      name: 'nothing-imports-an-entry-point',
      severity: 'error',
      comment: 'The runner and the action are composition roots: they import everything, nothing imports them.',
      from: { pathNot: '^packages/(runner|action)/' },
      to: { path: '^packages/(runner|action)/' },
    },
    {
      name: 'production-code-does-not-import-tests',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/' },
      to: { path: '^packages/[^/]+/test/' },
    },
    {
      name: 'no-dev-dependencies-in-src',
      severity: 'error',
      comment: 'Published code must not need a devDependency at run time; type-only imports are erased.',
      from: { path: '^packages/[^/]+/src/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'A module nothing imports is dead code (entry points and tests excepted).',
      from: {
        orphan: true,
        pathNot: [
          '^packages/[^/]+/src/(index|cli|main)\\.ts$',
          '\\.test\\.(ts|mjs)$',
          '^scripts/check-context-surfaces\\.mjs$',
          '\\.d\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.mjs'],
    },
  },
};
