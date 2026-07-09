module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',
  moduleNameMapper: {
    // `@parc/runtime/cell` is a forge-bundler VIRTUAL module (ADR-0042 Inc 1a):
    // at cell-deploy the bundler serves the pre-bundled SDK; in jest (which
    // imports cell source directly) map it to the real monorepo source so a
    // migrated cell resolves the same pipeline. Its v3 store lazy-requires the
    // SDK, so importing is safe even without @aws-sdk installed.
    '^@parc/runtime/cell$': '<rootDir>/platform/runtime/cell-sdk.ts',
    // `@parc/ui` — the platform UI kit virtual module (ADR-0044 Inc 3), same deal.
    '^@parc/ui$': '<rootDir>/platform/ui/parc-ui.ts',
    // `./vendor/<module>.js` is materialized into a cell at push time from the
    // kernel SDK (cell-sync overlay, ADR-0076); repo-side, resolve to the
    // canonical source so cell tests import the same code that deploys.
    'vendor/gateway-client\\.js$': '<rootDir>/cells/kernel/static/gateway-client.js',
    'vendor/cell-jobs\\.js$': '<rootDir>/cells/kernel/static/cell-jobs.js',
    'vendor/substrate\\.js$': '<rootDir>/cells/kernel/static/substrate.js',
  },
  transform: {
    // Transpile-only (isolatedModules in tsconfig.test.json): full type-checking
    // is handled by `tsc --noEmit` in the build, so tests run fast and aren't
    // blocked by unrelated type errors.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    // @marcbachmann/cel-js ships pure ESM; Jest's CJS runtime needs it transformed.
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!@marcbachmann/cel-js/)'],
};