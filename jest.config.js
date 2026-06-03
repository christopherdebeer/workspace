module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',
  transform: {
    // Transpile-only: full type-checking is handled by `tsc --noEmit` in the
    // build, so tests run fast and aren't blocked by unrelated type errors.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json', isolatedModules: true }],
  },
};