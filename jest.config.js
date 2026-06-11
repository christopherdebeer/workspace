module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',
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